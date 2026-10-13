// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `printer`, "Bambu Lab
// 3D print".
//
// The Gladys device box already lists every feature. What the widget adds:
// the print at a glance (progress gauge, time left, temperatures as live
// tiles), the last camera image (P1, A1), the AMS spools, when the print will
// finish, the HMS errors, and the buttons that matter in the current state —
// pause or resume and cancel (with a confirmation: the device box has no
// cancel button on purpose) during a print, the chamber light otherwise.
//
// Budget (8 components: 1 image, 6 tiles, 1 status, 4 buttons): four tiles,
// one image, one status list of 10 rows at most, two buttons. No button
// opens a form: Gladys 5.1 is enough.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ACTIVE_STATES, SPEEDS, activeTray } from './bambu/model.js';
import { deviceIds } from './devices.js';
import { CommandError, WIDGET_KEY } from './hub.js';
import { DONE_TEXT, SPEED_LABELS, STATE_LABELS, colorName } from './texts.js';

export { WIDGET_KEY };

export const TEXT = {
  pick: {
    en: 'Choose a Bambu Lab printer in the widget settings.',
    fr: 'Choisissez une imprimante Bambu Lab dans les réglages du widget.',
    de: 'Wähle einen Bambu-Lab-Drucker in den Widget-Einstellungen.',
    es: 'Elija una impresora Bambu Lab en los ajustes del widget.',
  },
  unknown: {
    en: 'This printer is not configured in the Bambu Lab integration anymore.',
    fr: "Cette imprimante n'est plus configurée dans l'intégration Bambu Lab.",
    de: 'Dieser Drucker ist in der Bambu-Lab-Integration nicht mehr eingerichtet.',
    es: 'Esta impresora ya no está configurada en la integración Bambu Lab.',
  },
  waiting: {
    en: 'Waiting for the printer to report.',
    fr: "En attente des données de l'imprimante.",
    de: 'Warte auf die Daten des Druckers.',
    es: 'Esperando los datos de la impresora.',
  },
  progress: { en: 'Progress', fr: 'Progression', de: 'Fortschritt', es: 'Progreso' },
  left: { en: 'Time left', fr: 'Restant', de: 'Restzeit', es: 'Restante' },
  nozzle: { en: 'Nozzle', fr: 'Buse', de: 'Düse', es: 'Boquilla' },
  bed: { en: 'Bed', fr: 'Plateau', de: 'Druckbett', es: 'Cama' },
  camera: { en: 'Camera', fr: 'Caméra', de: 'Kamera', es: 'Cámara' },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  file: { en: 'File', fr: 'Fichier', de: 'Datei', es: 'Archivo' },
  layer: { en: 'Layer', fr: 'Couche', de: 'Schicht', es: 'Capa' },
  finish: { en: 'Ends at', fr: 'Fin vers', de: 'Fertig um', es: 'Termina a las' },
  speed: { en: 'Speed', fr: 'Vitesse', de: 'Geschwindigkeit', es: 'Velocidad' },
  errors: { en: 'HMS errors', fr: 'Erreurs HMS', de: 'HMS-Fehler', es: 'Errores HMS' },
  control: { en: 'Commands', fr: 'Commandes', de: 'Befehle', es: 'Comandos' },
  locked: {
    en: 'Developer mode needed',
    fr: 'Mode Développeur requis',
    de: 'Entwicklermodus nötig',
    es: 'Modo Desarrollador necesario',
  },
  external: {
    en: 'External spool',
    fr: 'Bobine externe',
    de: 'Externe Spule',
    es: 'Bobina externa',
  },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pausieren', es: 'Pausar' },
  resume: { en: 'Resume', fr: 'Reprendre', de: 'Fortsetzen', es: 'Reanudar' },
  cancel: { en: 'Cancel', fr: 'Annuler', de: 'Abbrechen', es: 'Cancelar' },
  light_on: { en: 'Light on', fr: 'Allumer', de: 'Licht an', es: 'Encender' },
  light_off: { en: 'Light off', fr: 'Éteindre', de: 'Licht aus', es: 'Apagar' },
};

const STATE_COLORS = {
  connecting: WIDGET_COLORS.NEUTRAL,
  unreachable: WIDGET_COLORS.DANGER,
  unauthorized: WIDGET_COLORS.DANGER,
  idle: WIDGET_COLORS.SUCCESS,
  preparing: WIDGET_COLORS.PRIMARY,
  printing: WIDGET_COLORS.PRIMARY,
  paused: WIDGET_COLORS.WARNING,
  finished: WIDGET_COLORS.SUCCESS,
  failed: WIDGET_COLORS.DANGER,
  offline: WIDGET_COLORS.NEUTRAL,
  unknown: WIDGET_COLORS.NEUTRAL,
};

export const WIDGET_ACTIONS = ['pause', 'resume', 'cancel', 'light_on', 'light_off'];

const MAX_STATUS_ITEMS = 10;

const pick = (table, language) => table[language] ?? table.en;
const textOnly = (text, ttl = 60) => ({
  ttl_seconds: ttl,
  components: [{ type: 'text', variant: 'body', text }],
});

function clockTime(date, language) {
  try {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

function button(language, key, icon, extra = {}) {
  return { type: 'button', label: pick(TEXT[key], language), icon, action: { key }, ...extra };
}

/** `PLA Basic · blanc · 93 %` (40 characters at most). */
function spoolText(spool, language) {
  const parts = [spool.name || spool.type];
  const color = colorName(spool.color, language);
  if (color) {
    parts.push(color);
  }
  if (spool.remain !== null && spool.remain !== undefined) {
    parts.push(`${spool.remain} %`);
  }
  return parts.join(' · ').slice(0, 40);
}

/** One status row per loaded AMS slot (A1, A2... B1 for a second AMS), then the external spool. */
function spoolItems(snapshot, language) {
  const items = [];
  const active = activeTray(snapshot);
  for (const unit of snapshot.ams) {
    const letter = unit.id < 26 ? String.fromCharCode(65 + unit.id) : `#${unit.id}`;
    for (const tray of unit.trays) {
      if (tray.empty) {
        continue;
      }
      const inUse =
        active && !active.external && active.unit === unit.id && active.tray === tray.id;
      items.push({
        label: `AMS ${letter}${tray.id + 1}`,
        value: spoolText(tray, language),
        icon: inUse ? 'check-circle' : 'disc',
      });
    }
  }
  if (snapshot.external && (items.length === 0 || active?.external)) {
    items.push({
      label: pick(TEXT.external, language),
      value: spoolText(snapshot.external, language),
      icon: active?.external ? 'check-circle' : 'disc',
    });
  }
  return items;
}

/**
 * The widget content for a printer.
 * @param {object} hub
 * @param {{ settings?: object, language?: string }} request
 */
export function buildContent(hub, { settings = {}, language = 'en' }) {
  const lang = STATE_LABELS[language] ? language : 'en';
  if (typeof settings.device !== 'string' || settings.device === '') {
    return textOnly(pick(TEXT.pick, lang), 300);
  }
  const printer = [...hub.printers.values()].find(
    (p) => deviceIds(hub.gladys, p.serial).device === settings.device,
  );
  if (!printer) {
    return textOnly(pick(TEXT.unknown, lang), 300);
  }
  if (!printer.capabilities) {
    return textOnly(pick(TEXT.waiting, lang), 30);
  }
  const ids = deviceIds(hub.gladys, printer.serial);
  const snapshot = printer.link.snapshot;
  const reporting = printer.link.reporting;
  const active = reporting && ACTIVE_STATES.has(snapshot.state);
  const components = [
    {
      type: 'gauge',
      label: pick(TEXT.progress, lang),
      device_feature: ids.feature('progress'),
      color: WIDGET_COLORS.PRIMARY,
    },
    { type: 'value', label: pick(TEXT.left, lang), device_feature: ids.feature('time_left') },
    {
      type: 'value',
      label: pick(TEXT.nozzle, lang),
      device_feature: ids.feature('nozzle_temperature'),
    },
    { type: 'value', label: pick(TEXT.bed, lang), device_feature: ids.feature('bed_temperature') },
  ];
  if (printer.image && hub.config.camera) {
    components.push({
      type: 'image',
      key: printer.image.key,
      alt: pick(TEXT.camera, lang),
      fit: 'contain',
    });
  }

  const items = [
    {
      label: pick(TEXT.state, lang),
      value: STATE_LABELS[lang][snapshot.state].slice(0, 40),
      color: STATE_COLORS[snapshot.state],
    },
  ];
  if (reporting) {
    const task = snapshot.task || snapshot.file.split('/').at(-1);
    if (task && (active || ['finished', 'failed'].includes(snapshot.state))) {
      items.push({ label: pick(TEXT.file, lang), value: task.slice(0, 40), icon: 'file' });
    }
    if (active && snapshot.totalLayers) {
      items.push({
        label: pick(TEXT.layer, lang),
        value: `${snapshot.layer ?? 0} / ${snapshot.totalLayers}`,
        icon: 'layers',
      });
    }
    if (active && snapshot.state !== 'paused' && snapshot.remaining) {
      items.push({
        label: pick(TEXT.finish, lang),
        value: clockTime(new Date(hub.now() + snapshot.remaining * 60_000), lang),
        icon: 'flag',
      });
    }
    if (active && snapshot.speed !== null) {
      items.push({
        label: pick(TEXT.speed, lang),
        value: SPEED_LABELS[lang][SPEEDS[snapshot.speed]],
        icon: 'fast-forward',
      });
    }
    if (snapshot.hms.length > 0) {
      items.push({
        label: pick(TEXT.errors, lang),
        value: snapshot.hms.length === 1 ? snapshot.hms[0].code : String(snapshot.hms.length),
        color: WIDGET_COLORS.DANGER,
      });
    }
    if (snapshot.signatureRequired) {
      items.push({
        label: pick(TEXT.control, lang),
        value: pick(TEXT.locked, lang),
        color: WIDGET_COLORS.WARNING,
      });
    }
    items.push(...spoolItems(snapshot, lang));
  }
  components.push({ type: 'status', items: items.slice(0, MAX_STATUS_ITEMS) });

  if (reporting) {
    const cancel = button(lang, 'cancel', 'x-circle', { style: 'danger' });
    cancel.action.confirm = true;
    if (snapshot.signatureRequired) {
      // Pause, resume and cancel would be refused by the firmware.
    } else if (['printing', 'preparing'].includes(snapshot.state)) {
      components.push(button(lang, 'pause', 'pause'), cancel);
    } else if (snapshot.state === 'paused') {
      components.push(button(lang, 'resume', 'play'), cancel);
    }
    const buttons = components.filter((c) => c.type === 'button').length;
    if (buttons === 0 && printer.capabilities.light && snapshot.light !== null) {
      components.push(
        snapshot.light === 'on'
          ? button(lang, 'light_off', 'moon')
          : button(lang, 'light_on', 'sun'),
      );
    }
  }

  return { ttl_seconds: active ? 30 : 300, components };
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    get(hub, request) {
      return buildContent(hub, request ?? {});
    },

    /** Resolves the toast (the widget action receives no language: all four). */
    async action(hub, { actionKey, settings = {} }) {
      const device = settings.device;
      try {
        switch (actionKey) {
          case 'pause':
          case 'resume':
            await hub.command(device, actionKey);
            break;
          case 'cancel':
            await hub.command(device, 'stop');
            break;
          case 'light_on':
            await hub.command(device, 'light', 'on');
            break;
          case 'light_off':
            await hub.command(device, 'light', 'off');
            break;
          default:
            throw new Error(`Unknown widget action ${actionKey}`);
        }
      } catch (err) {
        if (err instanceof CommandError) {
          return err.messages;
        }
        throw err;
      }
      return DONE_TEXT[actionKey];
    },
  },
};
