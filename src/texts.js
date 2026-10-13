// -----------------------------------------------------------------------------
// Every text the container produces, in the four languages of the Gladys
// interface. German says "du", Spanish "usted" (test/i18n.test.js).
// A device integration never receives the user's language: the `language`
// field of the configuration picks one (default: French).
// -----------------------------------------------------------------------------

/** Feature names, frozen when the device is added to Gladys. */
export const NAMES = {
  en: {
    state: 'State',
    task: 'File',
    progress: 'Progress',
    time_left: 'Time left',
    layer: 'Layer',
    total_layers: 'Total layers',
    nozzle: 'Nozzle',
    bed: 'Bed',
    chamber: 'Chamber',
    target: 'target',
    speed: 'Print speed',
    light: 'Chamber light',
    pause: 'Pause',
    resume: 'Resume',
    errors: 'HMS errors',
    camera: 'Camera',
  },
  fr: {
    state: 'État',
    task: 'Fichier',
    progress: 'Progression',
    time_left: 'Temps restant',
    layer: 'Couche',
    total_layers: 'Couches au total',
    nozzle: 'Buse',
    bed: 'Plateau',
    chamber: 'Caisson',
    target: 'consigne',
    speed: "Vitesse d'impression",
    light: 'Lumière du caisson',
    pause: 'Pause',
    resume: 'Reprise',
    errors: 'Erreurs HMS',
    camera: 'Caméra',
  },
  de: {
    state: 'Status',
    task: 'Datei',
    progress: 'Fortschritt',
    time_left: 'Restzeit',
    layer: 'Schicht',
    total_layers: 'Schichten gesamt',
    nozzle: 'Düse',
    bed: 'Druckbett',
    chamber: 'Bauraum',
    target: 'Soll',
    speed: 'Druckgeschwindigkeit',
    light: 'Bauraumlicht',
    pause: 'Pausieren',
    resume: 'Fortsetzen',
    errors: 'HMS-Fehler',
    camera: 'Kamera',
  },
  es: {
    state: 'Estado',
    task: 'Archivo',
    progress: 'Progreso',
    time_left: 'Tiempo restante',
    layer: 'Capa',
    total_layers: 'Capas totales',
    nozzle: 'Boquilla',
    bed: 'Cama',
    chamber: 'Recinto',
    target: 'consigna',
    speed: 'Velocidad de impresión',
    light: 'Luz del recinto',
    pause: 'Pausar',
    resume: 'Reanudar',
    errors: 'Errores HMS',
    camera: 'Cámara',
  },
};

/** The `state` feature (text), one label per state of src/bambu/model.js. */
export const STATE_LABELS = {
  en: {
    connecting: 'Connecting',
    unreachable: 'Printer unreachable',
    unauthorized: 'Access code refused',
    idle: 'Ready',
    preparing: 'Preparing',
    printing: 'Printing',
    paused: 'Paused',
    finished: 'Finished',
    failed: 'Failed',
    offline: 'Offline',
    unknown: 'Unknown',
  },
  fr: {
    connecting: 'Connexion',
    unreachable: 'Imprimante injoignable',
    unauthorized: "Code d'accès refusé",
    idle: 'Prête',
    preparing: 'Préparation',
    printing: 'Impression',
    paused: 'En pause',
    finished: 'Terminée',
    failed: 'Échouée',
    offline: 'Hors ligne',
    unknown: 'Inconnu',
  },
  de: {
    connecting: 'Verbinde',
    unreachable: 'Drucker nicht erreichbar',
    unauthorized: 'Zugangscode abgelehnt',
    idle: 'Bereit',
    preparing: 'Vorbereitung',
    printing: 'Druckt',
    paused: 'Pausiert',
    finished: 'Fertig',
    failed: 'Fehlgeschlagen',
    offline: 'Offline',
    unknown: 'Unbekannt',
  },
  es: {
    connecting: 'Conectando',
    unreachable: 'Impresora inaccesible',
    unauthorized: 'Código de acceso rechazado',
    idle: 'Lista',
    preparing: 'Preparando',
    printing: 'Imprimiendo',
    paused: 'En pausa',
    finished: 'Terminada',
    failed: 'Fallida',
    offline: 'Desconectada',
    unknown: 'Desconocido',
  },
};

/** The speed levels (`spd_lvl`), as the Bambu Lab apps name them. */
export const SPEED_LABELS = {
  en: { silent: 'Silent', standard: 'Standard', sport: 'Sport', ludicrous: 'Ludicrous' },
  fr: { silent: 'Silencieux', standard: 'Standard', sport: 'Sport', ludicrous: 'Extrême' },
  de: { silent: 'Leise', standard: 'Standard', sport: 'Sport', ludicrous: 'Extrem' },
  es: { silent: 'Silencioso', standard: 'Estándar', sport: 'Deportivo', ludicrous: 'Extremo' },
};

/** The `task` feature when there is no print (a text state is never empty). */
export const NO_FILE = {
  en: 'No file',
  fr: 'Aucun fichier',
  de: 'Keine Datei',
  es: 'Ningún archivo',
};

/** The `errors` feature when the printer reports none. */
export const NO_ERROR = {
  en: 'No error',
  fr: 'Aucune erreur',
  de: 'Kein Fehler',
  es: 'Ningún error',
};

/** "and 2 more" after the first HMS error. */
export const MORE_ERRORS = {
  en: (n) => `(+${n} more)`,
  fr: (n) => `(+${n} autres)`,
  de: (n) => `(+${n} weitere)`,
  es: (n) => `(+${n} más)`,
};

/** An HMS code or print error without a known text. */
export const UNKNOWN_ERROR = {
  en: 'Unknown error, see the printer screen',
  fr: "Erreur inconnue, voir l'écran de l'imprimante",
  de: 'Unbekannter Fehler, sieh auf dem Druckerdisplay nach',
  es: 'Error desconocido, consulte la pantalla de la impresora',
};

const pad = (minutes) => String(minutes).padStart(2, '0');

/** Durations: "1 h 05 min" and its translations. */
export const DURATION = {
  en: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
  fr: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
  de: { hours: (h, m) => `${h} Std. ${pad(m)} Min.`, minutes: (m) => `${m} Min.` },
  es: { hours: (h, m) => `${h} h ${pad(m)} min`, minutes: (m) => `${m} min` },
};

export function formatDuration(seconds, language) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '';
  }
  const table = DURATION[language] ?? DURATION.en;
  const total = Math.round(seconds / 60);
  if (total < 60) {
    return table.minutes(total);
  }
  return table.hours(Math.floor(total / 60), total % 60);
}

/** Filament colour names, for the widget. */
export const COLORS = {
  white: { en: 'white', fr: 'blanc', de: 'weiß', es: 'blanco' },
  black: { en: 'black', fr: 'noir', de: 'schwarz', es: 'negro' },
  grey: { en: 'grey', fr: 'gris', de: 'grau', es: 'gris' },
  red: { en: 'red', fr: 'rouge', de: 'rot', es: 'rojo' },
  orange: { en: 'orange', fr: 'orange', de: 'orange', es: 'naranja' },
  yellow: { en: 'yellow', fr: 'jaune', de: 'gelb', es: 'amarillo' },
  green: { en: 'green', fr: 'vert', de: 'grün', es: 'verde' },
  cyan: { en: 'light blue', fr: 'bleu clair', de: 'hellblau', es: 'azul claro' },
  blue: { en: 'blue', fr: 'bleu', de: 'blau', es: 'azul' },
  purple: { en: 'purple', fr: 'violet', de: 'violett', es: 'morado' },
  pink: { en: 'pink', fr: 'rose', de: 'rosa', es: 'rosa' },
  brown: { en: 'brown', fr: 'marron', de: 'braun', es: 'marrón' },
  beige: { en: 'beige', fr: 'beige', de: 'beige', es: 'beige' },
};

/** `RRGGBB` -> the colour family (hue, saturation, lightness), or null. */
export function colorFamily(hex) {
  if (typeof hex !== 'string' || !/^[0-9a-f]{6}$/i.test(hex)) {
    return null;
  }
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  if (lightness > 0.92) {
    return 'white';
  }
  if (lightness < 0.12) {
    return 'black';
  }
  if (saturation < 0.18 || delta < 0.08) {
    return 'grey';
  }
  let hue;
  if (max === r) {
    hue = (((g - b) / delta) % 6) * 60;
  } else if (max === g) {
    hue = ((b - r) / delta + 2) * 60;
  } else {
    hue = ((r - g) / delta + 4) * 60;
  }
  hue = (hue + 360) % 360;
  if (hue >= 15 && hue < 50 && (lightness < 0.42 || (saturation < 0.4 && lightness < 0.6))) {
    return 'brown';
  }
  if (hue >= 10 && hue < 60 && lightness >= 0.6 && (saturation < 0.55 || lightness > 0.8)) {
    return 'beige';
  }
  if (hue < 15 || hue >= 345) {
    return lightness > 0.7 ? 'pink' : 'red';
  }
  if (hue < 45) {
    return 'orange';
  }
  if (hue < 70) {
    return 'yellow';
  }
  if (hue < 165) {
    return 'green';
  }
  if (hue < 200) {
    return 'cyan';
  }
  if (hue < 250) {
    return lightness > 0.6 ? 'cyan' : 'blue';
  }
  if (hue < 290) {
    return 'purple';
  }
  return lightness > 0.5 || hue >= 315 ? 'pink' : 'purple';
}

/** `RRGGBB` -> a colour name in the language, or '' when unknown. */
export function colorName(hex, language) {
  const family = colorFamily(hex);
  return family ? (COLORS[family][language] ?? COLORS[family].en) : '';
}

/** Why a command was refused; thrown to Gladys or shown as a widget toast. */
export const COMMAND_ERRORS = {
  en: {
    unreachable: 'The printer does not answer.',
    locked:
      'The printer firmware only accepts commands from Bambu Lab apps: turn on LAN only mode and Developer mode on the printer.',
    not_printing: 'No print in progress.',
    not_paused: 'The print is not paused.',
    no_light: 'This printer reports no chamber light.',
    refused: 'The printer refused the command.',
    unknown_device: 'This printer is not configured in the integration anymore.',
    unknown_speed: 'Unknown print speed.',
    no_camera: 'No camera image for this printer (P1 and A1 series only).',
    camera_disabled: 'Camera images are turned off in the integration configuration.',
    camera_auth: 'The camera refused the access code.',
    camera_timeout: 'The camera sent no image in time.',
    camera_format: 'The camera sent something else than a JPEG image.',
    camera_size: 'The camera image is larger than Gladys accepts (150 KB).',
  },
  fr: {
    unreachable: "L'imprimante ne répond pas.",
    locked:
      "Le firmware de l'imprimante n'accepte que les commandes des applications Bambu Lab : activez les modes LAN uniquement et Développeur sur l'imprimante.",
    not_printing: 'Aucune impression en cours.',
    not_paused: "L'impression n'est pas en pause.",
    no_light: "Cette imprimante n'indique aucune lumière de caisson.",
    refused: "L'imprimante a refusé la commande.",
    unknown_device: "Cette imprimante n'est plus configurée dans l'intégration.",
    unknown_speed: "Vitesse d'impression inconnue.",
    no_camera: "Pas d'image de caméra pour cette imprimante (séries P1 et A1 seulement).",
    camera_disabled:
      "Les images de la caméra sont désactivées dans la configuration de l'intégration.",
    camera_auth: "La caméra a refusé le code d'accès.",
    camera_timeout: "La caméra n'a envoyé aucune image à temps.",
    camera_format: "La caméra a envoyé autre chose qu'une image JPEG.",
    camera_size: "L'image de la caméra dépasse ce que Gladys accepte (150 Ko).",
  },
  de: {
    unreachable: 'Der Drucker antwortet nicht.',
    locked:
      'Die Drucker-Firmware nimmt nur Befehle aus Bambu-Lab-Apps an: Schalte am Drucker den Nur-LAN-Modus und den Entwicklermodus ein.',
    not_printing: 'Kein Druck aktiv.',
    not_paused: 'Der Druck ist nicht pausiert.',
    no_light: 'Dieser Drucker meldet kein Bauraumlicht.',
    refused: 'Der Drucker hat den Befehl abgelehnt.',
    unknown_device: 'Dieser Drucker ist in der Integration nicht mehr eingerichtet.',
    unknown_speed: 'Unbekannte Druckgeschwindigkeit.',
    no_camera: 'Kein Kamerabild für diesen Drucker (nur Serien P1 und A1).',
    camera_disabled: 'Kamerabilder sind in der Konfiguration der Integration ausgeschaltet.',
    camera_auth: 'Die Kamera hat den Zugangscode abgelehnt.',
    camera_timeout: 'Die Kamera hat nicht rechtzeitig ein Bild geschickt.',
    camera_format: 'Die Kamera hat etwas anderes als ein JPEG-Bild geschickt.',
    camera_size: 'Das Kamerabild ist größer, als Gladys annimmt (150 KB).',
  },
  es: {
    unreachable: 'La impresora no responde.',
    locked:
      'El firmware de la impresora solo acepta comandos de las aplicaciones de Bambu Lab: active los modos Solo LAN y Desarrollador en la impresora.',
    not_printing: 'No hay ninguna impresión en curso.',
    not_paused: 'La impresión no está en pausa.',
    no_light: 'Esta impresora no indica ninguna luz del recinto.',
    refused: 'La impresora ha rechazado el comando.',
    unknown_device: 'Esta impresora ya no está configurada en la integración.',
    unknown_speed: 'Velocidad de impresión desconocida.',
    no_camera: 'No hay imagen de cámara para esta impresora (solo series P1 y A1).',
    camera_disabled:
      'Las imágenes de la cámara están desactivadas en la configuración de la integración.',
    camera_auth: 'La cámara ha rechazado el código de acceso.',
    camera_timeout: 'La cámara no ha enviado ninguna imagen a tiempo.',
    camera_format: 'La cámara ha enviado algo distinto de una imagen JPEG.',
    camera_size: 'La imagen de la cámara supera lo que acepta Gladys (150 KB).',
  },
};

/** One multi-language object for a coded command error. */
export function commandMessage(code) {
  return Object.fromEntries(
    Object.entries(COMMAND_ERRORS).map(([language, table]) => [
      language,
      table[code] ?? table.unreachable,
    ]),
  );
}

/** The connection status of the Configuration screen. */
export const STATUS_TEXT = {
  en: {
    none: 'Enter the serial number and the access code of your printer, then save.',
    serial: (n) => `Printer ${n}: invalid serial number.`,
    host: (n) => `Printer ${n}: invalid address.`,
    access_code: (n) => `Printer ${n}: enter the access code shown on the printer.`,
    duplicate: (n) => `Printer ${n}: this serial number is already configured.`,
    searching: (n) => `Printer ${n}: looking for its address on the network.`,
    unreachable: (n) => `Printer ${n}: no answer.`,
    unauthorized: (n) => `Printer ${n}: access code or serial number refused.`,
    silent: (n) => `Printer ${n}: connected, but no status: check the serial number.`,
    certificate: (n) => `Printer ${n}: unexpected printer certificate, see the documentation.`,
  },
  fr: {
    none: "Saisissez le numéro de série et le code d'accès de votre imprimante, puis enregistrez.",
    serial: (n) => `Imprimante ${n} : numéro de série invalide.`,
    host: (n) => `Imprimante ${n} : adresse invalide.`,
    access_code: (n) => `Imprimante ${n} : saisissez le code d'accès affiché par l'imprimante.`,
    duplicate: (n) => `Imprimante ${n} : ce numéro de série est déjà configuré.`,
    searching: (n) => `Imprimante ${n} : recherche de son adresse sur le réseau.`,
    unreachable: (n) => `Imprimante ${n} : aucune réponse.`,
    unauthorized: (n) => `Imprimante ${n} : code d'accès ou numéro de série refusé.`,
    silent: (n) =>
      `Imprimante ${n} : connectée, mais aucun état reçu : vérifiez le numéro de série.`,
    certificate: (n) => `Imprimante ${n} : certificat inattendu, voir la documentation.`,
  },
  de: {
    none: 'Gib die Seriennummer und den Zugangscode deines Druckers ein und speichere.',
    serial: (n) => `Drucker ${n}: ungültige Seriennummer.`,
    host: (n) => `Drucker ${n}: ungültige Adresse.`,
    access_code: (n) => `Drucker ${n}: Gib den Zugangscode ein, den der Drucker anzeigt.`,
    duplicate: (n) => `Drucker ${n}: Diese Seriennummer ist schon eingerichtet.`,
    searching: (n) => `Drucker ${n}: Suche seine Adresse im Netzwerk.`,
    unreachable: (n) => `Drucker ${n}: keine Antwort.`,
    unauthorized: (n) => `Drucker ${n}: Zugangscode oder Seriennummer abgelehnt.`,
    silent: (n) => `Drucker ${n}: verbunden, aber kein Status: Prüfe die Seriennummer.`,
    certificate: (n) => `Drucker ${n}: unerwartetes Zertifikat, siehe Dokumentation.`,
  },
  es: {
    none: 'Introduzca el número de serie y el código de acceso de su impresora y guarde.',
    serial: (n) => `Impresora ${n}: número de serie no válido.`,
    host: (n) => `Impresora ${n}: dirección no válida.`,
    access_code: (n) => `Impresora ${n}: introduzca el código de acceso que muestra la impresora.`,
    duplicate: (n) => `Impresora ${n}: este número de serie ya está configurado.`,
    searching: (n) => `Impresora ${n}: buscando su dirección en la red.`,
    unreachable: (n) => `Impresora ${n}: sin respuesta.`,
    unauthorized: (n) => `Impresora ${n}: código de acceso o número de serie rechazado.`,
    silent: (n) => `Impresora ${n}: conectada, pero sin estado: compruebe el número de serie.`,
    certificate: (n) => `Impresora ${n}: certificado inesperado, consulte la documentación.`,
  },
};

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

/** The report of the "Test the connection" action. */
export const TEST_TEXT = {
  en: {
    none: 'No printer configured.',
    ok: (n, model, firmware, state) => `Printer ${n}: ${model}, firmware ${firmware}, ${state}.`,
    locked: 'Commands are refused by the firmware (Developer mode off).',
    failed: (n, state) => `Printer ${n}: ${state}.`,
  },
  fr: {
    none: 'Aucune imprimante configurée.',
    ok: (n, model, firmware, state) =>
      `Imprimante ${n} : ${model}, firmware ${firmware}, ${state}.`,
    locked: 'Les commandes sont refusées par le firmware (mode Développeur désactivé).',
    failed: (n, state) => `Imprimante ${n} : ${state}.`,
  },
  de: {
    none: 'Kein Drucker eingerichtet.',
    ok: (n, model, firmware, state) => `Drucker ${n}: ${model}, Firmware ${firmware}, ${state}.`,
    locked: 'Befehle werden von der Firmware abgelehnt (Entwicklermodus aus).',
    failed: (n, state) => `Drucker ${n}: ${state}.`,
  },
  es: {
    none: 'No hay ninguna impresora configurada.',
    ok: (n, model, firmware, state) => `Impresora ${n}: ${model}, firmware ${firmware}, ${state}.`,
    locked: 'El firmware rechaza los comandos (modo Desarrollador desactivado).',
    failed: (n, state) => `Impresora ${n}: ${state}.`,
  },
};

/** The report of the "Find printers" action. */
export const FIND_TEXT = {
  en: {
    unavailable: 'The network search is unavailable (Gladys 5.1 or later is required).',
    none: 'No Bambu Lab printer announced itself on the network. Is it on, on the same network as Gladys?',
    found: (name, model, host, serial) =>
      `${name} (${model}): address ${host}, serial number ${serial}`,
    configured: (n) => `configured as printer ${n}`,
    lan: 'LAN only mode',
  },
  fr: {
    unavailable: 'La recherche réseau est indisponible (Gladys 5.1 ou plus récent requis).',
    none: "Aucune imprimante Bambu Lab ne s'est annoncée sur le réseau. Est-elle allumée, sur le même réseau que Gladys ?",
    found: (name, model, host, serial) =>
      `${name} (${model}) : adresse ${host}, numéro de série ${serial}`,
    configured: (n) => `configurée en imprimante ${n}`,
    lan: 'mode LAN uniquement',
  },
  de: {
    unavailable: 'Die Netzwerksuche ist nicht verfügbar (Gladys 5.1 oder neuer nötig).',
    none: 'Kein Bambu-Lab-Drucker hat sich im Netzwerk gemeldet. Ist er eingeschaltet und im selben Netzwerk wie Gladys?',
    found: (name, model, host, serial) =>
      `${name} (${model}): Adresse ${host}, Seriennummer ${serial}`,
    configured: (n) => `eingerichtet als Drucker ${n}`,
    lan: 'Nur-LAN-Modus',
  },
  es: {
    unavailable: 'La búsqueda en la red no está disponible (se necesita Gladys 5.1 o posterior).',
    none: 'Ninguna impresora Bambu Lab se ha anunciado en la red. ¿Está encendida y en la misma red que Gladys?',
    found: (name, model, host, serial) =>
      `${name} (${model}): dirección ${host}, número de serie ${serial}`,
    configured: (n) => `configurada como impresora ${n}`,
    lan: 'modo Solo LAN',
  },
};

/** Toasts of the widget buttons (the widget action receives no language). */
export const DONE_TEXT = {
  pause: {
    en: 'Pause requested.',
    fr: 'Pause demandée.',
    de: 'Pause angefordert.',
    es: 'Pausa solicitada.',
  },
  resume: {
    en: 'Resume requested.',
    fr: 'Reprise demandée.',
    de: 'Fortsetzen angefordert.',
    es: 'Reanudación solicitada.',
  },
  cancel: {
    en: 'Cancellation requested.',
    fr: 'Annulation demandée.',
    de: 'Abbruch angefordert.',
    es: 'Cancelación solicitada.',
  },
  light_on: {
    en: 'Chamber light on.',
    fr: 'Lumière du caisson allumée.',
    de: 'Bauraumlicht an.',
    es: 'Luz del recinto encendida.',
  },
  light_off: {
    en: 'Chamber light off.',
    fr: 'Lumière du caisson éteinte.',
    de: 'Bauraumlicht aus.',
    es: 'Luz del recinto apagada.',
  },
};
