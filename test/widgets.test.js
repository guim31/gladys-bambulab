// -----------------------------------------------------------------------------
// The "Bambu Lab 3D print" widget: content within the core vocabulary and
// budget in every state, live tiles bound to features that exist, buttons
// that do what they say.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_ACTIONS } from '../src/widgets.js';
import { FakePrinter, settle } from './helpers/fakePrinter.js';
import { addDevices, createWorld, deviceId } from './helpers/world.js';

async function content(gladys, serial, language = 'en') {
  const ack = await gladys.fake.widgetGet('printer', {
    settings: { device: deviceId(serial) },
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

function check(gladys, serial, widget) {
  assert.deepEqual(validateWidgetContent(widget), [], JSON.stringify(widget));
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === deviceId(serial));
  const ids = new Set(device.features.map((f) => f.external_id));
  for (const component of widget.components) {
    if (component.device_feature) {
      assert.ok(ids.has(component.device_feature), `${component.device_feature} exists`);
    }
    if (component.action) {
      assert.ok(WIDGET_ACTIONS.includes(component.action.key), component.action.key);
    }
  }
}

const buttons = (widget) =>
  widget.components.filter((c) => c.type === 'button').map((c) => c.action.key);
const status = (widget) => widget.components.find((c) => c.type === 'status').items;

test('printing: progress, temperatures, layers, end time, spools; pause and cancel', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams', overrides: { gcode_state: 'RUNNING' } });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  await addDevices(gladys);
  const widget = await content(gladys, printer.serial, 'fr');
  check(gladys, printer.serial, widget);
  assert.equal(widget.ttl_seconds, 30);
  assert.deepEqual(buttons(widget), ['pause', 'cancel']);
  const cancel = widget.components.find((c) => c.action?.key === 'cancel');
  assert.equal(cancel.action.confirm, true);
  assert.equal(cancel.style, 'danger');
  const items = status(widget);
  assert.deepEqual(items[0], { label: 'État', value: 'Impression', color: 'primary' });
  assert.ok(items.some((i) => i.label === 'Couche' && i.value === '1 / 70'));
  assert.ok(items.some((i) => i.label === 'Fin vers'));
  const spools = items.filter((i) => i.label.startsWith('AMS'));
  assert.equal(spools[0].label, 'AMS A1');
  assert.equal(spools[0].value, 'PLA · violet');
  assert.ok(
    widget.components.some((c) => c.type === 'image'),
    'camera image of the P1P',
  );
});

test('paused: resume and cancel; idle: the light; refused firmware: no print button', async (t) => {
  const printer = new FakePrinter({ fixture: 'x1c-multi-ams', overrides: { fun: '1' } });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  await addDevices(gladys);
  let widget = await content(gladys, printer.serial);
  check(gladys, printer.serial, widget);
  assert.equal(widget.ttl_seconds, 300);
  assert.deepEqual(buttons(widget), ['light_off'], 'finished, light on');
  assert.equal(status(widget).length, 10, 'twelve spools cut to the 10 rows of a status');

  printer.report({ gcode_state: 'PAUSE' });
  await settle();
  widget = await content(gladys, printer.serial);
  check(gladys, printer.serial, widget);
  assert.deepEqual(buttons(widget), ['resume', 'cancel']);

  printer.report({ fun: '3EC1AFFF9CFF' });
  await settle();
  widget = await content(gladys, printer.serial);
  check(gladys, printer.serial, widget);
  assert.deepEqual(buttons(widget), ['light_off']);
  assert.ok(status(widget).some((i) => i.value === 'Developer mode needed'));
});

test('unreachable, unknown, not chosen: a short text or the state only', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams' });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  printer.online = false;
  printer.disconnect();
  await settle(100);
  const widget = await content(gladys, printer.serial, 'de');
  check(gladys, printer.serial, widget);
  assert.deepEqual(status(widget), [
    { label: 'Status', value: 'Drucker nicht erreichbar', color: 'danger' },
  ]);
  assert.deepEqual(buttons(widget), []);

  const none = await gladys.fake.widgetGet('printer', { settings: {}, language: 'es' });
  assert.match(none.data.content.components[0].text, /Elija una impresora/);
  const unknown = await gladys.fake.widgetGet('printer', {
    settings: { device: deviceId('01S00A999999999') },
    language: 'fr',
  });
  assert.match(unknown.data.content.components[0].text, /plus configurée/);
});

test('buttons: pause, cancel (sent as stop), light; refusals as a toast', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams', overrides: { gcode_state: 'RUNNING' } });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  const settings = { device: deviceId(printer.serial) };
  const act = async (key) =>
    (await gladys.fake.widgetAction('printer', key, {}, { settings })).data.message;

  assert.equal((await act('pause')).en, 'Pause requested.');
  await settle();
  assert.equal((await act('pause')).fr, 'Aucune impression en cours.');
  assert.equal((await act('cancel')).de, 'Abbruch angefordert.');
  assert.equal(printer.requests.at(-1).print.command, 'stop');
  assert.equal((await act('light_on')).es, 'Luz del recinto encendida.');
  assert.equal(printer.requests.at(-1).system.led_mode, 'on');
  const unknown = await gladys.fake.widgetAction('printer', 'explode', {}, { settings });
  assert.equal(unknown.success, false);
});
