// -----------------------------------------------------------------------------
// One Bambu Lab printer: the MQTT session, the merged status, the print
// events, the commands and the camera.
//
// The printer pushes its status about once a second; nothing is polled. On
// each connection the link asks for the version (model, firmware) and a full
// status (`pushall`); afterwards the P1 and A1 series only send what changed.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { captureFrame } from './bambu/camera.js';
import { MqttSession } from './bambu/mqtt.js';
import {
  ACTIVE_STATES,
  CANCELLED_ERROR,
  applyPrint,
  emptySnapshot,
  modelFromSerial,
  readVersion,
} from './bambu/model.js';
import { CAMERA_PORT, MQTT_PORT } from './bambu/tls.js';

const logger = createLogger({ name: 'bambulab-printer' });

export const DEFAULT_TIMINGS = {
  // Next attempt after a failure, doubled up to retryMax.
  retryDelay: 10_000,
  retryMax: 120_000,
  // After a refused access code: slowly, the printer may lock a client out.
  unauthorizedDelay: 300_000,
  // No report for this long: ask the printer to start pushing again.
  silence: 60_000,
  // How long a command waits for the printer's answer before assuming it.
  commandReply: 4_000,
  // A failed print waits this long for the `print_error` that says "cancelled".
  failedGrace: 3_000,
  // `pushall` is heavy for the P1 series: at most once in this interval.
  pushallGap: 60_000,
  // MQTT keep-alive, seconds.
  keepalive: 30,
  connectTimeout: 15_000,
  // Connected, but no status this long after `pushall`: a wrong serial number
  // (a broker may accept the subscription and simply send nothing).
  firstReport: 15_000,
  cameraTimeout: 10_000,
};

// The largest report seen is about 40 KB (H2D, two AMS).
const MAX_MESSAGE_BYTES = 1024 * 1024;

const COMMANDS_NEEDING_CONTROL = new Set(['pause', 'resume', 'stop', 'speed']);

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Events:
 * - `update` (snapshot, previous): the status changed;
 * - `version` ({ model, firmware }): the printer said what it is;
 * - `print` ({ type: started|paused|done|failed, file, seconds, reason, error }):
 *   a print event, from the state transitions;
 * - `hms` ({ code, severity }): a new HMS error;
 * - `started` (timestamp ms | null): the start of the print in progress
 *   changed (the hub keeps it under /data for the print time).
 */
export class PrinterLink extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.serial
   * @param {string} options.host IP address or host name ('' while unknown)
   * @param {string} options.accessCode
   * @param {(target: { host: string, port: number }) => import('node:stream').Duplex} options.connect
   * @param {object} [options.timings]
   * @param {number | null} [options.printStartedAt]
   * @param {() => number} [options.now]
   */
  constructor({ serial, host, accessCode, connect, timings = {}, printStartedAt = null, now }) {
    super();
    this.serial = serial;
    this.host = host;
    this.accessCode = accessCode;
    this.connectTransport = connect;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now ?? Date.now;
    this.snapshot = emptySnapshot();
    this.model = modelFromSerial(serial);
    this.firmware = '';
    this.versionKnown = false;
    this.connected = false;
    this.lastError = '';
    this.errorKind = '';
    this.running = false;
    this.session = null;
    this.timers = new Set();
    this.failures = 0;
    this.baseline = false;
    this.sequence = Math.floor(Math.random() * 10_000);
    this.pending = new Map();
    this.lastReportAt = 0;
    this.lastPushallAt = 0;
    this.printStartedAt = printStartedAt;
    this.cancelSeen = false;
    this.errorSeen = null;
    this.failedTimer = null;
    this.cameraBusy = null;
  }

  /** Whether the reports say anything (connected and reporting). */
  get reporting() {
    return this.connected && this.baseline;
  }

  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    if (!this.host) {
      this.#setState('unreachable', 'no_host', 'Address unknown: waiting for the network search');
      return;
    }
    this.#connect();
  }

  stop() {
    // A failed print still waiting for its cancellation code is reported now.
    if (this.failedTimer && this.reportFailed) {
      clearTimeout(this.failedTimer);
      this.reportFailed();
    }
    this.running = false;
    this.baseline = false;
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    clearTimeout(this.failedTimer);
    this.failedTimer = null;
    clearTimeout(this.firstReportTimer);
    clearInterval(this.watchdog);
    this.watchdog = null;
    this.#rejectPending('unreachable');
    this.session?.removeAllListeners('close');
    this.session?.close();
    this.session = null;
    this.connected = false;
  }

  /** A new address (found by the network search, or typed): reconnect there. */
  setHost(host) {
    if (!host || host === this.host) {
      return;
    }
    logger.info(`Printer ${this.serial}: now at ${host}`);
    this.host = host;
    if (this.running) {
      this.stop();
      this.failures = 0;
      this.start();
    }
  }

  #later(fn, ms) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    timer.unref?.();
    this.timers.add(timer);
  }

  async #connect() {
    if (!this.running) {
      return;
    }
    const session = new MqttSession({
      connect: () => this.connectTransport({ host: this.host, port: MQTT_PORT }),
      clientId: `gladys-bambulab-${randomUUID().slice(0, 8)}`,
      username: 'bblp',
      password: this.accessCode,
      topic: `device/${this.serial}/report`,
      keepalive: this.timings.keepalive,
      connectTimeout: this.timings.connectTimeout,
    });
    this.session = session;
    this.baseline = false;
    // Only once the session is ours and confirmed: a report arriving with the
    // SUBACK would otherwise be read before the connection is set up.
    session.on('message', (topic, payload) => {
      if (this.connected && this.session === session) {
        this.#onMessage(payload);
      }
    });
    session.on('close', (err) => this.#onClose(session, err));
    try {
      await session.open();
    } catch {
      return; // #onClose handles it
    }
    if (!this.running || this.session !== session) {
      session.close();
      return;
    }
    this.connected = true;
    this.failures = 0;
    this.baseline = false;
    this.lastError = '';
    this.errorKind = '';
    this.lastReportAt = this.now();
    logger.info(`Printer ${this.serial}: connected (${this.host})`);
    this.#publish({ info: { sequence_id: this.#nextSequence(), command: 'get_version' } });
    this.#pushall(true);
    clearTimeout(this.firstReportTimer);
    this.firstReportTimer = setTimeout(() => {
      if (this.connected && !this.baseline && this.session === session) {
        logger.warn(`Printer ${this.serial}: connected, but no status received`);
        this.#setState(
          this.snapshot.state,
          'no_report',
          'Connected, but the printer sends nothing',
        );
      }
    }, this.timings.firstReport);
    this.firstReportTimer.unref?.();
    clearInterval(this.watchdog);
    this.watchdog = setInterval(() => this.#checkSilence(), this.timings.silence);
    this.watchdog.unref?.();
    // Nothing reported yet: the state stays as it was until the first report.
    this.emit('update', this.snapshot, this.snapshot);
  }

  #onClose(session, err) {
    if (this.session !== session) {
      return;
    }
    this.session = null;
    clearTimeout(this.firstReportTimer);
    clearInterval(this.watchdog);
    this.watchdog = null;
    this.#rejectPending('unreachable');
    const wasConnected = this.connected;
    this.connected = false;
    this.baseline = false;
    if (!this.running) {
      return;
    }
    const kind = err?.kind ?? 'network';
    const message = err?.message ?? 'Connection closed';
    if (wasConnected || this.lastError !== message) {
      logger.warn(`Printer ${this.serial}: ${message}`);
    }
    this.failures += 1;
    if (kind === 'unauthorized') {
      this.#setState('unauthorized', kind, message);
      this.#later(() => this.#connect(), this.timings.unauthorizedDelay);
      return;
    }
    this.#setState('unreachable', kind, message);
    const delay = Math.min(
      this.timings.retryMax,
      this.timings.retryDelay * 2 ** Math.min(this.failures - 1, 6),
    );
    this.#later(() => this.#connect(), delay);
    this.emit('unreachable', this.failures);
  }

  #setState(state, kind, message) {
    this.lastError = message;
    this.errorKind = kind;
    const previous = this.snapshot;
    this.snapshot = { ...this.snapshot, state };
    this.emit('update', this.snapshot, previous);
  }

  #checkSilence() {
    if (!this.connected) {
      return;
    }
    if (this.now() - this.lastReportAt >= this.timings.silence) {
      // ha-bambulab's watchdog: the printer stops pushing now and then.
      this.#publish({ pushing: { sequence_id: this.#nextSequence(), command: 'start' } });
    }
  }

  #nextSequence() {
    this.sequence = (this.sequence + 1) % 1_000_000;
    return String(this.sequence);
  }

  #publish(message) {
    this.session?.publish(`device/${this.serial}/request`, JSON.stringify(message));
  }

  #pushall(force = false) {
    if (!force && this.now() - this.lastPushallAt < this.timings.pushallGap) {
      return;
    }
    this.lastPushallAt = this.now();
    this.#publish({ pushing: { sequence_id: this.#nextSequence(), command: 'pushall' } });
  }

  /** Asks for a full status now (Gladys' onPoll, the test action). */
  refresh() {
    if (this.connected) {
      this.#pushall();
    }
  }

  #onMessage(payload) {
    if (payload.length > MAX_MESSAGE_BYTES) {
      return;
    }
    let message;
    try {
      message = JSON.parse(payload.toString('utf8'));
    } catch {
      logger.debug(`Printer ${this.serial}: a report is not JSON`);
      return;
    }
    if (!message || typeof message !== 'object') {
      return;
    }
    this.lastReportAt = this.now();
    for (const part of ['print', 'system', 'info']) {
      const body = message[part];
      if (body && typeof body === 'object') {
        this.#settlePending(body);
      }
    }
    if (message.info?.command === 'get_version') {
      const { model, firmware } = readVersion(message.info);
      this.model = model ?? this.model;
      this.firmware = firmware || this.firmware;
      this.versionKnown = true;
      this.emit('version', { model: this.model, firmware: this.firmware });
    }
    if (message.print && typeof message.print === 'object') {
      this.#applyReport(message.print);
    }
  }

  #applyReport(print) {
    const previous = this.snapshot;
    const next = applyPrint(previous, print);
    if (next.state === previous.state && !this.baseline && typeof print.gcode_state !== 'string') {
      // Before the first status of this connection: the state is not known yet.
      this.snapshot = next;
      return;
    }
    this.snapshot = next;
    if (!this.baseline) {
      // The first status after a connection: no event (it may be hours old).
      this.baseline = true;
      clearTimeout(this.firstReportTimer);
      if (this.errorKind === 'no_report') {
        this.errorKind = '';
        this.lastError = '';
      }
      if (ACTIVE_STATES.has(next.state) && this.printStartedAt === null) {
        this.#setStart(next.gcodeStartTime ? next.gcodeStartTime * 1000 : null);
      }
      this.emit('update', next, previous);
      return;
    }
    this.#deriveEvents(previous, next);
    this.emit('update', next, previous);
  }

  #setStart(timestamp) {
    if (this.printStartedAt !== timestamp) {
      this.printStartedAt = timestamp;
      this.emit('started', timestamp);
    }
  }

  #printSeconds() {
    if (this.printStartedAt === null) {
      return null;
    }
    return Math.max(0, Math.round((this.now() - this.printStartedAt) / 1000));
  }

  #deriveEvents(previous, next) {
    const file = next.task || previous.task || next.file;
    const idle = (state) => ['idle', 'finished', 'failed'].includes(state);
    if (
      idle(previous.state) &&
      ['preparing', 'printing'].includes(next.state) &&
      previous.state !== next.state
    ) {
      this.cancelSeen = false;
      this.errorSeen = null;
      this.#setStart(this.now());
      this.emit('print', { type: 'started', file, seconds: null, reason: null, error: null });
    }
    // A cancellation sets `print_error` to 0300_400C for a few seconds, before
    // or after the FAILED state; any other code is the cause of a failure.
    if (next.printError && (ACTIVE_STATES.has(previous.state) || next.state === 'failed')) {
      if (next.printError === CANCELLED_ERROR) {
        this.cancelSeen = true;
      } else {
        this.errorSeen = next.printError;
      }
    }
    if (
      next.state === 'paused' &&
      previous.state !== 'paused' &&
      ACTIVE_STATES.has(previous.state)
    ) {
      this.emit('print', {
        type: 'paused',
        file,
        seconds: this.#printSeconds(),
        reason: null,
        error: next.printError,
      });
    }
    if (next.state === 'finished' && previous.state !== 'finished') {
      this.emit('print', {
        type: 'done',
        file,
        seconds: this.#printSeconds(),
        reason: null,
        error: null,
      });
      this.#setStart(null);
    }
    if (next.state === 'failed' && previous.state !== 'failed') {
      const seconds = this.#printSeconds();
      this.#setStart(null);
      clearTimeout(this.failedTimer);
      this.reportFailed = () => {
        this.failedTimer = null;
        this.reportFailed = null;
        const cancelled = this.cancelSeen;
        const error = cancelled ? null : this.errorSeen;
        this.cancelSeen = false;
        this.errorSeen = null;
        this.emit('print', {
          type: 'failed',
          file,
          seconds,
          reason: cancelled ? 'cancelled' : 'error',
          error,
        });
      };
      this.failedTimer = setTimeout(() => this.reportFailed?.(), this.timings.failedGrace);
      this.failedTimer.unref?.();
    }
    const known = new Set(previous.hms.map((entry) => entry.code));
    for (const entry of next.hms) {
      if (!known.has(entry.code)) {
        this.emit('hms', entry);
      }
    }
  }

  // --- Commands ---------------------------------------------------------------

  #settlePending(body) {
    const id = body.sequence_id === undefined ? null : String(body.sequence_id);
    const pending = id === null ? null : this.pending.get(id);
    if (!pending || (body.command && body.command !== pending.command)) {
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const result = typeof body.result === 'string' ? body.result.toLowerCase() : '';
    if (result.startsWith('fail')) {
      const reason = typeof body.reason === 'string' && body.reason ? body.reason : result;
      pending.reject(codedError('refused', `The printer refused ${pending.command}: ${reason}`));
    } else {
      pending.resolve();
    }
  }

  #rejectPending(code) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(codedError(code, 'The printer connection closed'));
      this.pending.delete(id);
    }
  }

  /** Publishes a request and waits for its answer (or assumes it after a while). */
  #request(part, body) {
    const id = this.#nextSequence();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // Not every firmware answers every command: no answer is not a refusal.
        this.pending.delete(id);
        resolve();
      }, this.timings.commandReply);
      this.pending.set(id, { command: body.command, resolve, reject, timer });
      try {
        this.#publish({ [part]: { sequence_id: id, ...body } });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(codedError('unreachable', err.message));
      }
    });
  }

  /**
   * Runs a command. Throws an Error whose `code` the callers turn into a
   * message: `unreachable`, `locked`, `not_printing`, `not_paused`,
   * `no_light`, `refused`.
   * @param {'pause'|'resume'|'stop'|'speed'|'light'} name
   * @param {unknown} [value] speed level 1-4, or light 'on'/'off'
   */
  async command(name, value) {
    if (!this.reporting) {
      throw codedError('unreachable', `Printer ${this.serial} is not connected`);
    }
    const { state } = this.snapshot;
    if (COMMANDS_NEEDING_CONTROL.has(name) && this.snapshot.signatureRequired) {
      throw codedError('locked', 'The firmware only accepts commands from Bambu Lab software');
    }
    switch (name) {
      case 'pause':
        if (!['printing', 'preparing'].includes(state)) {
          throw codedError('not_printing', 'No print in progress');
        }
        await this.#request('print', { command: 'pause', param: '' });
        break;
      case 'resume':
        if (state !== 'paused') {
          throw codedError('not_paused', 'The print is not paused');
        }
        await this.#request('print', { command: 'resume', param: '' });
        break;
      case 'stop':
        if (!ACTIVE_STATES.has(state)) {
          throw codedError('not_printing', 'No print in progress');
        }
        await this.#request('print', { command: 'stop', param: '' });
        break;
      case 'speed':
        if (!ACTIVE_STATES.has(state)) {
          throw codedError('not_printing', 'No print in progress');
        }
        await this.#request('print', { command: 'print_speed', param: String(value) });
        break;
      case 'light':
        if (this.snapshot.light === null) {
          throw codedError('no_light', 'This printer reports no chamber light');
        }
        await this.#request('system', {
          command: 'ledctrl',
          led_node: 'chamber_light',
          led_mode: value === 'on' ? 'on' : 'off',
          led_on_time: 500,
          led_off_time: 500,
          loop_times: 0,
          interval_time: 0,
        });
        break;
      default:
        throw new Error(`Unknown command ${name}`);
    }
  }

  // --- Camera -------------------------------------------------------------------

  /** One JPEG from the camera (P1, A1). Concurrent callers share the capture. */
  cameraFrame() {
    if (!this.host) {
      return Promise.reject(codedError('unreachable', 'Address unknown'));
    }
    if (!this.cameraBusy) {
      this.cameraBusy = captureFrame({
        connect: () => this.connectTransport({ host: this.host, port: CAMERA_PORT }),
        accessCode: this.accessCode,
        timeout: this.timings.cameraTimeout,
      }).finally(() => {
        this.cameraBusy = null;
      });
    }
    return this.cameraBusy;
  }
}
