import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, normalizeHost, normalizeSerial } from '../src/config.js';

test('defaults: French, camera on, certificate checked, nothing configured', () => {
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), {
    printers: [],
    problems: [],
    camera: true,
    checkCertificate: true,
    language: 'fr',
  });
  assert.equal(normalizeConfig(null).language, 'fr');
});

test('a printer: serial upper-cased, address cleaned, code kept as typed', () => {
  const config = normalizeConfig({
    serial_2: ' 01p00a 000000001 ',
    host_2: 'http://192.0.2.10:8883/',
    access_code_2: ' 12345678 ',
    camera: 'false',
    check_certificate: false,
    language: 'es',
  });
  assert.deepEqual(config.printers, [
    { slot: 2, serial: '01P00A000000001', host: '192.0.2.10', accessCode: '12345678' },
  ]);
  assert.equal(config.camera, false);
  assert.equal(config.checkCertificate, false);
  assert.equal(config.language, 'es');
});

test('problems are named per slot; the same printer twice is refused', () => {
  const config = normalizeConfig({
    serial_1: '01P00A000000001',
    access_code_1: '12345678',
    serial_2: '01P00A000000001',
    access_code_2: '12345678',
    serial_3: '01P00A000000002',
    host_3: 'not a host!',
    access_code_3: '12345678',
  });
  assert.deepEqual(
    config.printers.map((p) => p.slot),
    [1],
  );
  assert.deepEqual(config.problems, [
    { slot: 2, reason: 'duplicate' },
    { slot: 3, reason: 'host' },
  ]);
});

test('hosts and serials', () => {
  assert.equal(normalizeHost(''), '');
  assert.equal(normalizeHost('p1s.local'), 'p1s.local');
  assert.equal(normalizeHost('192.0.2.300'), null);
  assert.equal(normalizeHost('1.2.3'), null);
  assert.equal(normalizeSerial('abc'), null);
  assert.equal(normalizeSerial('ABCDEFGHIJ'), null, 'a serial always has digits');
  assert.equal(normalizeSerial('00m09c000000001'), '00M09C000000001');
});
