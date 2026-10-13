// -----------------------------------------------------------------------------
// Scene actions: applied or not, never an error for a refusal of the state;
// an error for an unknown printer, an unreachable one or a locked firmware.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakePrinter, settle } from './helpers/fakePrinter.js';
import { createWorld, deviceId } from './helpers/world.js';

test('control_print: pause, resume, cancel (sent as stop)', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams', overrides: { gcode_state: 'RUNNING' } });
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  const run = async (command) =>
    gladys.fake.sceneAction('control_print', { device: deviceId(printer.serial), command });
  assert.deepEqual((await run('resume')).data.outputs, { applied: false });
  assert.deepEqual((await run('pause')).data.outputs, { applied: true });
  await settle();
  assert.deepEqual((await run('resume')).data.outputs, { applied: true });
  await settle();
  assert.deepEqual((await run('cancel')).data.outputs, { applied: true });
  assert.equal(printer.requests.at(-1).print.command, 'stop');
  await settle(100);
  assert.deepEqual(
    (await run('cancel')).data.outputs,
    { applied: false },
    'nothing left to cancel',
  );
  assert.equal((await run('explode')).success, false);
});

test('set_light and set_speed', async (t) => {
  const printer = new FakePrinter({ fixture: 'a1-ams-lite' }); // IDLE, light off
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  const device = deviceId(printer.serial);
  const light = await gladys.fake.sceneAction('set_light', { device, state: 'on' });
  assert.deepEqual(light.data.outputs, { applied: true });
  assert.equal(printer.requests.at(-1).system.led_node, 'chamber_light');
  const idle = await gladys.fake.sceneAction('set_speed', { device, speed: 'sport' });
  assert.deepEqual(idle.data.outputs, { applied: false }, 'no print: nothing to speed up');
  printer.report({ gcode_state: 'RUNNING' });
  await settle();
  const speed = await gladys.fake.sceneAction('set_speed', { device, speed: 'ludicrous' });
  assert.deepEqual(speed.data.outputs, { applied: true });
  assert.equal(printer.requests.at(-1).print.param, '4');
  assert.equal(
    (await gladys.fake.sceneAction('set_speed', { device, speed: 'warp' })).success,
    false,
  );
});

test('an unknown or unreachable printer fails the action', async (t) => {
  const printer = new FakePrinter({ fixture: 'p1p-ams' });
  printer.online = false;
  const { gladys, app } = await createWorld({ printers: [printer] });
  t.after(() => app.stop());
  const unknown = await gladys.fake.sceneAction('set_light', {
    device: deviceId('01S00A999999999'),
    state: 'on',
  });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /plus configurée/);
  const off = await gladys.fake.sceneAction('set_light', {
    device: deviceId(printer.serial),
    state: 'on',
  });
  assert.equal(off.success, false);
  assert.match(off.error, /ne répond pas/);
});
