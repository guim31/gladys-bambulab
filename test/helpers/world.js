// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys (a real GladysIntegration on an
// in-memory transport), the integration wired on it by registerHandlers, and
// fake printers on a fake network. Store under a temporary folder.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { ACCESS_CODE, FakePrinter, network, settle } from './fakePrinter.js';

export const FAST_TIMINGS = {
  retryDelay: 30,
  retryMax: 60,
  unauthorizedDelay: 60_000,
  silence: 60_000,
  commandReply: 200,
  failedGrace: 30,
  pushallGap: 0,
  keepalive: 60,
  connectTimeout: 500,
  cameraTimeout: 500,
};

export const FAST_HUB = {
  stateGap: 0,
  cameraInterval: 60_000,
  versionWait: 50,
  searchGap: 60_000,
  searchSeconds: 1,
};

/** The configuration of these printers, slot by slot. */
export function configFor(printers, extra = {}) {
  return {
    ...Object.fromEntries(
      printers.flatMap((printer, index) => [
        [`serial_${index + 1}`, printer.serial],
        [`host_${index + 1}`, printer.host],
        [`access_code_${index + 1}`, ACCESS_CODE],
      ]),
    ),
    ...extra,
  };
}

/**
 * @param {object} [options]
 * @param {FakePrinter[]} [options.printers] (default: one P1P with an AMS)
 * @param {object} [options.config] integration config (default: every printer, in order)
 */
export async function createWorld({
  printers,
  config,
  devices = [],
  scanResults = {},
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'bambulab-test-')),
  timings = FAST_TIMINGS,
  hubTimings = FAST_HUB,
  now,
} = {}) {
  const fakes = printers ?? [new FakePrinter()];
  const net = network(...fakes);
  const gladys = createFakeGladys({
    config: config ?? configFor(fakes),
    devices,
    scanResults,
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    connect: net.connect,
    timings,
    hubTimings,
    now,
  });
  if (connect) {
    await gladys.connect();
    await settle(100);
  }
  return { gladys, app, hub: app.hub, printers: fakes, dataDir };
}

export const deviceId = (serial) => `ext:test-integration:printer:${serial}`;
export const featureId = (serial, key) => `${deviceId(serial)}:${key}`;

/** Marks the devices as added in Gladys (as the user would). */
export async function addDevices(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
  }
  await settle();
}
