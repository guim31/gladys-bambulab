// -----------------------------------------------------------------------------
// What the container writes to `docker logs`: the lifecycle only at info level,
// nothing per report, state publication or camera round, and a repeated
// failure said once, with one line when it recovers. Never the access code.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_CODE, FakePrinter, settle } from './helpers/fakePrinter.js';
import { FAST_HUB, FAST_TIMINGS, addDevices, createWorld } from './helpers/world.js';

/** Captures the SDK logger's lines (console.log for debug/info, console.error above). */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const lines = [];
  const record = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', record);
  t.mock.method(console, 'error', record);
  t.after(() => {
    if (previous === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = previous;
    }
  });
  return {
    lines,
    /** The lines written since the last call. */
    take() {
      return lines.splice(0);
    },
  };
}

const RUNNING = { gcode_state: 'RUNNING', mc_percent: 10, layer_num: 3 };

test('a normal cycle writes nothing at info level once connected', async (t) => {
  const logs = captureLogs(t);
  const printer = new FakePrinter({ fixture: 'a1-ams-lite', overrides: RUNNING });
  const { gladys, app } = await createWorld({
    printers: [printer],
    timings: { ...FAST_TIMINGS, silence: 40 },
    hubTimings: { ...FAST_HUB, cameraInterval: 30 },
  });
  t.after(() => app.stop());
  await addDevices(gladys);
  await settle(50);

  // Start: the connection and what the printer is, nothing else.
  const start = logs.take();
  assert.ok(
    start.some((line) => /\[INFO\].*connected \(192\.0\.2\.10\)/.test(line)),
    start.join('\n'),
  );
  assert.ok(start.every((line) => !line.includes(ACCESS_CODE)));
  assert.ok(
    start.every((line) => !/\[(WARN|ERROR)\]/.test(line)),
    start.join('\n'),
  );

  // Steady state: reports, state publications, camera rounds, silence watchdog.
  const published = gladys.fake.states.length;
  const images = gladys.fake.cameraImages.length;
  for (let layer = 4; layer < 14; layer += 1) {
    printer.report({ layer_num: layer, nozzle_temper: 200 + layer, mc_percent: 10 + layer });
    await settle(15);
  }
  app.hub.printers.get(printer.serial).link.refresh();
  await settle(100);
  assert.ok(gladys.fake.states.length > published, 'states were published');
  assert.ok(gladys.fake.cameraImages.length > images, 'camera images were pushed');
  assert.deepEqual(logs.take(), []);
});

test('failures repeated every report or round are logged once, recovery once', async (t) => {
  const logs = captureLogs(t);
  const printer = new FakePrinter({ fixture: 'a1-ams-lite', overrides: RUNNING });
  const { gladys, app } = await createWorld({
    printers: [printer],
    hubTimings: { ...FAST_HUB, cameraInterval: 20 },
  });
  t.after(() => app.stop());
  await addDevices(gladys);
  await settle(50);
  logs.take();
  const count = (lines, pattern) => lines.filter((line) => pattern.test(line)).length;

  // Gladys refuses the states: one warning for many reports, one line back.
  const publish = t.mock.method(gladys, 'publishChangedStates', async () => {
    throw new Error('Gladys is restarting');
  });
  for (let layer = 4; layer < 10; layer += 1) {
    printer.report({ layer_num: layer });
    await settle(15);
  }
  assert.ok(publish.mock.callCount() >= 5);
  publish.mock.restore();
  printer.report({ layer_num: 20 });
  await settle(30);
  let lines = logs.take();
  assert.equal(count(lines, /\[WARN\].*Cannot publish the states/), 1, lines.join('\n'));
  assert.equal(count(lines, /\[INFO\].*states published again/), 1, lines.join('\n'));
  assert.equal(lines.length, 2, lines.join('\n'));

  // The camera refuses the code round after round.
  printer.accessCode = 'refused!';
  await settle(150);
  printer.accessCode = ACCESS_CODE;
  await settle(60);
  lines = logs.take();
  assert.equal(count(lines, /\[WARN\].*no camera image/), 1, lines.join('\n'));
  assert.equal(count(lines, /\[INFO\].*camera images again/), 1, lines.join('\n'));
  assert.equal(lines.length, 2, lines.join('\n'));

  // The printer is off: many reconnection attempts, one warning, one line back.
  printer.online = false;
  printer.disconnect();
  await settle(400);
  assert.ok(printer.connections >= 1);
  lines = logs.take();
  assert.equal(count(lines, /\[WARN\]/), 1, lines.join('\n'));
  assert.equal(count(lines, /\[INFO\]/), 0, lines.join('\n'));
  printer.online = true;
  await settle(200);
  lines = logs.take();
  assert.equal(count(lines, /\[INFO\].*connected/), 1, lines.join('\n'));
  assert.ok(
    lines.every((line) => !/\[(WARN|ERROR)\]/.test(line)),
    lines.join('\n'),
  );
  assert.ok(logs.lines.every((line) => !line.includes(ACCESS_CODE)));
});

test('an automatic network search that keeps failing is logged once', async (t) => {
  const logs = captureLogs(t);
  const printer = new FakePrinter({ fixture: 'p1p-ams', host: '192.0.2.77' });
  const { gladys, app } = await createWorld({
    printers: [printer],
    config: { serial_1: printer.serial, access_code_1: printer.accessCode },
    hubTimings: { ...FAST_HUB, searchGap: 30 },
    connect: false,
  });
  t.after(() => app.stop());
  const scan = t.mock.method(gladys, 'scanNetwork', async () => {
    throw new Error('403 network_discovery: capture type udp-broadcast is not declared');
  });
  await gladys.connect();
  await settle(200);
  assert.ok(scan.mock.callCount() >= 3);
  const lines = logs.take();
  assert.equal(
    lines.filter((line) => /\[WARN\].*Network search unavailable/.test(line)).length,
    1,
    lines.join('\n'),
  );
});
