// -----------------------------------------------------------------------------
// A fake Bambu Lab printer for the tests: its MQTT broker (port 8883) and its
// camera (port 6000), on in-memory streams — no socket, no network.
//
// The broker speaks enough MQTT 3.1.1 to be a strict peer: it checks the user
// name and the access code (CONNACK 5 otherwise), accepts only the report
// topic of its serial number (SUBACK 0x80 otherwise), answers `pushall` with
// its full status and `get_version` with its modules (real reports from
// ha-bambulab, test/fixtures/reports), and echoes every command with a
// result, as the printers do.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { duplexPair } from 'node:stream';
import { publishPacket, readPublish, splitPackets } from '../../src/bambu/mqtt.js';

// Silent integration logs (LOG_LEVEL is read on every log call);
// LOG_LEVEL=debug npm test shows them.
process.env.LOG_LEVEL ??= 'silent';

export const ACCESS_CODE = '12345678';

export function report(name) {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/reports/${name}.json`, import.meta.url), 'utf8'),
  );
}

/** Lets pending stream callbacks and promises run. */
export const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** A small valid-looking JPEG frame (SOI ... EOI). */
export function jpeg(size = 64) {
  const data = Buffer.alloc(size, 0x11);
  data[0] = 0xff;
  data[1] = 0xd8;
  data[2] = 0xff;
  data[3] = 0xe0;
  data[size - 2] = 0xff;
  data[size - 1] = 0xd9;
  return data;
}

export class FakePrinter {
  /**
   * @param {object} [options]
   * @param {string} [options.fixture] a file of test/fixtures/reports
   * @param {string} [options.host]
   * @param {string} [options.accessCode]
   * @param {object} [options.overrides] fields replacing those of the fixture's status
   */
  constructor({
    fixture = 'p1p-ams',
    host = '192.0.2.10',
    accessCode = ACCESS_CODE,
    overrides = {},
  } = {}) {
    const data = report(fixture);
    this.serial = data.serial;
    this.host = host;
    this.accessCode = accessCode;
    this.info = data.info;
    this.status = { ...data.print, ...overrides };
    this.clients = new Set();
    this.requests = [];
    this.connections = 0;
    this.online = true;
    // How the printer answers commands: 'success', 'failed' or 'silent'.
    this.answer = 'success';
    this.answerVersion = true;
    this.lenientTopics = false;
    this.cameraFrames = [jpeg()];
    this.cameraConnections = 0;
  }

  /** The client side of a new connection to `port`. */
  accept(port) {
    if (!this.online) {
      const [client] = duplexPair();
      setImmediate(() => client.destroy(new Error(`connect ECONNREFUSED ${this.host}:${port}`)));
      return client;
    }
    const [client, server] = duplexPair();
    if (port === 6000) {
      this.#camera(server);
    } else {
      this.#broker(server);
    }
    return client;
  }

  #broker(socket) {
    this.connections += 1;
    const session = { socket, subscribed: false, buffer: Buffer.alloc(0) };
    socket.on('data', (chunk) => {
      session.buffer = Buffer.concat([session.buffer, chunk]);
      const { packets, rest } = splitPackets(session.buffer);
      session.buffer = Buffer.from(rest);
      for (const packet of packets) {
        this.#onPacket(session, packet);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => this.clients.delete(session));
  }

  #onPacket(session, { type, flags, body }) {
    const { socket } = session;
    switch (type) {
      case 1: {
        // CONNECT: protocol name, level, flags, keepalive, client id, user, password.
        let offset = 2 + body.readUInt16BE(0) + 4;
        const read = () => {
          const length = body.readUInt16BE(offset);
          const value = body.subarray(offset + 2, offset + 2 + length).toString('utf8');
          offset += 2 + length;
          return value;
        };
        read(); // client id
        const user = read();
        const password = read();
        const ok = user === 'bblp' && password === this.accessCode;
        socket.write(Buffer.from([0x20, 2, 0, ok ? 0 : 5]));
        if (!ok) {
          socket.end();
        }
        return;
      }
      case 8: {
        // SUBSCRIBE
        const id = body.subarray(0, 2);
        const length = body.readUInt16BE(2);
        const topic = body.subarray(4, 4 + length).toString('utf8');
        const ok = topic === `device/${this.serial}/report`;
        // Mosquitto grants a subscription its ACL refuses (MQTT 3.1.1), and
        // then sends nothing: `lenientTopics` plays that broker.
        const granted = ok || this.lenientTopics;
        socket.write(
          Buffer.concat([Buffer.from([0x90, 3]), id, Buffer.from([granted ? 0 : 0x80])]),
        );
        if (ok) {
          session.subscribed = true;
          this.clients.add(session);
        }
        return;
      }
      case 3: {
        const { topic, payload } = readPublish(flags, body);
        if (topic !== `device/${this.serial}/request`) {
          return;
        }
        this.#onRequest(JSON.parse(payload.toString('utf8')));
        return;
      }
      case 12:
        socket.write(Buffer.from([0xd0, 0]));
        return;
      case 14:
        socket.end();
        return;
      default:
    }
  }

  #onRequest(message) {
    this.requests.push(message);
    if (message.pushing?.command === 'pushall') {
      this.publish({ print: { ...this.status, command: 'push_status', msg: 0 } });
      return;
    }
    if (message.info?.command === 'get_version') {
      if (this.answerVersion) {
        this.publish({
          info: { ...this.info, command: 'get_version', sequence_id: message.info.sequence_id },
        });
      }
      return;
    }
    for (const part of ['print', 'system']) {
      const body = message[part];
      if (!body?.command || this.answer === 'silent') {
        continue;
      }
      const result = this.answer;
      this.publish({
        [part]: {
          ...body,
          result,
          reason: result === 'success' ? '' : 'mqtt message verify failed',
        },
      });
      if (result === 'success') {
        this.#apply(part, body);
      }
    }
  }

  /** What a real printer would report after a command it accepted. */
  #apply(part, body) {
    if (part === 'system' && body.command === 'ledctrl') {
      this.report({ lights_report: [{ node: 'chamber_light', mode: body.led_mode }] });
    }
    if (part === 'print' && body.command === 'print_speed') {
      this.report({ spd_lvl: Number(body.param) });
    }
    if (part === 'print' && body.command === 'pause') {
      this.report({ gcode_state: 'PAUSE' });
    }
    if (part === 'print' && body.command === 'resume') {
      this.report({ gcode_state: 'RUNNING' });
    }
    if (part === 'print' && body.command === 'stop') {
      this.report({ print_error: 50348044 });
      this.report({ gcode_state: 'FAILED' });
    }
  }

  publish(message) {
    const packet = publishPacket(`device/${this.serial}/report`, JSON.stringify(message));
    for (const session of this.clients) {
      session.socket.write(packet);
    }
  }

  /** A delta report, as the P1 and A1 series send them. */
  report(fields) {
    Object.assign(this.status, fields);
    this.publish({ print: { ...fields, command: 'push_status', msg: 1 } });
  }

  /** Drops every MQTT client (the printer turned off, Wi-Fi lost...). */
  disconnect() {
    for (const session of this.clients) {
      session.socket.end();
      session.socket.destroy();
    }
    this.clients.clear();
  }

  #camera(socket) {
    this.cameraConnections += 1;
    let buffer = Buffer.alloc(0);
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 80) {
        return;
      }
      const user = buffer.subarray(16, 48).toString('ascii').replace(/\0+$/, '');
      const code = buffer.subarray(48, 80).toString('ascii').replace(/\0+$/, '');
      if (user !== 'bblp' || code !== this.accessCode) {
        socket.end(); // closes without a byte, like the printers
        return;
      }
      for (const frame of this.cameraFrames) {
        const header = Buffer.alloc(16);
        header.writeUInt32LE(frame.length, 0);
        header.writeUInt32LE(1, 8);
        // The header and the image in separate chunks, the image split too.
        socket.write(header);
        socket.write(frame.subarray(0, 10));
        socket.write(frame.subarray(10));
      }
    });
  }
}

/**
 * A fake LAN: `connect({ host, port })` reaches the printer at that address,
 * or fails like a host that does not answer.
 */
export function network(...printers) {
  const connect = ({ host, port }) => {
    const printer = printers.find((p) => p.host === host);
    if (!printer) {
      const [client] = duplexPair();
      setImmediate(() => client.destroy(new Error(`connect EHOSTUNREACH ${host}:${port}`)));
      return client;
    }
    return printer.accept(port);
  };
  return { connect, printers };
}

/** The raw result of a `udp-broadcast` scan for these printers' announcements. */
export function announcements(...printers) {
  return printers.map((printer, index) => ({
    source_ip: printer.host,
    source_port: 2021,
    payload_base64: Buffer.from(
      [
        'NOTIFY * HTTP/1.1',
        'HOST: 239.255.255.250:1990',
        'Server: UPnP/1.0',
        `Location: ${printer.host}`,
        'NT: urn:bambulab-com:device:3dprinter:1',
        `USN: ${printer.serial}`,
        'Cache-Control: max-age=1800',
        `DevModel.bambu.com: ${printer.modelCode ?? 'C11'}`,
        `DevName.bambu.com: ${printer.name ?? `Printer ${index + 1}`}`,
        'DevSignal.bambu.com: -45',
        'DevConnect.bambu.com: lan',
        'DevBind.bambu.com: free',
        'DevVersion.bambu.com: 01.08.02.00',
        '',
        '',
      ].join('\r\n'),
    ).toString('base64'),
  }));
}
