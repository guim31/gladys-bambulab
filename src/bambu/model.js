// -----------------------------------------------------------------------------
// Reading what a Bambu Lab printer reports into a snapshot.
//
// The printer publishes JSON on `device/<serial>/report`. `{"print": {...}}`
// carries the status: the X1 series sends the whole status every time, the P1
// and A1 series only the fields that changed (a full one answers `pushall`).
// So a snapshot is updated field by field, a missing field keeps its value.
// `{"info": {"command": "get_version", "module": [...]}}` names the model and
// the firmware.
//
// Field meanings come from ha-bambulab (pybambu/models.py, MIT), and its test
// fixtures (real reports) are the base of test/fixtures/reports.
// -----------------------------------------------------------------------------

/**
 * Models, by the code ha-bambulab uses (and the HMS tables). `camera`: the
 * JPEG stream of port 6000 (P1, A1); `chamber`: a real chamber sensor (the
 * P1 and A1 report a meaningless `chamber_temper`); `chamberHeater`: an
 * active chamber heater with a target.
 */
export const MODELS = {
  X1C: { label: 'X1 Carbon', camera: false, chamber: true, chamberHeater: false },
  X1: { label: 'X1', camera: false, chamber: true, chamberHeater: false },
  X1E: { label: 'X1E', camera: false, chamber: true, chamberHeater: true },
  P1P: { label: 'P1P', camera: true, chamber: false, chamberHeater: false },
  P1S: { label: 'P1S', camera: true, chamber: false, chamberHeater: false },
  P2S: { label: 'P2S', camera: false, chamber: true, chamberHeater: false },
  A1: { label: 'A1', camera: true, chamber: false, chamberHeater: false },
  A1MINI: { label: 'A1 mini', camera: true, chamber: false, chamberHeater: false },
  A2L: { label: 'A2L', camera: true, chamber: false, chamberHeater: false },
  H2D: { label: 'H2D', camera: false, chamber: true, chamberHeater: true },
  H2DPRO: { label: 'H2D Pro', camera: false, chamber: true, chamberHeater: true },
  H2S: { label: 'H2S', camera: false, chamber: true, chamberHeater: true },
  H2C: { label: 'H2C', camera: false, chamber: true, chamberHeater: true },
  X2D: { label: 'X2D', camera: false, chamber: true, chamberHeater: true },
};

// `DevModel.bambu.com` of the announcements, `project_name` of get_version.
const MODEL_CODES = {
  '3DPRINTER-X1-CARBON': 'X1C',
  '3DPRINTER-X1': 'X1',
  'BL-P001': 'X1C',
  'BL-P002': 'X1',
  C11: 'P1P',
  C12: 'P1S',
  C13: 'X1E',
  N1: 'A1MINI',
  N2S: 'A1',
  N7: 'P2S',
  O1D: 'H2D',
  O1E: 'H2DPRO',
  O1S: 'H2S',
  O1C: 'H2C',
  O1C2: 'H2C',
};

// `product_name` of the get_version modules (recent firmwares).
const PRODUCT_NAMES = {
  'Bambu Lab X1-Carbon': 'X1C',
  'Bambu Lab X1 Carbon': 'X1C',
  'Bambu Lab X1': 'X1',
  'Bambu Lab X1E': 'X1E',
  'Bambu Lab P1P': 'P1P',
  'Bambu Lab P1S': 'P1S',
  'Bambu Lab P2S': 'P2S',
  'Bambu Lab A1': 'A1',
  'Bambu Lab A1 mini': 'A1MINI',
  'Bambu Lab A2L': 'A2L',
  'Bambu Lab H2D': 'H2D',
  'Bambu Lab H2D Pro': 'H2DPRO',
  'Bambu Lab H2S': 'H2S',
  'Bambu Lab H2C': 'H2C',
  'Bambu Lab X2D': 'X2D',
};

// The first three characters of the serial number, for the models whose
// prefix is well known (a fallback when get_version says nothing useful).
const SERIAL_PREFIXES = {
  '00M': 'X1C',
  '00W': 'X1',
  '03W': 'X1E',
  '01S': 'P1P',
  '01P': 'P1S',
  '030': 'A1MINI',
  '039': 'A1',
  '094': 'H2D',
};

export function modelFromCode(code) {
  const key = String(code ?? '').toUpperCase();
  return Object.hasOwn(MODEL_CODES, key) ? MODEL_CODES[key] : null;
}

export function modelFromSerial(serial) {
  const prefix = String(serial ?? '').slice(0, 3);
  return Object.hasOwn(SERIAL_PREFIXES, prefix) ? SERIAL_PREFIXES[prefix] : null;
}

/** The get_version `module` list -> { model, firmware }. */
export function readVersion(info) {
  const modules = Array.isArray(info?.module) ? info.module : [];
  let model = null;
  for (const module of modules) {
    const name = module?.product_name;
    model ??=
      typeof name === 'string' && Object.hasOwn(PRODUCT_NAMES, name) ? PRODUCT_NAMES[name] : null;
  }
  if (!model) {
    // Older firmwares (ha-bambulab, get_printer_type).
    const ap = modules.find((m) => typeof m?.hw_ver === 'string' && m.hw_ver.startsWith('AP0'));
    const project = ap?.project_name ?? '';
    if (ap?.hw_ver === 'AP02') {
      model = 'X1E';
    } else if (project) {
      model = modelFromCode(project);
    } else if (ap?.hw_ver === 'AP05') {
      model = 'X1C';
    }
  }
  const ota = modules.find((m) => m?.name === 'ota');
  return { model, firmware: typeof ota?.sw_ver === 'string' ? ota.sw_ver : '' };
}

/** Every state of the `state` feature. */
export const STATES = [
  'connecting',
  'unreachable',
  'unauthorized',
  'idle',
  'preparing',
  'printing',
  'paused',
  'finished',
  'failed',
  'offline',
  'unknown',
];

// `gcode_state` -> state. SLICING and INIT happen before a print (cloud jobs).
const GCODE_STATES = {
  IDLE: 'idle',
  INIT: 'preparing',
  SLICING: 'preparing',
  PREPARE: 'preparing',
  RUNNING: 'printing',
  PAUSE: 'paused',
  FINISH: 'finished',
  FAILED: 'failed',
  OFFLINE: 'offline',
};

/** A print is going on (pause included): the widget offers pause/cancel. */
export const ACTIVE_STATES = new Set(['preparing', 'printing', 'paused']);
/** The printer reports, whatever it does. */
export const REPORTING_STATES = new Set([
  ...ACTIVE_STATES,
  'idle',
  'finished',
  'failed',
  'unknown',
]);

/** `print_error` of a print cancelled by a user (ha-bambulab: 50348044). */
export const CANCELLED_ERROR = '0300_400C';

/** Speed levels of `spd_lvl` / `print_speed`. */
export const SPEEDS = { 1: 'silent', 2: 'standard', 3: 'sport', 4: 'ludicrous' };
export const SPEED_LEVELS = Object.fromEntries(
  Object.entries(SPEEDS).map(([level, name]) => [name, Number(level)]),
);

export function emptySnapshot() {
  return {
    state: 'connecting',
    gcodeState: null,
    percent: null,
    remaining: null, // minutes
    layer: null,
    totalLayers: null,
    task: '',
    file: '',
    nozzle: { actual: null, target: null },
    bed: { actual: null, target: null },
    chamber: { actual: null, target: null },
    speed: null,
    light: null, // 'on' | 'off' | null (no chamber light reported)
    hms: [], // [{ code: '0300_0100_0001_0007', severity: 'serious' }]
    printError: null, // '0300_400C' or null
    ams: [], // [{ id, humidity, temperature, trays: [{ id, type, name, color, remain }] }]
    trayNow: null,
    external: null, // the external spool: { type, name, color } or null
    signatureRequired: null,
    gcodeStartTime: null, // seconds since 1970, when the printer says it
  };
}

const finite = (value) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

const hex4 = (value) => value.toString(16).toUpperCase().padStart(4, '0');

/** `{ attr, code }` of the `hms` list -> `0300_0100_0001_0007`, or null. */
export function hmsCode(attr, code) {
  const a = finite(attr);
  const c = finite(code);
  if (!a || !c || a < 0 || c < 0) {
    return null;
  }
  return `${hex4(Math.floor(a / 0x10000))}_${hex4(a % 0x10000)}_${hex4(Math.floor(c / 0x10000))}_${hex4(c % 0x10000)}`;
}

const HMS_SEVERITIES = { 1: 'fatal', 2: 'serious', 3: 'common', 4: 'info' };

export function hmsSeverity(code) {
  const c = finite(code);
  return (c && HMS_SEVERITIES[Math.floor(c / 0x10000)]) ?? 'unknown';
}

/** `print_error` (50348044) -> `0300_400C`, or null when there is none. */
export function printErrorCode(value) {
  const number = finite(value);
  if (!number || number < 0) {
    return null;
  }
  const text = number.toString(16).toUpperCase().padStart(8, '0').slice(-8);
  return `${text.slice(0, 4)}_${text.slice(4)}`;
}

/**
 * `fun` (hex) of the recent firmwares: bit 29 set means every control command
 * must be signed by Bambu Lab's software ("Authorization Control"); the
 * Developer mode of LAN only clears it (ha-bambulab, Print_Fun_Values).
 */
export function readSignatureRequired(fun) {
  if (typeof fun !== 'string' || !/^[0-9a-f]+$/i.test(fun)) {
    return null;
  }
  return (BigInt(`0x${fun}`) & 0x20000000n) !== 0n;
}

/** A packed temperature of the recent firmwares: low word actual, high word target. */
function unpack(value) {
  const number = finite(value);
  if (number === null || number < 0) {
    return null;
  }
  return { actual: number % 0x10000, target: Math.floor(number / 0x10000) };
}

function filamentColor(hex) {
  // `RRGGBBAA`; a transparent `00000000` means "no colour known".
  if (typeof hex !== 'string' || !/^[0-9a-f]{8}$/i.test(hex) || /^0{8}$/.test(hex)) {
    return null;
  }
  return hex.slice(0, 6).toUpperCase();
}

function readTray(tray) {
  const type = typeof tray?.tray_type === 'string' ? tray.tray_type.trim() : '';
  if (!type) {
    return null; // empty slot
  }
  const name = typeof tray.tray_sub_brands === 'string' ? tray.tray_sub_brands.trim() : '';
  const remain = finite(tray.remain);
  return {
    type: type.slice(0, 20),
    name: name.slice(0, 30),
    color: filamentColor(tray.tray_color),
    // -1 when the AMS does not estimate it (third-party spool).
    remain: remain !== null && remain >= 0 && remain <= 100 ? Math.round(remain) : null,
  };
}

/** Merges the `ams.ams` units of a report into the known ones (P1 sends partial lists). */
function mergeAms(previous, units) {
  const byId = new Map(previous.map((unit) => [unit.id, unit]));
  for (const unit of units) {
    const id = finite(unit?.id);
    if (id === null) {
      continue;
    }
    const known = byId.get(id) ?? { id, humidity: null, temperature: null, trays: [] };
    const trays = new Map(known.trays.map((tray) => [tray.id, tray]));
    for (const tray of Array.isArray(unit.tray) ? unit.tray : []) {
      const trayId = finite(tray?.id);
      if (trayId === null) {
        continue;
      }
      // A slot without `tray_type` is empty; a partial update of a known
      // spool (only `remain`...) keeps the rest of it.
      // (`state: 0`, no spool fields: the X1 way of saying "empty slot").
      if ('tray_type' in tray || !trays.has(trayId) || finite(tray.state) === 0) {
        const read = readTray(tray);
        trays.set(trayId, read ? { id: trayId, ...read } : { id: trayId, empty: true });
      } else if ('remain' in tray) {
        const remain = finite(tray.remain);
        trays.set(trayId, {
          ...trays.get(trayId),
          remain: remain !== null && remain >= 0 && remain <= 100 ? Math.round(remain) : null,
        });
      }
    }
    const temperature = finite(unit.temp);
    byId.set(id, {
      id,
      // `humidity` is a level 1 (wet) to 5 (dry) on the AMS.
      humidity: finite(unit.humidity) ?? known.humidity,
      temperature: temperature ? temperature : known.temperature,
      trays: [...trays.values()].sort((a, b) => a.id - b.id),
    });
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * Applies one `print` object of a report to a snapshot; returns a new
 * snapshot (the previous one is not modified).
 * @param {ReturnType<typeof emptySnapshot>} snapshot
 * @param {Record<string, any>} print
 */
export function applyPrint(snapshot, print) {
  if (!print || typeof print !== 'object') {
    return snapshot;
  }
  const next = {
    ...snapshot,
    nozzle: { ...snapshot.nozzle },
    bed: { ...snapshot.bed },
    chamber: { ...snapshot.chamber },
  };

  if (typeof print.gcode_state === 'string') {
    const gcode = print.gcode_state.toUpperCase();
    next.gcodeState = gcode;
    next.state = GCODE_STATES[gcode] ?? 'unknown';
  }
  const percent = finite(print.mc_percent);
  if (percent !== null) {
    next.percent = Math.min(100, Math.max(0, percent));
  }
  const remaining = finite(print.mc_remaining_time);
  if (remaining !== null) {
    next.remaining = Math.max(0, remaining);
  }
  const layer = finite(print.layer_num);
  if (layer !== null) {
    next.layer = Math.max(0, layer);
  }
  const total = finite(print.total_layer_num);
  if (total !== null) {
    next.totalLayers = Math.max(0, total);
  }
  if (typeof print.subtask_name === 'string') {
    next.task = print.subtask_name.trim();
  }
  if (typeof print.gcode_file === 'string') {
    next.file = print.gcode_file.trim();
  }
  const start = finite(print.gcode_start_time);
  if (start !== null) {
    next.gcodeStartTime = start > 0 ? start : null;
  }

  // Temperatures: the packed `device` block of the recent firmwares wins.
  const device = print.device && typeof print.device === 'object' ? print.device : {};
  const bed = unpack(device.bed?.info?.temp);
  if (bed) {
    next.bed = bed;
  } else {
    next.bed.actual = finite(print.bed_temper) ?? next.bed.actual;
    next.bed.target = finite(print.bed_target_temper) ?? next.bed.target;
  }
  const chamber = unpack(device.ctc?.info?.temp);
  if (chamber) {
    next.chamber = chamber;
  } else {
    next.chamber.actual = finite(print.chamber_temper) ?? next.chamber.actual;
  }
  const nozzleActual = finite(print.nozzle_temper);
  if (nozzleActual !== null) {
    next.nozzle.actual = nozzleActual;
    next.nozzle.target = finite(print.nozzle_target_temper) ?? next.nozzle.target;
  } else if (Array.isArray(device.extruder?.info)) {
    // Dual nozzles (H2D): the active one, numbered in the extruder state.
    const active = Math.floor((finite(device.extruder.state) ?? 0) / 16) % 16;
    const nozzle = device.extruder.info.find((entry) => finite(entry?.id) === active);
    const packed = unpack(nozzle?.temp);
    if (packed) {
      next.nozzle = packed;
    }
  } else {
    next.nozzle.target = finite(print.nozzle_target_temper) ?? next.nozzle.target;
  }

  const speed = finite(print.spd_lvl);
  if (speed !== null && SPEEDS[speed]) {
    next.speed = speed;
  }
  if (Array.isArray(print.lights_report)) {
    const light = print.lights_report.find((entry) => entry?.node === 'chamber_light');
    if (light && typeof light.mode === 'string') {
      // `flashing` is the work light of the X1, never the chamber light.
      next.light = light.mode === 'on' ? 'on' : 'off';
    }
  }
  if (Array.isArray(print.hms)) {
    const seen = new Set();
    next.hms = [];
    for (const entry of print.hms) {
      const code = hmsCode(entry?.attr, entry?.code);
      if (code && !seen.has(code)) {
        seen.add(code);
        next.hms.push({ code, severity: hmsSeverity(entry.code) });
      }
    }
  }
  if ('print_error' in print) {
    next.printError = printErrorCode(print.print_error);
  }
  if (print.ams && typeof print.ams === 'object') {
    if (Array.isArray(print.ams.ams)) {
      next.ams = mergeAms(snapshot.ams, print.ams.ams);
    }
    const trayNow = finite(print.ams.tray_now);
    if (trayNow !== null) {
      next.trayNow = trayNow;
    }
  }
  if (print.vt_tray && typeof print.vt_tray === 'object') {
    // Nothing measures the spool of the external holder: its `remain` is 0.
    const spool = readTray(print.vt_tray);
    next.external = spool ? { ...spool, remain: null } : null;
  }
  if ('fun' in print) {
    next.signatureRequired = readSignatureRequired(print.fun);
  }
  return next;
}

/**
 * What the device publishes for a printer, decided once its model and a
 * first report are known. What was known before stays (a restart, a partial
 * first report must not drop the light and propose an "Update" in Gladys).
 */
export function readCapabilities({ model, firmware, snapshot, previous = null }) {
  const name = MODELS[model] ? model : (previous?.model ?? null);
  const known = MODELS[name];
  return {
    model: name,
    firmware: firmware || previous?.firmware || '',
    camera: known?.camera ?? false,
    chamber: known?.chamber ?? false,
    chamberHeater: known?.chamberHeater ?? false,
    light: snapshot.light !== null || Boolean(previous?.light),
  };
}

/** Same features on the device: no "Update" needed in Gladys. */
export function sameStructure(a, b) {
  if (!a || !b) {
    return a === b;
  }
  return ['model', 'camera', 'chamber', 'chamberHeater', 'light'].every((key) => a[key] === b[key]);
}

/** The AMS tray in use: `tray_now` is ams × 4 + slot, 254/255 = external or none. */
export function activeTray(snapshot) {
  const now = snapshot.trayNow;
  if (now === null || now >= 254 || now < 0) {
    return now === 254 ? { external: true } : null;
  }
  return { unit: Math.floor(now / 4), tray: now % 4 };
}
