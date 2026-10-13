// -----------------------------------------------------------------------------
// Texts of the HMS codes (Health Management System) and print errors.
//
// The tables are those of ha-bambulab (pybambu/hms_error_text, MIT), built
// from the error lists Bambu Lab publishes: `device_hms` keyed by the 16 hex
// digits of an HMS code, `device_error` by the 8 of a `print_error`, each
// message listing the models it is specific to (none: every model).
// One gzipped JSON per language (about 1 MB once read): loaded on the first
// error to explain, then kept.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'bambulab-hms' });

const tables = new Map();

function table(language) {
  if (!tables.has(language)) {
    let data = {};
    try {
      const file = new URL(`./hms/hms_${language}.json.gz`, import.meta.url);
      data = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
    } catch (err) {
      logger.warn(`Cannot read the ${language} HMS texts: ${err.message}`);
    }
    tables.set(language, data);
  }
  return tables.get(language);
}

function lookup(kind, code, model, language) {
  const key = String(code ?? '')
    .replace(/_/g, '')
    .toUpperCase();
  if (!key) {
    return null;
  }
  for (const lang of language === 'en' ? ['en'] : [language, 'en']) {
    const entry = table(lang)[kind]?.[key];
    if (!entry) {
      continue;
    }
    const messages = Object.entries(entry);
    const specific = messages.find(([, models]) => model && models.includes(model));
    const general = messages.find(([, models]) => models.length === 0);
    const message = (specific ?? general ?? messages[0])?.[0];
    if (message) {
      return message;
    }
  }
  return null;
}

/** The text of an HMS code (`0300_0100_0001_0007`), or null when unknown. */
export function hmsText(code, model, language) {
  return lookup('device_hms', code, model, language);
}

/** The text of a print error (`0300_400C`), or null when unknown. */
export function printErrorText(code, model, language) {
  return lookup('device_error', code, model, language);
}
