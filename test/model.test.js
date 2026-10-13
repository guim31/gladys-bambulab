// -----------------------------------------------------------------------------
// Reading the reports: real full statuses of several models (ha-bambulab
// test data), the deltas of the P1 and A1 series, the codes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTray,
  applyPrint,
  emptySnapshot,
  hmsCode,
  hmsSeverity,
  modelFromCode,
  modelFromSerial,
  printErrorCode,
  readCapabilities,
  readSignatureRequired,
  readVersion,
  sameStructure,
} from '../src/bambu/model.js';
import { hmsText, printErrorText } from '../src/bambu/hms.js';
import { report } from './helpers/fakePrinter.js';

const read = (name) => {
  const data = report(name);
  return {
    snapshot: applyPrint(emptySnapshot(), data.print),
    version: readVersion(data.info),
    data,
  };
};

test('the model comes from get_version, old and new firmwares alike', () => {
  assert.deepEqual(read('x1c-multi-ams').version.model, 'X1C');
  assert.deepEqual(read('h2d-dual-ams').version.model, 'H2D');
  assert.deepEqual(read('p1p-ams').version, { model: 'P1P', firmware: '01.07.00.00' });
  assert.deepEqual(read('p1p-no-ams').version.model, 'P1P');
  assert.deepEqual(read('a1-ams-lite').version.model, 'A1');
  assert.deepEqual(readVersion({}), { model: null, firmware: '' });
  assert.equal(modelFromSerial('01P00A000000001'), 'P1S');
  assert.equal(modelFromSerial('ZZZ'), null);
  assert.equal(modelFromCode('3DPrinter-X1-Carbon'), 'X1C');
  assert.equal(modelFromCode('N1'), 'A1MINI');
});

test('a full X1C status: finished print, three AMS, chamber, light, Authorization Control', () => {
  const { snapshot } = read('x1c-multi-ams');
  assert.equal(snapshot.state, 'finished');
  assert.equal(snapshot.percent, 100);
  assert.equal(snapshot.layer, 480);
  assert.equal(snapshot.task, 'Hose fitting');
  assert.deepEqual(snapshot.bed, { actual: 23, target: 0 });
  assert.equal(snapshot.chamber.actual, 25, 'the packed device.ctc value');
  assert.equal(snapshot.light, 'on');
  assert.equal(snapshot.signatureRequired, true);
  assert.equal(snapshot.ams.length, 4);
  assert.deepEqual(snapshot.ams[0].trays[0], {
    id: 0,
    type: 'PLA',
    name: 'PLA Matte',
    color: '000000',
    remain: 93,
  });
  assert.deepEqual(snapshot.ams[2].trays[0], { id: 0, empty: true });
  assert.equal(snapshot.external, null, 'no spool on the external holder');
});

test('a full H2D status: packed temperatures of the active nozzle', () => {
  const { snapshot } = read('h2d-dual-ams');
  assert.equal(snapshot.state, 'printing');
  assert.deepEqual(snapshot.bed, { actual: 70, target: 70 });
  assert.equal(snapshot.nozzle.actual, 245);
  assert.equal(snapshot.remaining, 549);
  assert.deepEqual(activeTray(snapshot), { unit: 0, tray: 3 });
});

test('the P1 and A1: no chamber sensor, a camera, the external spool', () => {
  const p1 = read('p1p-no-ams');
  assert.deepEqual(p1.snapshot.external, { type: 'PETG', name: '', color: 'BCBCBC', remain: null });
  assert.deepEqual(activeTray(p1.snapshot), { external: true });
  const capabilities = readCapabilities({ ...p1.version, snapshot: p1.snapshot });
  assert.deepEqual(capabilities, {
    model: 'P1P',
    firmware: '01.08.02.00',
    camera: true,
    chamber: false,
    chamberHeater: false,
    light: true,
  });
  const a1 = read('a1-ams-lite');
  assert.equal(a1.snapshot.state, 'idle');
  assert.equal(a1.snapshot.ams[0].trays[0].color, '76D9F4');
  assert.equal(a1.snapshot.ams[0].trays[0].remain, 100);
});

test('deltas: a missing field keeps its value, partial trays keep their spool', () => {
  const { snapshot } = read('x1c-multi-ams');
  const next = applyPrint(snapshot, {
    nozzle_temper: 200.5,
    ams: { ams: [{ id: '0', tray: [{ id: '0', remain: 50 }] }], tray_now: '1' },
  });
  assert.equal(next.nozzle.actual, 200.5);
  assert.equal(next.state, 'finished');
  assert.equal(next.layer, 480);
  assert.deepEqual(next.ams[0].trays[0], {
    id: 0,
    type: 'PLA',
    name: 'PLA Matte',
    color: '000000',
    remain: 50,
  });
  assert.equal(next.ams.length, 4, 'the other units are kept');
  assert.deepEqual(activeTray(next), { unit: 0, tray: 1 });
  assert.equal(snapshot.nozzle.actual, 26, 'the previous snapshot is untouched');
  // An emptied slot.
  const emptied = applyPrint(next, {
    ams: { ams: [{ id: '0', tray: [{ id: '0', tray_type: '' }] }] },
  });
  assert.deepEqual(emptied.ams[0].trays[0], { id: 0, empty: true });
});

test('states: every gcode_state, unknown ones included', () => {
  const state = (gcode) => applyPrint(emptySnapshot(), { gcode_state: gcode }).state;
  assert.equal(state('IDLE'), 'idle');
  assert.equal(state('PREPARE'), 'preparing');
  assert.equal(state('SLICING'), 'preparing');
  assert.equal(state('RUNNING'), 'printing');
  assert.equal(state('PAUSE'), 'paused');
  assert.equal(state('FINISH'), 'finished');
  assert.equal(state('FAILED'), 'failed');
  assert.equal(state('WHATEVER'), 'unknown');
  assert.equal(applyPrint(emptySnapshot(), { spd_lvl: 9 }).speed, null);
  assert.equal(applyPrint(emptySnapshot(), { spd_lvl: 4 }).speed, 4);
  assert.equal(applyPrint(emptySnapshot(), null).state, 'connecting');
});

test('codes: HMS, print errors, Authorization Control flag', () => {
  assert.equal(hmsCode(50331904, 65543), '0300_0100_0001_0007');
  assert.equal(hmsCode(0, 65543), null);
  assert.equal(hmsSeverity(65543), 'fatal');
  assert.equal(hmsSeverity(0x40001), 'info');
  assert.equal(printErrorCode(50348044), '0300_400C');
  assert.equal(printErrorCode(117473286), '0700_8006');
  assert.equal(printErrorCode(0), null);
  assert.equal(readSignatureRequired('3EC1AFFF9CFF'), true);
  assert.equal(readSignatureRequired('3EC18FFF9CFF'), false);
  assert.equal(readSignatureRequired('zz'), null);
  const hms = applyPrint(emptySnapshot(), {
    hms: [
      { attr: 50331904, code: 65543 },
      { attr: 50331904, code: 65543 },
      { attr: 0, code: 0 },
    ],
  }).hms;
  assert.deepEqual(hms, [{ code: '0300_0100_0001_0007', severity: 'fatal' }]);
});

test('texts of the HMS codes in the four languages, English as a fallback', () => {
  assert.match(hmsText('0300_0100_0001_0007', 'X1C', 'en'), /heatbed/i);
  assert.match(hmsText('0300_0100_0001_0007', 'X1C', 'fr'), /plateau/i);
  assert.match(hmsText('0300010000010007', 'X1C', 'es'), /cama/i);
  // A model-specific message wins over the general one.
  assert.match(hmsText('0300_0200_0001_0001', 'H2D', 'en'), /right nozzle/);
  assert.doesNotMatch(hmsText('0300_0200_0001_0001', 'P1S', 'en'), /right nozzle/);
  assert.equal(printErrorText('0300_400C', 'P1P', 'en'), 'The task was canceled.');
  assert.equal(hmsText('FFFF_FFFF_FFFF_FFFF', 'P1P', 'de'), null);
});

test('structure: same features, no "Update" in Gladys', () => {
  const a = {
    model: 'P1P',
    firmware: '1',
    camera: true,
    chamber: false,
    chamberHeater: false,
    light: true,
  };
  assert.ok(sameStructure(a, { ...a, firmware: '2' }));
  assert.ok(!sameStructure(a, { ...a, light: false }));
  assert.ok(!sameStructure(null, a));
  // What was known stays: a first report without lights_report keeps the light.
  const kept = readCapabilities({
    model: null,
    firmware: '',
    snapshot: emptySnapshot(),
    previous: a,
  });
  assert.ok(sameStructure(kept, a));
});
