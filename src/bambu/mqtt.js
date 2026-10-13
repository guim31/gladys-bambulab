// -----------------------------------------------------------------------------
// A minimal MQTT 3.1.1 client, enough to talk to the broker a Bambu Lab
// printer runs on port 8883: CONNECT with a user name and password, one
// SUBSCRIBE, PUBLISH at QoS 0, keep-alive pings. No dependency: the sandbox has
// 256 MB, and the whole protocol used here fits in a few packet types.
//
// The transport is injected (`connect()` returns a Duplex stream: a TLS socket
// in production, an in-memory pair in the tests).
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';

const TYPE = {
  CONNECT: 1,
  CONNACK: 2,
  PUBLISH: 3,
  PUBACK: 4,
  SUBSCRIBE: 8,
  SUBACK: 9,
  PINGREQ: 12,
  PINGRESP: 13,
  DISCONNECT: 14,
};

// A full report of a printer with four AMS is about 30 KB; anything near this
// bound is not a Bambu message.
export const MAX_PACKET_BYTES = 4 * 1024 * 1024;

// CONNACK return codes (MQTT 3.1.1, 3.2.2.3).
const CONNACK_ERRORS = {
  1: 'unacceptable protocol version',
  2: 'client identifier rejected',
  3: 'server unavailable',
  4: 'bad user name or password',
  5: 'not authorized',
};

function encodeLength(length) {
  const bytes = [];
  let value = length;
  do {
    let byte = value % 128;
    value = Math.floor(value / 128);
    if (value > 0) {
      byte |= 0x80;
    }
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

function encodeString(text) {
  const data = Buffer.from(text, 'utf8');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(data.length);
  return Buffer.concat([length, data]);
}

function packet(type, flags, body) {
  return Buffer.concat([Buffer.from([(type << 4) | flags]), encodeLength(body.length), body]);
}

export function connectPacket({ clientId, username, password, keepalive }) {
  const header = Buffer.concat([
    encodeString('MQTT'),
    // Level 4 (3.1.1); flags: user name, password, clean session.
    Buffer.from([4, 0x80 | 0x40 | 0x02]),
    Buffer.from([keepalive >> 8, keepalive & 0xff]),
  ]);
  return packet(
    TYPE.CONNECT,
    0,
    Buffer.concat([header, encodeString(clientId), encodeString(username), encodeString(password)]),
  );
}

export function subscribePacket(packetId, topic) {
  const id = Buffer.from([packetId >> 8, packetId & 0xff]);
  return packet(TYPE.SUBSCRIBE, 0x02, Buffer.concat([id, encodeString(topic), Buffer.from([0])]));
}

export function publishPacket(topic, payload) {
  return packet(TYPE.PUBLISH, 0, Buffer.concat([encodeString(topic), Buffer.from(payload)]));
}

const PINGREQ = Buffer.from([TYPE.PINGREQ << 4, 0]);
const DISCONNECT = Buffer.from([TYPE.DISCONNECT << 4, 0]);

/**
 * Splits a byte stream into MQTT packets. Returns the packets found and the
 * bytes left over (an incomplete packet), or throws on a malformed length.
 * @param {Buffer} buffer
 * @returns {{ packets: { type: number, flags: number, body: Buffer }[], rest: Buffer }}
 */
export function splitPackets(buffer) {
  const packets = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    let length = 0;
    let multiplier = 1;
    let index = offset + 1;
    let complete = false;
    for (let i = 0; i < 4; i += 1) {
      if (index >= buffer.length) {
        break;
      }
      const byte = buffer[index];
      index += 1;
      length += (byte & 0x7f) * multiplier;
      multiplier *= 128;
      if ((byte & 0x80) === 0) {
        complete = true;
        break;
      }
      if (i === 3) {
        throw new Error('Malformed MQTT remaining length');
      }
    }
    if (!complete) {
      break; // the length itself is not complete yet
    }
    if (length > MAX_PACKET_BYTES) {
      throw new Error(`MQTT packet too large (${length} bytes)`);
    }
    if (buffer.length - index < length) {
      break;
    }
    packets.push({
      type: buffer[offset] >> 4,
      flags: buffer[offset] & 0x0f,
      body: buffer.subarray(index, index + length),
    });
    offset = index + length;
  }
  return { packets, rest: buffer.subarray(offset) };
}

/** A PUBLISH body -> { topic, payload, packetId? } */
export function readPublish(flags, body) {
  const topicLength = body.readUInt16BE(0);
  const topic = body.subarray(2, 2 + topicLength).toString('utf8');
  let offset = 2 + topicLength;
  const qos = (flags >> 1) & 0x03;
  let packetId = null;
  if (qos > 0) {
    packetId = body.readUInt16BE(offset);
    offset += 2;
  }
  return { topic, qos, packetId, payload: body.subarray(offset) };
}

/** An error with a `kind`: `unauthorized`, `timeout`, `protocol` or `network`. */
export class MqttError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * One MQTT session. Events: `message` (topic, payload Buffer), `close` (error
 * or null). `open()` resolves once the subscription is acknowledged.
 */
export class MqttSession extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => import('node:stream').Duplex} options.connect opens the transport
   * @param {string} options.clientId
   * @param {string} options.username
   * @param {string} options.password
   * @param {string} options.topic subscribed once connected
   * @param {number} [options.keepalive] seconds
   * @param {number} [options.connectTimeout] ms, TLS handshake and CONNACK included
   */
  constructor({
    connect,
    clientId,
    username,
    password,
    topic,
    keepalive = 30,
    connectTimeout = 10_000,
  }) {
    super();
    this.connectTransport = connect;
    this.clientId = clientId;
    this.username = username;
    this.password = password;
    this.topic = topic;
    this.keepalive = keepalive;
    this.connectTimeout = connectTimeout;
    this.buffer = Buffer.alloc(0);
    this.socket = null;
    this.closed = false;
    this.pingTimer = null;
    this.awaitingPong = false;
  }

  open() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
        this.#close(err);
      };
      const timer = setTimeout(
        () => fail(new MqttError('timeout', 'The printer did not answer in time')),
        this.connectTimeout,
      );
      timer.unref?.();
      this.once('subscribed', () => {
        settled = true;
        clearTimeout(timer);
        resolve();
      });
      this.once('failed', fail);

      let socket;
      try {
        socket = this.connectTransport();
      } catch (err) {
        fail(new MqttError('network', err.message));
        return;
      }
      this.socket = socket;
      socket.on('data', (chunk) => this.#onData(chunk));
      socket.on('error', (err) => {
        const kind = /certificate|self[- ]signed|CERT_|UNABLE_TO/i.test(
          `${err.code} ${err.message}`,
        )
          ? 'certificate'
          : 'network';
        this.emit('failed', new MqttError(kind, err.message));
      });
      socket.on('end', () => this.emit('failed', new MqttError('network', 'Connection closed')));
      socket.on('close', () => this.emit('failed', new MqttError('network', 'Connection closed')));
      // A TLS socket buffers what is written before its handshake completes.
      this.#write(
        connectPacket({
          clientId: this.clientId,
          username: this.username,
          password: this.password,
          keepalive: this.keepalive,
        }),
      );
    });
  }

  publish(topic, payload) {
    if (this.closed || !this.socket) {
      throw new MqttError('network', 'Not connected to the printer');
    }
    this.#write(publishPacket(topic, payload));
  }

  /** Closes the session (sends DISCONNECT when possible). */
  close() {
    if (!this.closed && this.socket) {
      try {
        this.socket.write(DISCONNECT);
      } catch {
        // already gone
      }
    }
    this.#close(null);
  }

  #write(data) {
    if (!this.closed) {
      this.socket.write(data);
    }
  }

  #close(error) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.socket?.destroy();
    this.emit('close', error);
  }

  #onData(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    let result;
    try {
      result = splitPackets(this.buffer);
    } catch (err) {
      this.emit('failed', new MqttError('protocol', err.message));
      return;
    }
    // Copy the rest: the packets keep slices of the old buffer alive otherwise.
    this.buffer = Buffer.from(result.rest);
    for (const { type, flags, body } of result.packets) {
      this.#onPacket(type, flags, body);
      if (this.closed) {
        return;
      }
    }
  }

  #onPacket(type, flags, body) {
    switch (type) {
      case TYPE.CONNACK: {
        const code = body[1];
        if (code !== 0) {
          const kind = code === 4 || code === 5 ? 'unauthorized' : 'protocol';
          this.emit(
            'failed',
            new MqttError(kind, `Connection refused: ${CONNACK_ERRORS[code] ?? code}`),
          );
          return;
        }
        this.#write(subscribePacket(1, this.topic));
        this.#startPings();
        return;
      }
      case TYPE.SUBACK:
        if (body[2] === 0x80) {
          // The serial number does not match the printer.
          this.emit('failed', new MqttError('unauthorized', 'Subscription refused'));
          return;
        }
        this.emit('subscribed');
        return;
      case TYPE.PUBLISH: {
        const message = readPublish(flags, body);
        if (message.qos === 1) {
          this.#write(
            packet(TYPE.PUBACK, 0, Buffer.from([message.packetId >> 8, message.packetId & 0xff])),
          );
        }
        this.emit('message', message.topic, message.payload);
        return;
      }
      case TYPE.PINGRESP:
        this.awaitingPong = false;
        return;
      default:
        // PUBACK/UNSUBACK... nothing this client waits for.
        return;
    }
  }

  #startPings() {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.awaitingPong) {
        // A whole keep-alive period without an answer: the link is dead.
        this.emit('failed', new MqttError('timeout', 'The printer stopped answering'));
        return;
      }
      this.awaitingPong = true;
      this.#write(PINGREQ);
    }, this.keepalive * 1000);
    this.pingTimer.unref?.();
  }
}
