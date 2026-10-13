// -----------------------------------------------------------------------------
// Finding the printers on the network.
//
// A Bambu Lab printer announces itself every few seconds with an SSDP NOTIFY
// (`NT: urn:bambulab-com:device:3dprinter:1`), sent in UDP broadcast to port
// 2021 (Bambu Studio listens there) and to port 1990. It does not answer an
// M-SEARCH, so the `ssdp` scan of Gladys (an M-SEARCH on 1900) finds nothing:
// the `udp-broadcast` capture of the core listens on the declared ports
// instead (manifest `network_discovery`). The container itself, on a Docker
// bridge, never sees a broadcast.
//
// An announcement:
//   NOTIFY * HTTP/1.1
//   Location: 192.0.2.40
//   NT: urn:bambulab-com:device:3dprinter:1
//   USN: 01P00A000000001
//   DevModel.bambu.com: C12
//   DevName.bambu.com: Workshop P1S
//   DevConnect.bambu.com: lan
//   DevBind.bambu.com: free
//   DevVersion.bambu.com: 01.08.02.00
// -----------------------------------------------------------------------------

import { modelFromCode } from './model.js';

export const DISCOVERY_PORTS = [1990, 2021];
export const BAMBU_NT = 'urn:bambulab-com:device:3dprinter:1';

const SERIAL = /^[0-9A-Z]{8,20}$/;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function headers(text) {
  const result = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const index = line.indexOf(':');
    if (index > 0) {
      result[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
    }
  }
  return result;
}

/**
 * One announcement -> { serial, host, model, name, mode, firmware }, or null
 * when the datagram is not a Bambu Lab printer.
 * @param {string} text
 * @param {string} sourceIp the sender, used when `Location` is missing or odd
 */
export function parseAnnouncement(text, sourceIp) {
  if (typeof text !== 'string' || !/^NOTIFY |^HTTP\/1\.1 200/i.test(text)) {
    return null;
  }
  const fields = headers(text);
  const type = fields.nt ?? fields.st ?? '';
  if (!type.toLowerCase().startsWith('urn:bambulab-com:device:3dprinter')) {
    return null;
  }
  const serial = (fields.usn ?? '').trim().toUpperCase();
  if (!SERIAL.test(serial)) {
    return null;
  }
  const location = (fields.location ?? '').trim();
  const host = IPV4.test(location) ? location : sourceIp;
  if (!IPV4.test(host ?? '')) {
    return null;
  }
  const code = fields['devmodel.bambu.com'] ?? '';
  return {
    serial,
    host,
    model: modelFromCode(code),
    name: (fields['devname.bambu.com'] ?? '').slice(0, 60),
    // `lan` once "LAN only" is on in the printer settings, `cloud` otherwise.
    mode: (fields['devconnect.bambu.com'] ?? '').toLowerCase(),
    firmware: fields['devversion.bambu.com'] ?? '',
  };
}

/**
 * The raw results of `scanNetwork('udp-broadcast')` -> one entry per printer
 * (the last announcement wins).
 * @param {{ source_ip: string, payload_base64: string }[]} results
 */
export function printersFromScan(results) {
  const found = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    if (typeof result?.payload_base64 !== 'string') {
      continue;
    }
    const text = Buffer.from(result.payload_base64, 'base64').toString('utf8');
    const printer = parseAnnouncement(text, result.source_ip);
    if (printer) {
      found.set(printer.serial, printer);
    }
  }
  return [...found.values()];
}
