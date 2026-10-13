// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three printers, one "slot" each (`host_1`, `serial_1`,
// `access_code_1`...). The serial number is the identity of the Gladys
// device: a new IP address, or moving a printer to another slot, keeps its
// device and its history.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

export const DEFAULT_CONFIG = {
  host_1: '',
  serial_1: '',
  access_code_1: '',
  host_2: '',
  serial_2: '',
  access_code_2: '',
  host_3: '',
  serial_3: '',
  access_code_3: '',
  camera: true,
  check_certificate: true,
  language: 'fr',
};

export const hostKey = (slot) => `host_${slot}`;
export const serialKey = (slot) => `serial_${slot}`;
export const accessCodeKey = (slot) => `access_code_${slot}`;

// 15 characters today (01P00A..., 00M09C...), always with digits.
const SERIAL = /^(?=.*\d)[0-9A-Z]{8,20}$/;
// The LAN access code shown on the printer screen: 8 characters today.
const ACCESS_CODE = /^[\x21-\x7e]{4,32}$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** `192.0.2.40`, `p1s.local`; a URL or a port is cut down to its host. Null when unusable. */
export function normalizeHost(raw) {
  let host = text(raw);
  if (host === '') {
    return '';
  }
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/:].*$/, '');
  return IPV4.test(host) || (HOSTNAME.test(host) && !/^\d+(\.\d+)*$/.test(host)) ? host : null;
}

export function normalizeSerial(raw) {
  const serial = text(raw).replace(/\s+/g, '').toUpperCase();
  return SERIAL.test(serial) ? serial : null;
}

const toBoolean = (value, fallback) => {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  return fallback;
};

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 * @returns {{
 *   printers: { slot: number, serial: string, host: string, accessCode: string }[],
 *   problems: { slot: number, reason: 'serial' | 'host' | 'access_code' | 'duplicate' }[],
 *   camera: boolean, checkCertificate: boolean, language: string
 * }}
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const printers = [];
  const problems = [];
  for (const slot of SLOTS) {
    const serialText = text(source[serialKey(slot)]);
    const hostText = text(source[hostKey(slot)]);
    const accessCode = text(source[accessCodeKey(slot)]);
    if (serialText === '' && hostText === '' && accessCode === '') {
      continue;
    }
    const serial = normalizeSerial(serialText);
    const host = normalizeHost(hostText);
    if (!serial) {
      problems.push({ slot, reason: 'serial' });
    } else if (host === null) {
      problems.push({ slot, reason: 'host' });
    } else if (!ACCESS_CODE.test(accessCode)) {
      problems.push({ slot, reason: 'access_code' });
    } else if (printers.some((printer) => printer.serial === serial)) {
      problems.push({ slot, reason: 'duplicate' });
    } else {
      printers.push({ slot, serial, host, accessCode });
    }
  }
  return {
    printers,
    problems,
    camera: toBoolean(source.camera, DEFAULT_CONFIG.camera),
    checkCertificate: toBoolean(source.check_certificate, DEFAULT_CONFIG.check_certificate),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
