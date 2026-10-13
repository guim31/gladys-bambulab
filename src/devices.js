// -----------------------------------------------------------------------------
// Bambu Lab printer -> Gladys device, and snapshot -> feature states.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js),
// the same as gladys-octoprint where they overlap:
// - state, task, errors: text/text (several of them: the dashboard then shows
//   their names);
// - progress: level-sensor/liquid-level-percent, the only read-only percent
//   couple with a label;
// - time left: duration/integer in minutes (duration/decimal is a slider);
// - layer, total layers: counter-sensor/integer (a scene can test "layer > 3");
// - temperatures and their targets: device-temperature-sensor/decimal, read
//   only. Not temperature-sensor: Gladys averages those of a room into its
//   room temperature, a 220 °C nozzle would skew it. Not thermostat: a heater
//   must never be settable from the dashboard, HomeKit, Alexa or Google (fire
//   risk); this integration does not heat at all;
// - speed: text/select (silent, standard, sport, ludicrous);
// - chamber light: switch/binary, not light/binary: "turn off every light"
//   must not plunge a print (and its timelapse) into the dark;
// - pause, resume: button/push. Cancelling is not a device button (one tap, no
//   confirmation, a ruined print): the widget (with a confirmation) and the
//   scenes offer it;
// - camera: camera/image, for the P1 and A1 series (JPEG stream of port 6000).
//
// Feature keys are forever: `nozzle_target`, never renamed.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS as UNIT,
} from '@gladysassistant/integration-sdk';
import { MODELS, SPEEDS } from './bambu/model.js';
import { hmsText } from './bambu/hms.js';
import {
  MORE_ERRORS,
  NAMES,
  NO_ERROR,
  NO_FILE,
  SPEED_LABELS,
  STATE_LABELS,
  UNKNOWN_ERROR,
} from './texts.js';

export const DEVICE_TYPE = 'printer';

// Display bounds of the features.
export const LIMITS = { nozzle: 350, bed: 130, chamber: 80 };
const MAX_MINUTES = 100_000; // about 70 days
const MAX_LAYERS = 100_000;

export const COMMAND_KEYS = ['pause', 'resume'];

export function deviceIds(gladys, serial) {
  return gladys.externalIds(DEVICE_TYPE, serial);
}

/** Heaters a printer publishes, with their target or not. */
export function heatersOf(capabilities) {
  const heaters = [
    { key: 'nozzle', target: true },
    { key: 'bed', target: true },
  ];
  if (capabilities.chamber) {
    heaters.push({ key: 'chamber', target: capabilities.chamberHeater });
  }
  return heaters;
}

export function modelLabel(model) {
  return MODELS[model] ? `Bambu Lab ${MODELS[model].label}` : 'Bambu Lab';
}

export function defaultName(printer) {
  return (printer.name || modelLabel(printer.capabilities?.model)).slice(0, 60);
}

export function speedOptions(language) {
  const labels = SPEED_LABELS[language] ?? SPEED_LABELS.en;
  return Object.values(SPEEDS).map((value, index) => ({
    value,
    label: labels[value],
    sort_order: index,
  }));
}

/**
 * @param {object} gladys
 * @param {{ serial: string, host: string, name?: string, capabilities: object }} printer
 * @param {string} language
 * @param {{ camera: boolean }} options
 */
export function buildDevice(gladys, printer, language, { camera = true } = {}) {
  const { serial, capabilities } = printer;
  const names = NAMES[language] ?? NAMES.en;
  const ids = deviceIds(gladys, serial);
  const feature = (key, name, fields) => ({
    name,
    external_id: ids.feature(key),
    read_only: true,
    has_feedback: false,
    ...fields,
  });
  const text = { category: CAT.TEXT, type: TYPE.TEXT.TEXT, min: 0, max: 0 };
  const layers = {
    category: CAT.COUNTER_SENSOR,
    type: TYPE.SENSOR.INTEGER,
    min: 0,
    max: MAX_LAYERS,
  };

  const features = [
    feature('state', names.state, text),
    feature('task', names.task, text),
    feature('progress', names.progress, {
      category: CAT.LEVEL_SENSOR,
      type: TYPE.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
      unit: UNIT.PERCENT,
      min: 0,
      max: 100,
    }),
    feature('time_left', names.time_left, {
      category: CAT.DURATION,
      type: TYPE.DURATION.INTEGER,
      unit: UNIT.MINUTES,
      min: 0,
      max: MAX_MINUTES,
    }),
    feature('layer', names.layer, layers),
    feature('total_layers', names.total_layers, layers),
  ];

  for (const heater of heatersOf(capabilities)) {
    const label = names[heater.key];
    const temperature = {
      category: CAT.DEVICE_TEMPERATURE_SENSOR,
      type: TYPE.SENSOR.DECIMAL,
      unit: UNIT.CELSIUS,
      min: 0,
      max: LIMITS[heater.key],
    };
    features.push(feature(`${heater.key}_temperature`, label, temperature));
    if (heater.target) {
      features.push(
        feature(`${heater.key}_target`, `${label} (${names.target})`, { ...temperature }),
      );
    }
  }

  features.push(
    feature('speed', names.speed, {
      category: CAT.TEXT,
      type: TYPE.TEXT.SELECT,
      min: 0,
      max: 0,
      read_only: false,
      has_feedback: true,
      supported_options: speedOptions(language),
    }),
  );
  if (capabilities.light) {
    features.push(
      feature('light', names.light, {
        category: CAT.SWITCH,
        type: TYPE.SWITCH.BINARY,
        min: 0,
        max: 1,
        read_only: false,
        has_feedback: true,
      }),
    );
  }
  for (const key of COMMAND_KEYS) {
    features.push(
      feature(key, names[key], {
        category: CAT.BUTTON,
        type: TYPE.BUTTON.PUSH,
        min: 0,
        max: 1,
        read_only: false,
      }),
    );
  }
  features.push(feature('errors', names.errors, text));
  if (capabilities.camera && camera) {
    features.push(
      feature('camera', names.camera, {
        category: CAT.CAMERA,
        type: TYPE.CAMERA.IMAGE,
        min: 0,
        max: 0,
      }),
    );
  }

  return {
    name: defaultName(printer),
    external_id: ids.device,
    model: modelLabel(capabilities.model),
    should_poll: false,
    features,
    params: [
      { name: 'SERIAL_NUMBER', value: serial },
      { name: 'IP_ADDRESS', value: printer.host || '' },
    ],
  };
}

/** The `errors` text: the first HMS error and how many others, or "No error". */
export function errorsText(snapshot, model, language) {
  const entries = snapshot.hms;
  if (entries.length === 0) {
    return (NO_ERROR[language] ?? NO_ERROR.en).slice(0, 200);
  }
  const [first] = entries;
  const message = hmsText(first.code, model, language) ?? UNKNOWN_ERROR[language];
  const more =
    entries.length > 1 ? ` ${(MORE_ERRORS[language] ?? MORE_ERRORS.en)(entries.length - 1)}` : '';
  const head = `${first.code}: `;
  const room = 200 - head.length - more.length;
  return `${head}${message.length > room ? `${message.slice(0, room - 1)}…` : message}${more}`;
}

const round = (value) => (value === null || value === undefined ? null : Math.round(value));

/**
 * Feature states of a snapshot, in the publishStates format. Temperatures in
 * whole degrees and times in whole minutes: the printer reports every second
 * and Gladys takes 300 states a minute for the whole integration. Unknown
 * values are left out (Gladys keeps the last one).
 */
export function buildStates(gladys, printer, snapshot, language) {
  const { serial, capabilities } = printer;
  const ids = deviceIds(gladys, serial);
  const states = [];
  const add = (key, value) => {
    if (value !== null && value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state: value });
    }
  };
  const addText = (key, value) => {
    states.push({
      device_feature_external_id: ids.feature(key),
      text: String(value).slice(0, 200),
    });
  };

  addText('state', (STATE_LABELS[language] ?? STATE_LABELS.en)[snapshot.state]);
  if (['connecting', 'unreachable', 'unauthorized'].includes(snapshot.state)) {
    // Nothing reported: everything else keeps its last value.
    return states;
  }
  const task = snapshot.task || snapshot.file.split('/').at(-1) || '';
  addText('task', task || (NO_FILE[language] ?? NO_FILE.en));
  add('progress', snapshot.percent === null ? null : Math.round(snapshot.percent));
  add('time_left', snapshot.remaining === null ? null : Math.round(snapshot.remaining));
  add('layer', snapshot.layer);
  add('total_layers', snapshot.totalLayers);
  for (const heater of heatersOf(capabilities)) {
    const reading = snapshot[heater.key];
    add(`${heater.key}_temperature`, round(reading.actual));
    if (heater.target) {
      add(`${heater.key}_target`, round(reading.target));
    }
  }
  if (snapshot.speed !== null) {
    addText('speed', SPEEDS[snapshot.speed]);
  }
  if (capabilities.light && snapshot.light !== null) {
    add('light', snapshot.light === 'on' ? 1 : 0);
  }
  addText('errors', errorsText(snapshot, capabilities.model, language));
  return states;
}

/** `ext:...:printer:01P00A...` -> the serial number, or null when not ours. */
export function serialOf(gladys, externalId) {
  const prefix = gladys.externalId(`${DEVICE_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

/** The feature key of a feature external id (`...:printer:<serial>:nozzle_target` -> `nozzle_target`). */
export function featureKeyOf(externalId) {
  return typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
}
