// -----------------------------------------------------------------------------
// The hub: one PrinterLink per configured printer, and everything Gladys sees
// of them — devices, states, connection status, scene events, commands,
// camera images, the network search.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { hmsText, printErrorText } from './bambu/hms.js';
import { printersFromScan } from './bambu/discovery.js';
import {
  ACTIVE_STATES,
  MODELS,
  SPEED_LEVELS,
  readCapabilities,
  sameStructure,
} from './bambu/model.js';
import { connectTls } from './bambu/tls.js';
import { SLOTS } from './config.js';
import {
  buildDevice,
  buildStates,
  defaultName,
  deviceIds,
  featureKeyOf,
  modelLabel,
  serialOf,
} from './devices.js';
import { PrinterLink } from './printer.js';
import {
  FIND_TEXT,
  STATE_LABELS,
  STATUS_TEXT,
  TEST_TEXT,
  UNKNOWN_ERROR,
  commandMessage,
  formatDuration,
} from './texts.js';

const logger = createLogger({ name: 'bambulab-hub' });

export const WIDGET_KEY = 'printer';

// Scene trigger keys (manifest `scene_triggers`), by print event type.
export const TRIGGERS = {
  started: 'print_started',
  done: 'print_done',
  failed: 'print_failed',
  paused: 'print_paused',
  hms: 'hms_error',
};

// The core refuses camera images over 150 KB (the data URI included).
export const MAX_IMAGE_BYTES = 150 * 1024;
// And widget images over 300 KB (decoded).
export const MAX_WIDGET_IMAGE_BYTES = 300 * 1024;

export const DEFAULT_HUB_TIMINGS = {
  // At most one batch of states per printer in this interval (a report comes
  // every second; Gladys takes 300 states a minute for the whole integration).
  stateGap: 5_000,
  // Camera image pushed to Gladys during a print (the dashboard camera box
  // and the widget show the last one).
  cameraInterval: 60_000,
  // How long to wait for get_version before publishing with what is known.
  versionWait: 10_000,
  // At most one automatic network search in this interval.
  searchGap: 600_000,
  // Network search duration (the printers announce themselves every few seconds).
  searchSeconds: 10,
};

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language) {
    const message = commandMessage(code);
    super(message[language] ?? message.en);
    this.code = code;
    this.messages = message;
  }
}

export class Hub {
  /**
   * @param {object} options
   * @param {object} options.gladys
   * @param {object} options.store
   * @param {Function} [options.connect] ({ host, port, verify }) => Duplex (TLS by default)
   * @param {object} [options.timings] PrinterLink timings
   * @param {object} [options.hubTimings]
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, connect, timings, hubTimings, now = Date.now }) {
    this.gladys = gladys;
    this.store = store;
    this.connect = connect ?? connectTls;
    this.timings = timings;
    this.hubTimings = { ...DEFAULT_HUB_TIMINGS, ...hubTimings };
    this.now = now;
    this.config = {
      printers: [],
      problems: [],
      camera: true,
      checkCertificate: true,
      language: 'fr',
    };
    // serial -> printer (see #addPrinter)
    this.printers = new Map();
    // serial -> what a previous run learned (store)
    this.known = {};
    // serial -> the last announcement heard by the network search
    this.found = new Map();
    this.searching = null;
    this.lastSearchAt = 0;
    this.lastStatus = '';
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.cameraTimer = null;
    this.imageCounter = 0;
    this.stopped = false;
  }

  get language() {
    return this.config.language;
  }

  async start(config) {
    const saved = await this.store.load();
    this.known =
      saved && typeof saved.printers === 'object' && saved.printers ? saved.printers : {};
    await this.reconfigure(config);
    this.cameraTimer = setInterval(() => this.#cameraRound(), this.hubTimings.cameraInterval);
    this.cameraTimer.unref?.();
  }

  /** New configuration: restart the printers whose address, code or options changed. */
  async reconfigure(config) {
    const previous = this.config;
    const languageChanged = config.language !== previous.language;
    const transportChanged = config.checkCertificate !== previous.checkCertificate;
    this.config = config;
    const wanted = new Map(config.printers.map((p) => [p.serial, p]));
    for (const [serial, printer] of this.printers) {
      const next = wanted.get(serial);
      if (
        !next ||
        transportChanged ||
        next.host !== printer.configuredHost ||
        next.accessCode !== printer.accessCode
      ) {
        this.#removePrinter(printer);
      } else {
        printer.slot = next.slot;
      }
    }
    for (const [serial, settings] of wanted) {
      if (!this.printers.has(serial)) {
        this.#addPrinter(settings);
      }
    }
    await this.publishDevices();
    if (languageChanged) {
      await this.publishAllStates();
    }
    await this.updateConnectionStatus();
    this.refreshWidget();
    if ([...this.printers.values()].some((printer) => !printer.link.host)) {
      this.search({ automatic: true }).catch(() => {});
    }
  }

  /** Gladys reconnected (it may have restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    await this.reconfigure(config);
    await this.publishAllStates();
    this.lastStatus = '';
    await this.updateConnectionStatus();
  }

  stop() {
    this.stopped = true;
    for (const printer of this.printers.values()) {
      this.#stopPrinter(printer);
    }
    clearTimeout(this.widgetTimer);
    clearInterval(this.cameraTimer);
    return this.store.flush();
  }

  #saveKnown() {
    this.store.save({ printers: this.known });
  }

  #remember(serial, values) {
    this.known[serial] = { ...this.known[serial], ...values };
    this.#saveKnown();
  }

  #addPrinter(settings) {
    const { slot, serial, host, accessCode } = settings;
    const known = this.known[serial] ?? {};
    const verify = this.config.checkCertificate;
    const startedAt = Number.isFinite(known.printStartedAt) ? known.printStartedAt : null;
    const link = new PrinterLink({
      serial,
      // A typed address wins; otherwise the one the network search found last.
      host: host || (typeof known.host === 'string' ? known.host : ''),
      accessCode,
      connect: ({ host: target, port }) => this.connect({ host: target, port, verify }),
      timings: this.timings,
      printStartedAt: startedAt,
      now: this.now,
    });
    const printer = {
      slot,
      serial,
      configuredHost: host,
      accessCode,
      link,
      capabilities: known.capabilities ?? null,
      name: typeof known.name === 'string' ? known.name : '',
      lastPublishAt: 0,
      publishTimer: null,
      versionTimer: null,
      image: null, // { data: Buffer, key: string }
      cameraError: null,
    };
    this.printers.set(serial, printer);
    link.on('update', (snapshot, previous) => this.#onUpdate(printer, snapshot, previous));
    link.on('version', () => this.#checkCapabilities(printer));
    link.on('print', (event) => this.#onPrint(printer, event));
    link.on('hms', (entry) => this.#onHms(printer, entry));
    link.on('started', (timestamp) => this.#remember(serial, { printStartedAt: timestamp }));
    link.on('unreachable', (failures) => {
      if (failures === 3) {
        // The printer may have a new address (DHCP): look for it.
        this.search({ automatic: true }).catch(() => {});
      }
    });
    link.start();
  }

  #stopPrinter(printer) {
    printer.link.stop();
    clearTimeout(printer.publishTimer);
    clearTimeout(printer.versionTimer);
    printer.publishTimer = null;
    printer.versionTimer = null;
  }

  #removePrinter(printer) {
    this.#stopPrinter(printer);
    this.printers.delete(printer.serial);
  }

  // --- Devices and states -------------------------------------------------

  #buildDevice(printer) {
    return buildDevice(
      this.gladys,
      {
        serial: printer.serial,
        host: printer.link.host,
        name: printer.name,
        capabilities: printer.capabilities,
      },
      this.language,
      { camera: this.config.camera },
    );
  }

  /** Every printer whose structure is known, as Gladys devices. */
  buildDevices() {
    return [...this.printers.values()]
      .filter((printer) => printer.capabilities)
      .sort((a, b) => a.slot - b.slot)
      .map((printer) => this.#buildDevice(printer));
  }

  async publishDevices() {
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      logger.error('Cannot publish the devices', err);
    }
  }

  isCreated(printer) {
    const id = deviceIds(this.gladys, printer.serial).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  async #checkCapabilities(printer) {
    const { link } = printer;
    if (!link.reporting) {
      return;
    }
    if (!link.versionKnown && !MODELS[link.model]) {
      // Wait a little for get_version, then go with what is known.
      if (!printer.versionTimer) {
        printer.versionTimer = setTimeout(() => {
          printer.versionTimer = null;
          if (link.reporting) {
            this.#applyCapabilities(printer);
          }
        }, this.hubTimings.versionWait);
        printer.versionTimer.unref?.();
      }
      return;
    }
    clearTimeout(printer.versionTimer);
    printer.versionTimer = null;
    await this.#applyCapabilities(printer);
  }

  async #applyCapabilities(printer) {
    const { link } = printer;
    const capabilities = readCapabilities({
      model: link.model,
      firmware: link.firmware,
      snapshot: link.snapshot,
      previous: printer.capabilities,
    });
    const changed = !sameStructure(printer.capabilities, capabilities);
    const firmwareChanged = printer.capabilities?.firmware !== capabilities.firmware;
    printer.capabilities = capabilities;
    if (changed || firmwareChanged) {
      this.#remember(printer.serial, { capabilities });
    }
    if (changed) {
      logger.info(
        `Printer ${printer.serial}: ${modelLabel(capabilities.model)}, firmware ${capabilities.firmware || '?'}`,
      );
      await this.publishDevices();
      this.#queueStates(printer, true);
      this.refreshWidget();
    }
  }

  #onUpdate(printer, snapshot, previous) {
    if (snapshot.state !== previous.state || printer.link.errorKind !== printer.lastErrorKind) {
      printer.lastErrorKind = printer.link.errorKind;
      this.updateConnectionStatus().catch(() => {});
    }
    if (!printer.link.reporting) {
      printer.checked = false; // the firmware may change before the next connection
      this.#queueStates(printer, snapshot.state !== previous.state);
      return;
    }
    if (
      !printer.checked ||
      (snapshot.light !== null && printer.capabilities && !printer.capabilities.light)
    ) {
      // First report of the run: confirm what the printer has.
      printer.checked = true;
      this.#checkCapabilities(printer).catch((err) =>
        logger.warn(`Printer ${printer.serial}: ${err.message}`),
      );
    }
    const urgent =
      snapshot.state !== previous.state ||
      snapshot.light !== previous.light ||
      snapshot.speed !== previous.speed ||
      snapshot.task !== previous.task;
    this.#queueStates(printer, urgent);
    if (
      urgent ||
      snapshot.hms.length !== previous.hms.length ||
      snapshot.ams !== previous.ams ||
      snapshot.signatureRequired !== previous.signatureRequired
    ) {
      this.refreshWidget();
    }
  }

  /** States now (`urgent`), or at most once per stateGap per printer. */
  #queueStates(printer, urgent = false) {
    if (!printer.capabilities || this.stopped || this.printers.get(printer.serial) !== printer) {
      return;
    }
    const wait = urgent ? 0 : printer.lastPublishAt + this.hubTimings.stateGap - this.now();
    if (wait <= 0) {
      clearTimeout(printer.publishTimer);
      printer.publishTimer = null;
      printer.lastPublishAt = this.now();
      this.#publishStates(printer);
      return;
    }
    if (!printer.publishTimer) {
      printer.publishTimer = setTimeout(() => {
        printer.publishTimer = null;
        this.#queueStates(printer, true);
      }, wait);
      printer.publishTimer.unref?.();
    }
  }

  async #publishStates(printer) {
    if (!printer.capabilities || this.stopped) {
      return;
    }
    const states = buildStates(
      this.gladys,
      { serial: printer.serial, capabilities: printer.capabilities },
      printer.link.snapshot,
      this.language,
    );
    try {
      await this.gladys.publishChangedStates(states);
    } catch (err) {
      logger.warn(`Cannot publish the states of printer ${printer.serial}: ${err.message}`);
    }
  }

  async publishAllStates() {
    for (const printer of this.printers.values()) {
      printer.lastPublishAt = this.now();
      await this.#publishStates(printer);
    }
  }

  /** The user added a device: states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const printer = this.printers.get(serialOf(this.gladys, device?.external_id));
    if (!printer) {
      return;
    }
    this.gladys.forgetPublishedStates?.(device.external_id);
    printer.lastPublishAt = this.now();
    await this.#publishStates(printer);
    if (this.#cameraWanted(printer)) {
      this.#pushCamera(printer);
    }
    this.refreshWidget();
  }

  // --- Scene events ---------------------------------------------------------

  #deviceName(printer) {
    const id = deviceIds(this.gladys, printer.serial).device;
    const created = (this.gladys.devices ?? []).find((device) => device.external_id === id);
    return created?.name ?? defaultName({ name: printer.name, capabilities: printer.capabilities });
  }

  #errorMessage(printer, code) {
    if (!code) {
      return '';
    }
    return (
      printErrorText(code, printer.capabilities?.model, this.language) ??
      UNKNOWN_ERROR[this.language]
    );
  }

  async #fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Cannot fire ${key}: ${err.message}`);
    }
  }

  async #onPrint(printer, event) {
    const key = TRIGGERS[event.type];
    if (!key) {
      return;
    }
    const data = {
      device: deviceIds(this.gladys, printer.serial).device,
      printer: this.#deviceName(printer),
      file: event.file ?? '',
    };
    if (event.type !== 'started') {
      data.duration = formatDuration(event.seconds, this.language);
      data.duration_minutes =
        typeof event.seconds === 'number' ? Math.round(event.seconds / 60) : null;
    }
    if (event.type === 'failed') {
      data.reason = event.reason;
    }
    if (event.type === 'failed' || event.type === 'paused') {
      data.error_code = event.error ?? '';
      data.error_message = this.#errorMessage(printer, event.error);
    }
    logger.info(`Printer ${printer.serial}: print ${event.type} (${data.file})`);
    await this.#fire(key, data);
    if (event.type !== 'started' && this.#cameraWanted(printer)) {
      // The last image of the print stays on the dashboard.
      this.#pushCamera(printer);
    }
    this.refreshWidget();
  }

  async #onHms(printer, entry) {
    const message =
      hmsText(entry.code, printer.capabilities?.model, this.language) ??
      UNKNOWN_ERROR[this.language];
    logger.info(`Printer ${printer.serial}: HMS ${entry.code} (${entry.severity})`);
    await this.#fire(TRIGGERS.hms, {
      device: deviceIds(this.gladys, printer.serial).device,
      printer: this.#deviceName(printer),
      code: entry.code,
      severity: entry.severity,
      message: message.slice(0, 1000),
    });
  }

  // --- Widget ---------------------------------------------------------------

  /** Nudge the open dashboards, with a trailing call inside the core's 10 s gap. */
  refreshWidget() {
    if (this.stopped) {
      return;
    }
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- Connection status ----------------------------------------------------

  statusMessage() {
    const lines = Object.fromEntries(Object.keys(STATUS_TEXT).map((language) => [language, []]));
    const add = (key, slot) => {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table[key](slot));
      }
    };
    const problems = new Map(this.config.problems.map((problem) => [problem.slot, problem.reason]));
    const bySlot = new Map([...this.printers.values()].map((printer) => [printer.slot, printer]));
    for (const slot of SLOTS) {
      if (problems.has(slot)) {
        add(problems.get(slot), slot);
        continue;
      }
      const printer = bySlot.get(slot);
      if (!printer) {
        continue;
      }
      const { link } = printer;
      if (link.connected) {
        if (link.errorKind === 'no_report') {
          add('silent', slot);
        }
        continue;
      }
      if (link.errorKind === 'no_host') {
        add('searching', slot);
      } else if (link.errorKind === 'unauthorized') {
        add('unauthorized', slot);
      } else if (link.errorKind === 'certificate') {
        add('certificate', slot);
      } else if (link.errorKind) {
        // Only once an attempt failed (a fresh start says nothing yet).
        add('unreachable', slot);
      }
    }
    if (this.printers.size === 0 && this.config.problems.length === 0) {
      for (const [language, table] of Object.entries(STATUS_TEXT)) {
        lines[language].push(table.none);
      }
    }
    if (lines.en.length === 0) {
      return null;
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ').slice(0, 500)]),
    );
  }

  async updateConnectionStatus() {
    if (this.stopped) {
      return;
    }
    const message = this.statusMessage();
    const links = [...this.printers.values()].map((p) => p.link);
    const connected = message === null && links.some((link) => link.connected);
    // A printer still on its first attempt: nothing to say yet.
    if (!connected && message === null && links.some((l) => !l.connected && !l.errorKind)) {
      return;
    }
    const fingerprint = JSON.stringify({ connected, message });
    if (fingerprint === this.lastStatus) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, message ?? undefined);
    } catch (err) {
      logger.warn(`Cannot set the connection status: ${err.message}`);
    }
  }

  // --- Network search -------------------------------------------------------

  /**
   * Listens to the printers' announcements through Gladys (udp-broadcast
   * capture). Resolves the printers heard, or null when the search is not
   * available. A printer heard at a new address is reconnected there.
   */
  search({ automatic = false } = {}) {
    if (this.searching) {
      return this.searching;
    }
    if (automatic && this.now() - this.lastSearchAt < this.hubTimings.searchGap) {
      return Promise.resolve(null);
    }
    this.lastSearchAt = this.now();
    this.searching = this.#search().finally(() => {
      this.searching = null;
    });
    return this.searching;
  }

  async #search() {
    let results;
    try {
      results = await this.gladys.scanNetwork('udp-broadcast', {
        timeoutSeconds: this.hubTimings.searchSeconds,
      });
    } catch (err) {
      logger.warn(`Network search unavailable: ${err.message}`);
      return null;
    }
    if (this.stopped) {
      return null;
    }
    const found = printersFromScan(results);
    let renamed = false;
    for (const announcement of found) {
      this.found.set(announcement.serial, announcement);
      const printer = this.printers.get(announcement.serial);
      if (!printer) {
        continue;
      }
      if (announcement.name && announcement.name !== printer.name) {
        printer.name = announcement.name;
        this.#remember(printer.serial, { name: printer.name });
        renamed = true;
      }
      // A typed address is kept while it answers; otherwise follow the printer.
      if (
        announcement.host !== printer.link.host &&
        (!printer.configuredHost || !printer.link.connected)
      ) {
        if (!printer.configuredHost) {
          this.#remember(printer.serial, { host: announcement.host });
        }
        printer.link.setHost(announcement.host);
        await this.publishDevices();
        await this.updateConnectionStatus();
      }
    }
    if (renamed) {
      await this.publishDevices();
    }
    return found;
  }

  // --- Commands -----------------------------------------------------------

  #printerOf(externalId) {
    const printer = this.printers.get(serialOf(this.gladys, externalId));
    if (!printer) {
      throw new CommandError('unknown_device', this.language);
    }
    return printer;
  }

  /**
   * Run a command on the printer of a device external id. Throws a
   * CommandError (coded, multi-language) when the printer refuses it.
   */
  async command(externalId, name, value) {
    const printer = this.#printerOf(externalId);
    try {
      await printer.link.command(name, value);
    } catch (err) {
      if (err.code) {
        throw new CommandError(err.code, this.language);
      }
      throw err;
    }
    this.refreshWidget();
    return printer;
  }

  /** A speed name (`sport`) or level (3) -> the level, or throws. */
  speedLevel(value) {
    const level =
      typeof value === 'string' && SPEED_LEVELS[value.trim().toLowerCase()]
        ? SPEED_LEVELS[value.trim().toLowerCase()]
        : Number(value);
    if (![1, 2, 3, 4].includes(level)) {
      throw new CommandError('unknown_speed', this.language);
    }
    return level;
  }

  /** onSetValue: speed, chamber light, pause and resume (everything else is read only). */
  async setValue(device, feature, value) {
    const key = featureKeyOf(feature?.external_id);
    switch (key) {
      case 'pause':
      case 'resume':
        await this.command(device.external_id, key);
        return;
      case 'speed':
        await this.command(device.external_id, 'speed', this.speedLevel(value));
        return;
      case 'light':
        await this.command(device.external_id, 'light', Number(value) === 1 ? 'on' : 'off');
        return;
      default:
        throw new Error(`Feature ${key} cannot be controlled`);
    }
  }

  /** onPoll (the devices are not polled; this only serves a Gladys that would). */
  async poll(device) {
    this.printers.get(serialOf(this.gladys, device?.external_id))?.link.refresh();
  }

  // --- Camera -------------------------------------------------------------------

  #cameraWanted(printer) {
    return Boolean(this.config.camera && printer.capabilities?.camera);
  }

  /** A fresh JPEG from the camera, kept for the widget. Throws a CommandError. */
  async captureImage(printer) {
    if (!printer.capabilities?.camera) {
      throw new CommandError('no_camera', this.language);
    }
    if (!this.config.camera) {
      throw new CommandError('camera_disabled', this.language);
    }
    let data;
    try {
      data = await printer.link.cameraFrame();
    } catch (err) {
      throw new CommandError(err.code ?? 'unreachable', this.language);
    }
    if (data.length <= MAX_WIDGET_IMAGE_BYTES) {
      this.imageCounter = (this.imageCounter + 1) % 1_000_000;
      printer.image = { data, key: `camera-${printer.serial.toLowerCase()}-${this.imageCounter}` };
      this.refreshWidget();
    }
    return data;
  }

  /** onGetImage: a fresh camera image, as Gladys wants it. */
  async getImage(device) {
    const printer = this.#printerOf(device?.external_id);
    const data = await this.captureImage(printer);
    const encoded = `image/jpg;base64,${data.toString('base64')}`;
    if (encoded.length > MAX_IMAGE_BYTES) {
      throw new CommandError('camera_size', this.language);
    }
    return encoded;
  }

  /** onWidgetGetImage: the last camera image of a printer, by its key. */
  widgetImage(key) {
    const printer = [...this.printers.values()].find((p) => p.image?.key === key);
    if (!printer) {
      throw new Error(`Unknown image ${key}`);
    }
    return printer.image.data.toString('base64');
  }

  async #pushCamera(printer) {
    if (!this.isCreated(printer) || !printer.link.reporting || !this.#cameraWanted(printer)) {
      return;
    }
    try {
      const data = await this.captureImage(printer);
      const encoded = `image/jpg;base64,${data.toString('base64')}`;
      if (encoded.length > MAX_IMAGE_BYTES) {
        throw new Error(`image of ${Math.round(data.length / 1024)} KB, Gladys takes 150 KB`);
      }
      await this.gladys.publishCameraImage(
        deviceIds(this.gladys, printer.serial).feature('camera'),
        encoded,
      );
    } catch (err) {
      if (printer.cameraError !== err.message) {
        logger.warn(`Printer ${printer.serial}: no camera image (${err.message})`);
      }
      printer.cameraError = err.message;
      return;
    }
    printer.cameraError = null;
  }

  #cameraRound() {
    for (const printer of this.printers.values()) {
      if (this.#cameraWanted(printer) && ACTIVE_STATES.has(printer.link.snapshot.state)) {
        this.#pushCamera(printer);
      }
    }
  }

  // --- Configuration actions ---------------------------------------------------

  async testReport() {
    if (this.printers.size === 0) {
      return Object.fromEntries(Object.entries(TEST_TEXT).map(([lang, t]) => [lang, t.none]));
    }
    const lines = Object.fromEntries(Object.keys(TEST_TEXT).map((language) => [language, []]));
    for (const printer of [...this.printers.values()].sort((a, b) => a.slot - b.slot)) {
      const { link } = printer;
      link.refresh();
      const { state } = link.snapshot;
      for (const [language, table] of Object.entries(TEST_TEXT)) {
        const label = STATE_LABELS[language][state];
        if (link.reporting) {
          lines[language].push(
            table.ok(printer.slot, modelLabel(link.model), link.firmware || '?', label),
          );
          if (link.snapshot.signatureRequired) {
            lines[language].push(table.locked);
          }
        } else {
          lines[language].push(table.failed(printer.slot, label));
        }
      }
    }
    return Object.fromEntries(
      Object.entries(lines).map(([language, list]) => [language, list.join(' ')]),
    );
  }

  async findReport() {
    const found = await this.search();
    if (found === null) {
      return Object.fromEntries(
        Object.entries(FIND_TEXT).map(([lang, t]) => [lang, t.unavailable]),
      );
    }
    if (found.length === 0) {
      return Object.fromEntries(Object.entries(FIND_TEXT).map(([lang, t]) => [lang, t.none]));
    }
    return Object.fromEntries(
      Object.entries(FIND_TEXT).map(([language, table]) => [
        language,
        found
          .map((announcement) => {
            const model = announcement.model ? modelLabel(announcement.model) : 'Bambu Lab';
            const parts = [
              table.found(
                announcement.name || model,
                model,
                announcement.host,
                announcement.serial,
              ),
            ];
            if (announcement.mode === 'lan') {
              parts.push(table.lan);
            }
            const printer = this.printers.get(announcement.serial);
            if (printer) {
              parts.push(table.configured(printer.slot));
            }
            return `${parts.join(', ')}.`;
          })
          .join(' '),
      ]),
    );
  }
}
