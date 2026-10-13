// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (real reports collected by ha-bambulab): an X1 Carbon with three
// AMS and an AMS HT, an H2D printing with two AMS 2 Pro, a P1P with an AMS,
// an A1 with an AMS lite, a P1P without AMS — three at once, in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakePrinter } from './helpers/fakePrinter.js';
import { addDevices, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const FLEETS = [
  ['x1c-multi-ams', 'h2d-dual-ams', 'p1p-ams'],
  ['a1-ams-lite', 'p1p-no-ams'],
];

const scenarios = [
  { label: 'default language (French)', language: undefined },
  { label: 'English names', language: 'en' },
  { label: 'German names', language: 'de' },
  { label: 'Spanish names', language: 'es' },
];

const PUSH_KEYS = new Set(['pause', 'resume']);

for (const fleet of FLEETS) {
  for (const scenario of scenarios) {
    test(`every device follows the Gladys rules: ${fleet.join(', ')} (${scenario.label})`, async () => {
      const printers = fleet.map(
        (fixture, index) => new FakePrinter({ fixture, host: `192.0.2.${20 + index}` }),
      );
      const config = Object.fromEntries(
        printers.flatMap((printer, index) => [
          [`serial_${index + 1}`, printer.serial],
          [`host_${index + 1}`, printer.host],
          [`access_code_${index + 1}`, printer.accessCode],
        ]),
      );
      if (scenario.language) {
        config.language = scenario.language;
      }
      const { gladys, app } = await createWorld({ printers, config });
      try {
        await addDevices(gladys);
        const devices = gladys.fake.discoveredDevices;
        assert.equal(devices.length, fleet.length, 'one device per printer');

        for (const device of devices) {
          const where = device.name;

          // should_poll: true if and only if poll_frequency is provided, in ms.
          if (device.poll_frequency === undefined) {
            assert.notEqual(
              device.should_poll,
              true,
              `${where}: should_poll without poll_frequency`,
            );
          } else {
            assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
            assert.ok(
              table.poll_frequencies_ms.includes(device.poll_frequency),
              `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
            );
          }

          assert.ok(device.features.length > 0, `${where}: no feature`);
          const externalIds = new Set();
          const names = new Set();
          for (const feature of device.features) {
            const at = `${where} / ${feature.name}`;
            const pair = table.pairs[`${feature.category}/${feature.type}`];
            assert.ok(
              pair,
              `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
            );
            assert.ok(
              pair.label_en && pair.label_fr && pair.icon,
              `${at}: couple without label or icon`,
            );

            assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
            assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
            assert.ok(
              Number.isFinite(feature.min) && Number.isFinite(feature.max),
              `${at}: finite min/max`,
            );
            assert.ok(feature.min <= feature.max, `${at}: min > max`);
            assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
            assert.equal(
              typeof feature.has_feedback,
              'boolean',
              `${at}: has_feedback must be a boolean`,
            );
            if (feature.unit !== undefined) {
              assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
            }

            assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
            externalIds.add(feature.external_id);
            assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
            names.add(feature.name);

            // Options: string values on text/select only, unique, labelled.
            const isSelect = feature.category === 'text' && feature.type === 'select';
            if (feature.supported_options !== undefined) {
              assert.ok(isSelect, `${at}: string options belong to text/select features only`);
              assert.ok(feature.supported_options.length > 0, `${at}: no option`);
              const values = feature.supported_options.map((option) => option.value);
              assert.equal(new Set(values).size, values.length, `${at}: duplicate option values`);
              for (const option of feature.supported_options) {
                assert.ok(typeof option.value === 'string' && option.value.trim(), `${at}: value`);
                assert.ok(typeof option.label === 'string' && option.label.trim(), `${at}: label`);
                assert.ok(Number.isInteger(option.sort_order), `${at}: sort_order`);
              }
            } else {
              assert.ok(!isSelect, `${at}: a select without options`);
            }

            // The value published from the fixtures fits the feature.
            const key = feature.external_id.slice(device.external_id.length + 1);
            const value = gladys.fake.lastState(feature.external_id);
            if (PUSH_KEYS.has(key) || feature.category === 'camera') {
              assert.equal(value, undefined, `${at}: no state expected`);
            } else if (feature.category === 'text') {
              assert.equal(typeof value, 'string', `${at}: a text state`);
              assert.ok(value.length > 0 && value.length <= 200, `${at}: text of ${value.length}`);
              if (isSelect) {
                assert.ok(
                  feature.supported_options.some((option) => option.value === value),
                  `${at}: ${value} is not one of the options`,
                );
              }
            } else {
              assert.equal(typeof value, 'number', `${at}: ${value} is not a number`);
              assert.ok(
                value >= feature.min && value <= feature.max,
                `${at}: ${value} out of bounds`,
              );
              assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
            }
          }
        }
      } finally {
        await app.stop();
      }
    });
  }
}
