// -----------------------------------------------------------------------------
// The integration end to end, against fake printers on in-memory streams and
// the SDK's fake Gladys: connection, states, print events, HMS alerts,
// commands, network search, camera, connection status, restarts.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakePrinter, announcements, jpeg, settle } from './helpers/fakePrinter.js';
import { addDevices, configFor, createWorld, deviceId, featureId } from './helpers/world.js';

const states = (gladys, serial) =>
  Object.fromEntries(
    gladys.fake.discoveredDevices
      .find((d) => d.external_id === deviceId(serial))
      .features.map((f) => [f.external_id.split(':').at(-1), gladys.fake.lastState(f.external_id)]),
  );

test('connects with the access code, publishes one device per printer and its states', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams' });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, deviceId(printer.serial));
  assert.equal(device.name, 'Bambu Lab P1P');
  assert.equal(device.should_poll, false);
  assert.deepEqual(device.params, [
    { name: 'SERIAL_NUMBER', value: printer.serial },
    { name: 'IP_ADDRESS', value: printer.host },
  ]);
  // P1P: no chamber sensor (its chamber_temper is meaningless), a JPEG camera.
  const keys = device.features.map((f) => f.external_id.split(':').at(-1));
  assert.ok(!keys.includes('chamber_temperature'));
  assert.ok(keys.includes('camera'));
  assert.ok(keys.includes('light'));
  // get_version and pushall asked once connected.
  assert.ok(printer.requests.some((r) => r.info?.command === 'get_version'));
  assert.ok(printer.requests.some((r) => r.pushing?.command === 'pushall'));

  await addDevices(gladys);
  const values = states(gladys, printer.serial);
  assert.equal(values.state, 'Échouée'); // the fixture's last print failed
  assert.equal(values.task, 'Fidget toy');
  assert.equal(values.nozzle_temperature, 21);
  assert.equal(values.bed_temperature, 20);
  assert.equal(values.layer, 1);
  assert.equal(values.total_layers, 70);
  assert.equal(values.speed, 'standard');
  assert.equal(values.errors, 'Aucune erreur');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('a P1 delta only changes what it carries', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams' });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  await addDevices(gladys);
  printer.report({ nozzle_temper: 219.6, nozzle_target_temper: 220 });
  await settle();
  const values = states(gladys, printer.serial);
  assert.equal(values.nozzle_temperature, 220);
  assert.equal(values.nozzle_target, 220);
  assert.equal(values.total_layers, 70, 'kept from the full status');
});

test('a whole print: started, paused, resumed, finished, with the print time', async (t) => {
  let clock = Date.parse('2026-10-13T08:00:00Z');
  const printer = new FakePrinter({ fixture: 'p1p-no-ams' }); // FINISH
  const { gladys, app } = await createWorld({ printers: [printer], now: () => clock });
  t.after(() => app.stop());
  await addDevices(gladys);
  const events = () => gladys.fake.sceneEvents.map((e) => e.key);

  printer.report({ gcode_state: 'PREPARE', subtask_name: 'Benchy', mc_percent: 0 });
  await settle();
  printer.report({ gcode_state: 'RUNNING', mc_percent: 10, mc_remaining_time: 50 });
  await settle();
  assert.deepEqual(events(), ['print_started'], 'PREPARE then RUNNING: one start');
  const started = gladys.fake.sceneEvents[0];
  assert.deepEqual(started.data, {
    device: deviceId(printer.serial),
    printer: 'Bambu Lab P1P',
    file: 'Benchy',
  });

  clock += 30 * 60_000;
  printer.report({ gcode_state: 'PAUSE', print_error: 117473286 });
  await settle();
  const paused = gladys.fake.sceneEvents.at(-1);
  assert.equal(paused.key, 'print_paused');
  assert.equal(paused.data.duration, '30 min');
  assert.equal(paused.data.duration_minutes, 30);
  assert.equal(paused.data.error_code, '0700_8006');
  assert.match(paused.data.error_message, /filament|extrudeuse/i);

  printer.report({ gcode_state: 'RUNNING', print_error: 0 });
  await settle();
  clock += 45 * 60_000;
  printer.report({ gcode_state: 'FINISH', mc_percent: 100, mc_remaining_time: 0 });
  await settle();
  assert.deepEqual(events(), ['print_started', 'print_paused', 'print_done']);
  const done = gladys.fake.sceneEvents.at(-1);
  assert.equal(done.data.duration, '1 h 15 min');
  assert.equal(done.data.duration_minutes, 75);
  assert.equal(states(gladys, printer.serial).state, 'Terminée');
});

test('a cancelled print fires print_failed with reason "cancelled", an error with its code', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-no-ams', overrides: { gcode_state: 'RUNNING' } });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  // The printer reports FAILED first, the cancellation code right after.
  printer.report({ gcode_state: 'FAILED' });
  printer.report({ print_error: 50348044 });
  await settle(100);
  let failed = gladys.fake.sceneEvents.at(-1);
  assert.equal(failed.key, 'print_failed');
  assert.equal(failed.data.reason, 'cancelled');
  assert.equal(failed.data.error_code, '');

  printer.report({ print_error: 0, gcode_state: 'RUNNING' });
  await settle();
  printer.report({ print_error: 50364437, gcode_state: 'FAILED' }); // 0300_8015
  await settle(100);
  failed = gladys.fake.sceneEvents.at(-1);
  assert.equal(failed.key, 'print_failed');
  assert.equal(failed.data.reason, 'error');
  assert.equal(failed.data.error_code, '0300_8015');
  assert.equal(gladys.fake.sceneEvents.filter((e) => e.key === 'print_failed').length, 2);
});

test('the status at connection fires nothing, even after a reconnection', async (t) => {
  const printer = new FakePrinter({ fixture: 'h2d-dual-ams' }); // RUNNING
  const { gladys, app, hub } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  printer.disconnect();
  await settle(150);
  assert.equal(hub.printers.get(printer.serial).link.connected, true, 'reconnected');
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('a new HMS error fires hms_error with its text in the configured language', async (t) => {
  const printer = new FakePrinter({ fixture: 'x1c-multi-ams' });
  const { gladys, app } = await createWorld({
    printers: [printer],
    config: configFor([printer], { language: 'de' }),
  });
  t.after(() => app.stop());
  await addDevices(gladys);
  // 0300_0100_0001_0007: the heatbed temperature is abnormal (severity 1: fatal).
  printer.report({ hms: [{ attr: 50331904, code: 65543 }] });
  await settle();
  printer.report({ hms: [{ attr: 50331904, code: 65543 }] }); // still there: no new event
  await settle();
  const fired = gladys.fake.sceneEvents.filter((e) => e.key === 'hms_error');
  assert.equal(fired.length, 1);
  assert.equal(fired[0].data.code, '0300_0100_0001_0007');
  assert.equal(fired[0].data.severity, 'fatal');
  assert.match(fired[0].data.message, /Heizbett/);
  assert.match(states(gladys, printer.serial).errors, /^0300_0100_0001_0007: .*Heizbett/);
  printer.report({ hms: [] });
  await settle();
  assert.equal(states(gladys, printer.serial).errors, 'Kein Fehler');
});

test('pause, resume, speed and light from the device; refusals are explained', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams', overrides: { gcode_state: 'RUNNING' } });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  await addDevices(gladys);
  const device = gladys.fake.discoveredDevices[0];
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));

  assert.equal(
    (await gladys.fake.setValue(device, feature('resume'), 1)).error,
    'L’impression n’est pas en pause.'.replace(/’/g, "'"),
  );
  assert.equal((await gladys.fake.setValue(device, feature('pause'), 1)).success, true);
  await settle();
  assert.deepEqual(printer.requests.at(-1).print.command, 'pause');
  assert.equal(states(gladys, printer.serial).state, 'En pause');
  assert.equal((await gladys.fake.setValue(device, feature('resume'), 1)).success, true);

  assert.equal((await gladys.fake.setValue(device, feature('speed'), 'sport')).success, true);
  assert.deepEqual(printer.requests.at(-1).print, {
    sequence_id: printer.requests.at(-1).print.sequence_id,
    command: 'print_speed',
    param: '3',
  });
  await settle();
  assert.equal(states(gladys, printer.serial).speed, 'sport');
  assert.match((await gladys.fake.setValue(device, feature('speed'), 'turbo')).error, /inconnue/);

  assert.equal((await gladys.fake.setValue(device, feature('light'), 0)).success, true);
  assert.equal(printer.requests.at(-1).system.led_mode, 'off');
  await settle();
  assert.equal(states(gladys, printer.serial).light, 0);

  const nozzle = feature('nozzle_target');
  assert.equal(nozzle.read_only, true);
  assert.match((await gladys.fake.setValue(device, nozzle, 250)).error, /cannot be controlled/);
});

test('a firmware that requires signed commands: control refused, light still allowed', async (t) => {
  // `fun` with bit 29 set: Developer mode off on a 2025 firmware.
  const printer = new FakePrinter({
    fixture: 'h2d-dual-ams',
    overrides: { fun: '3EC1AFFF9CFF' },
  });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  await addDevices(gladys);
  const device = gladys.fake.discoveredDevices[0];
  const feature = (key) => device.features.find((f) => f.external_id.endsWith(`:${key}`));
  const before = printer.requests.length;
  assert.match((await gladys.fake.setValue(device, feature('pause'), 1)).error, /Développeur/);
  assert.equal(printer.requests.length, before, 'nothing sent');
  assert.equal((await gladys.fake.setValue(device, feature('light'), 0)).success, true);
  const report = await gladys.fake.action('test_connection', {});
  assert.match(report.data.message.fr, /refusées par le firmware/);

  printer.report({ fun: '3EC18FFF9CFF' }); // Developer mode on
  await settle();
  assert.equal((await gladys.fake.setValue(device, feature('pause'), 1)).success, true);
});

test('a command the printer answers "failed" is reported as refused', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams', overrides: { gcode_state: 'RUNNING' } });
  printer.answer = 'failed';
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  const device = gladys.fake.discoveredDevices[0];
  const ack = await gladys.fake.setValue(
    device,
    { external_id: featureId(printer.serial, 'pause') },
    1,
  );
  assert.equal(ack.success, false);
  assert.equal(ack.error, "L'imprimante a refusé la commande.");
  // A printer that does not answer: the command is assumed sent.
  printer.answer = 'silent';
  const silent = await gladys.fake.setValue(
    device,
    { external_id: featureId(printer.serial, 'pause') },
    1,
  );
  assert.equal(silent.success, true);
});

test('a refused access code: "unauthorized" state and status, no retry storm', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams', accessCode: '87654321' });
  const { gladys, app, hub } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  await settle(200);
  assert.equal(printer.connections, 1, 'the next attempt waits unauthorizedDelay');
  assert.equal(hub.printers.get(printer.serial).link.snapshot.state, 'unauthorized');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.fr, /code d'accès ou numéro de série refusé/);
  // No device before the printer ever answered.
  assert.deepEqual(gladys.fake.discoveredDevices, []);
});

test('a wrong serial number is refused like a wrong code', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams' });
  const { gladys, app } = await createWorld({
    printers: [printer],
    config: {
      serial_1: '01S00A999999999',
      host_1: printer.host,
      access_code_1: printer.accessCode,
    },
  });
  t.after(() => app.stop());
  assert.match(gladys.fake.connectionStatus.message.en, /access code or serial number refused/);
});

test('a printer that goes away: unreachable, then back without an event storm', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams' });
  const { gladys, app, hub } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  await addDevices(gladys);
  printer.online = false;
  printer.disconnect();
  await settle(150);
  assert.equal(states(gladys, printer.serial).state, 'Imprimante injoignable');
  assert.match(gladys.fake.connectionStatus.message.fr, /Imprimante 1 : aucune réponse/);
  // The other values are kept.
  assert.equal(states(gladys, printer.serial).total_layers, 70);
  printer.online = true;
  await settle(300);
  assert.equal(hub.printers.get(printer.serial).link.reporting, true);
  assert.equal(states(gladys, printer.serial).state, 'Échouée');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.deepEqual(gladys.fake.sceneEvents, []);
});

test('no address: the network search finds the printer by its serial number', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams', host: '192.0.2.77' });
  printer.name = 'Workshop P1P';
  const { gladys, app, dataDir } = await createWorld({
    printers: [printer],
    config: { serial_1: printer.serial, access_code_1: printer.accessCode },
    scanResults: { 'udp-broadcast': announcements(printer) },
  });
  t.after(() => app.stop());
  await settle(100);
  // One search at start (no address), on the ports the manifest declares.
  assert.deepEqual(gladys.fake.scans, [{ type: 'udp-broadcast', timeout_seconds: 1 }]);
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.name, 'Workshop P1P');
  assert.deepEqual(device.params[1], { name: 'IP_ADDRESS', value: '192.0.2.77' });
  await app.stop();

  // The address is remembered for the next start.
  const again = await createWorld({
    printers: [printer],
    config: { serial_1: printer.serial, access_code_1: printer.accessCode },
    dataDir,
  });
  t.after(() => again.app.stop());
  assert.equal(again.hub.printers.get(printer.serial).link.host, '192.0.2.77');
  assert.equal(again.gladys.fake.discoveredDevices[0].name, 'Workshop P1P');
});

test('"Find printers" lists the announcements, configured or not', async (t) => {
  const configured = new FakePrinter({ fixture: 'p1p-ams', host: '192.0.2.10' });
  const other = new FakePrinter({ fixture: 'x1c-multi-ams', host: '192.0.2.11' });
  other.modelCode = '3DPrinter-X1-Carbon';
  other.name = 'Garage';
  const { gladys, app } = await createWorld({
    printers: [configured, other],
    config: configFor([configured]),
    scanResults: { 'udp-broadcast': announcements(configured, other) },
  });
  t.after(() => app.stop());
  const ack = await gladys.fake.action('find_printers', {});
  assert.equal(ack.success, true);
  const text = ack.data.message.en;
  assert.match(
    text,
    /Printer 1 \(Bambu Lab P1P\): address 192\.0\.2\.10, serial number 01S00A000000003, LAN only mode, configured as printer 1\./,
  );
  assert.match(
    text,
    /Garage \(Bambu Lab X1 Carbon\): address 192\.0\.2\.11, serial number 00M00A000000001, LAN only mode\./,
  );
});

test('a scan unavailable on this Gladys is said plainly', async (t) => {
  const printer = new FakePrinter();
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  t.mock.method(gladys, 'scanNetwork', async () => {
    throw new Error('403 network_discovery: capture type udp-broadcast is not declared');
  });
  const ack = await gladys.fake.action('find_printers', {});
  assert.match(ack.data.message.fr, /recherche réseau est indisponible/);
});

test('camera: a fresh JPEG on demand, pushed on device creation, served to the widget', async (t) => {
  const printer = new FakePrinter({ fixture: 'a1-ams-lite' });
  const { gladys, app, hub } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  await addDevices(gladys);
  await settle(50);
  const cameraId = featureId(printer.serial, 'camera');
  assert.equal(gladys.fake.cameraImages.length, 1);
  assert.equal(gladys.fake.cameraImages[0].device_feature_external_id ?? cameraId, cameraId);

  const device = gladys.fake.discoveredDevices[0];
  const ack = await gladys.fake.getImage(device);
  assert.equal(ack.success, true);
  assert.equal(ack.data.image, `image/jpg;base64,${jpeg().toString('base64')}`);

  const content = (
    await gladys.fake.widgetGet('printer', {
      settings: { device: device.external_id },
      language: 'en',
    })
  ).data.content;
  const image = content.components.find((c) => c.type === 'image');
  assert.ok(image, 'the last image is in the widget');
  const served = await gladys.fake.widgetGetImage(image.key);
  assert.equal(served.data.image, jpeg().toString('base64'));
  assert.equal(hub.printers.get(printer.serial).image.key, image.key);

  // A wrong access code on the camera: said so.
  printer.accessCode = 'other';
  assert.equal((await gladys.fake.getImage(device)).error, "La caméra a refusé le code d'accès.");
  // An image too large for Gladys.
  printer.accessCode = '12345678';
  printer.cameraFrames = [jpeg(160 * 1024)];
  assert.match((await gladys.fake.getImage(device)).error, /150 Ko/);
});

test('no camera for the X1, H2 and P2S series, nor when turned off', async (t) => {
  const x1 = new FakePrinter({ fixture: 'x1c-multi-ams', host: '192.0.2.30' });
  const p1 = new FakePrinter({ fixture: 'p1p-ams', host: '192.0.2.31' });
  const { gladys, app } = await createWorld({
    printers: [x1, p1],
    config: configFor([x1, p1], { camera: false }),
  });
  t.after(() => app.stop());
  for (const device of gladys.fake.discoveredDevices) {
    assert.ok(!device.features.some((f) => f.category === 'camera'), device.name);
  }
  assert.equal(x1.cameraConnections + p1.cameraConnections, 0);
});

test('the capabilities survive a restart while the printer is off', async (t) => {
  const printer = new FakePrinter({ fixture: 'x1c-multi-ams' });
  const first = await createWorld({ printers: [printer] });
  const published = first.gladys.fake.discoveredDevices;
  await first.app.stop();
  printer.online = false;
  const second = await createWorld({ printers: [printer], dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(second.gladys.fake.discoveredDevices, published);
});

test('invalid configuration fields are named in the status', async (t) => {
  const { gladys, app } = await createWorld({
    printers: [],
    config: {
      serial_1: 'not-a-serial',
      access_code_1: '12345678',
      serial_2: '01S00A000000003',
      host_2: 'http://192.0.2.10:8883/',
      access_code_2: '',
    },
  });
  t.after(() => app.stop());
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Printer 1: invalid serial number. Printer 2: enter the access code shown on the printer.',
  );
});

test('nothing configured: the status says what to enter', async (t) => {
  const { gladys, app } = await createWorld({ printers: [], config: {} });
  t.after(() => app.stop());
  assert.deepEqual(gladys.fake.connectionStatus, {
    connected: false,
    message: {
      en: 'Enter the serial number and the access code of your printer, then save.',
      fr: "Saisissez le numéro de série et le code d'accès de votre imprimante, puis enregistrez.",
      de: 'Gib die Seriennummer und den Zugangscode deines Druckers ein und speichere.',
      es: 'Introduzca el número de serie y el código de acceso de su impresora y guarde.',
    },
  });
});

test('a new configuration reconnects only the printers that changed', async (t) => {
  const a = new FakePrinter({ fixture: 'p1p-ams', host: '192.0.2.10' });
  const b = new FakePrinter({ fixture: 'a1-ams-lite', host: '192.0.2.11' });
  const { gladys, app } = await createWorld({ printers: [a, b] });
  t.after(() => app.stop());
  assert.equal(a.connections, 1);
  b.host = '192.0.2.12';
  await gladys.fake.configUpdated(configFor([a, b], { language: 'en' }));
  await settle(100);
  assert.equal(a.connections, 1, 'unchanged: kept');
  assert.equal(b.connections, 2, 'new address: reconnected');
  assert.equal(states(gladys, a.serial).state, 'Failed', 'states in the new language');
});

test('test_connection reports every printer', async (t) => {
  const a = new FakePrinter({ fixture: 'p1p-ams', host: '192.0.2.10' });
  const b = new FakePrinter({ fixture: 'a1-ams-lite', host: '192.0.2.11' });
  b.online = false;
  const { gladys, app } = await createWorld({ printers: [a, b] });
  t.after(() => app.stop());
  const ack = await gladys.fake.action('test_connection', {});
  assert.equal(
    ack.data.message.en,
    'Printer 1: Bambu Lab P1P, firmware 01.07.00.00, Failed. Printer 2: Printer unreachable.',
  );
});
