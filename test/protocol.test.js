// -----------------------------------------------------------------------------
// The protocols, piece by piece: MQTT packets and session, the camera stream,
// the SSDP announcements, the TLS options.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplexPair } from 'node:stream';
import { X509Certificate } from 'node:crypto';
import {
  MqttSession,
  connectPacket,
  publishPacket,
  readPublish,
  splitPackets,
  subscribePacket,
} from '../src/bambu/mqtt.js';
import { authPacket, captureFrame, isJpeg, splitFrames } from '../src/bambu/camera.js';
import { DISCOVERY_PORTS, parseAnnouncement, printersFromScan } from '../src/bambu/discovery.js';
import { BAMBU_CA, connectTls, tlsOptions } from '../src/bambu/tls.js';
import { FakePrinter, announcements, jpeg, settle } from './helpers/fakePrinter.js';

const manifest = JSON.parse(
  await (
    await import('node:fs/promises')
  ).readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);

test('MQTT: CONNECT carries the protocol 3.1.1, clean session, user and password', () => {
  const packet = connectPacket({
    clientId: 'gladys',
    username: 'bblp',
    password: '12345678',
    keepalive: 30,
  });
  assert.equal(packet[0], 0x10);
  const { packets } = splitPackets(packet);
  const body = packets[0].body;
  assert.equal(body.subarray(2, 6).toString(), 'MQTT');
  assert.equal(body[6], 4);
  assert.equal(body[7], 0xc2);
  assert.equal(body.readUInt16BE(8), 30);
  assert.match(body.toString('latin1'), /gladys.*bblp.*12345678/s);
});

test('MQTT: packets split across chunks, with multi-byte remaining lengths', () => {
  const big = publishPacket('device/X/report', Buffer.alloc(40_000, 0x61));
  const small = subscribePacket(1, 'device/X/report');
  const stream = Buffer.concat([big, small]);
  // Byte by byte boundaries around the length field.
  const first = splitPackets(stream.subarray(0, 3));
  assert.deepEqual(first.packets, []);
  assert.equal(first.rest.length, 3);
  const all = splitPackets(stream);
  assert.equal(all.packets.length, 2);
  assert.equal(all.rest.length, 0);
  const message = readPublish(all.packets[0].flags, all.packets[0].body);
  assert.equal(message.topic, 'device/X/report');
  assert.equal(message.payload.length, 40_000);
  assert.equal(all.packets[1].type, 8);
  assert.equal(all.packets[1].flags, 2);
});

test('MQTT: a malformed or huge length is refused', () => {
  assert.throws(() => splitPackets(Buffer.from([0x30, 0xff, 0xff, 0xff, 0xff, 0x01])), /Malformed/);
  assert.throws(() => splitPackets(Buffer.from([0x30, 0xff, 0xff, 0xff, 0x7f])), /too large/);
});

test('MQTT session: subscribes, receives, keeps the link with pings', async () => {
  const printer = new FakePrinter();
  const session = new MqttSession({
    connect: () => printer.accept(8883),
    clientId: 'test',
    username: 'bblp',
    password: printer.accessCode,
    topic: `device/${printer.serial}/report`,
    keepalive: 0.03,
  });
  const received = [];
  session.on('message', (topic, payload) => received.push(JSON.parse(payload)));
  await session.open();
  printer.report({ mc_percent: 42 });
  await settle(100); // a few keep-alive periods: pongs keep it open
  assert.equal(session.closed, false);
  assert.equal(received[0].print.mc_percent, 42);
  session.close();
  assert.equal(session.closed, true);
});

test('MQTT session: a refused code, a wrong topic, a silent peer', async () => {
  const printer = new FakePrinter();
  const open = (options) =>
    new MqttSession({
      connect: () => printer.accept(8883),
      clientId: 'test',
      username: 'bblp',
      password: printer.accessCode,
      topic: `device/${printer.serial}/report`,
      ...options,
    }).open();
  await assert.rejects(open({ password: 'wrong' }), { kind: 'unauthorized' });
  await assert.rejects(open({ topic: 'device/OTHER/report' }), { kind: 'unauthorized' });
  const [client] = duplexPair(); // nobody answers
  await assert.rejects(
    new MqttSession({
      connect: () => client,
      clientId: 't',
      username: 'bblp',
      password: 'x',
      topic: 't',
      connectTimeout: 50,
    }).open(),
    { kind: 'timeout' },
  );
});

test('MQTT session: a malformed PUBLISH ends the session, not the process', async () => {
  assert.throws(() => readPublish(0, Buffer.from([0])), /Malformed/);
  assert.throws(() => readPublish(2, Buffer.from([0, 1, 0x61])), /Malformed/, 'QoS 1 without id');
  assert.throws(() => readPublish(6, Buffer.from([0, 0, 0, 1])), /Malformed/, 'QoS 3');
  const [client, server] = duplexPair();
  server.on('data', (chunk) => {
    if (chunk[0] === 0x10) {
      server.write(Buffer.from([0x20, 2, 0, 0]));
    } else if (chunk[0] === 0x82) {
      server.write(Buffer.from([0x90, 3, 0, 1, 0]));
      server.write(Buffer.from([0x32, 1, 0])); // a QoS 1 PUBLISH of one byte
    }
  });
  const session = new MqttSession({
    connect: () => client,
    clientId: 't',
    username: 'bblp',
    password: 'x',
    topic: 't',
  });
  const closed = new Promise((resolve) => session.on('close', resolve));
  const hold = setTimeout(() => {}, 5_000);
  await session.open();
  assert.equal((await closed).kind, 'protocol');
  clearTimeout(hold);
});

test('MQTT session: a peer that stops answering pings is dropped', async () => {
  const [client, server] = duplexPair();
  server.on('data', (chunk) => {
    if (chunk[0] === 0x10) {
      server.write(Buffer.from([0x20, 2, 0, 0]));
    } else if (chunk[0] === 0x82) {
      server.write(Buffer.from([0x90, 3, 0, 1, 0]));
    }
    // PINGREQ: no answer.
  });
  const session = new MqttSession({
    connect: () => client,
    clientId: 't',
    username: 'bblp',
    password: 'x',
    topic: 't',
    keepalive: 0.02,
  });
  const closed = new Promise((resolve) => session.on('close', resolve));
  // The ping timer does not hold the process (a real socket does): hold it here.
  const hold = setTimeout(() => {}, 5_000);
  await session.open();
  const error = await closed;
  clearTimeout(hold);
  assert.equal(error.kind, 'timeout');
});

test('camera: authentication packet of 80 bytes, as ha-bambulab builds it', () => {
  const packet = authPacket('12345678');
  assert.equal(packet.length, 80);
  assert.deepEqual([...packet.subarray(0, 8)], [0x40, 0, 0, 0, 0, 0x30, 0, 0]);
  assert.equal(packet.subarray(16, 20).toString(), 'bblp');
  assert.equal(packet[20], 0);
  assert.equal(packet.subarray(48, 56).toString(), '12345678');
});

test('camera: frames split anywhere, a broken size refused', () => {
  const image = jpeg(300);
  const header = Buffer.alloc(16);
  header.writeUInt32LE(image.length, 0);
  const stream = Buffer.concat([header, image, header, image.subarray(0, 100)]);
  const { frames, rest } = splitFrames(stream);
  assert.equal(frames.length, 1);
  assert.ok(isJpeg(frames[0]));
  assert.equal(rest.length, 116);
  const bad = Buffer.alloc(16);
  bad.writeUInt32LE(50 * 1024 * 1024, 0);
  assert.throws(() => splitFrames(bad), { code: 'camera_format' });
  assert.ok(!isJpeg(Buffer.from('not a jpeg')));
});

test('camera: the first frame, a refused code, a silent camera', async () => {
  const printer = new FakePrinter();
  const frame = await captureFrame({ connect: () => printer.accept(6000), accessCode: '12345678' });
  assert.deepEqual(frame, jpeg());
  await assert.rejects(captureFrame({ connect: () => printer.accept(6000), accessCode: 'nope' }), {
    code: 'camera_auth',
  });
  const [client] = duplexPair();
  await assert.rejects(captureFrame({ connect: () => client, accessCode: 'x', timeout: 30 }), {
    code: 'camera_timeout',
  });
  printer.cameraFrames = [Buffer.from('this is not an image')];
  await assert.rejects(
    captureFrame({ connect: () => printer.accept(6000), accessCode: '12345678' }),
    { code: 'camera_format' },
  );
});

test('discovery: an announcement gives the serial, address, model and name', () => {
  const printer = new FakePrinter({ host: '192.0.2.50' });
  printer.modelCode = 'C12';
  printer.name = 'Atelier';
  const [found] = printersFromScan(announcements(printer));
  assert.deepEqual(found, {
    serial: '01S00A000000003',
    host: '192.0.2.50',
    model: 'P1S',
    name: 'Atelier',
    mode: 'lan',
    firmware: '01.08.02.00',
  });
});

test('discovery: other datagrams and odd fields are ignored', () => {
  assert.equal(parseAnnouncement('M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n', '192.0.2.1'), null);
  assert.equal(
    parseAnnouncement(
      'NOTIFY * HTTP/1.1\r\nNT: urn:schemas-upnp-org:device:Basic:1\r\nUSN: X\r\n',
      '192.0.2.1',
    ),
    null,
  );
  // No Location: the sender's address; a bad serial: ignored.
  const text = (usn, location = '') =>
    `NOTIFY * HTTP/1.1\r\nNT: urn:bambulab-com:device:3dprinter:1\r\nUSN: ${usn}\r\n${location}`;
  assert.equal(parseAnnouncement(text('01P00A000000009'), '192.0.2.9').host, '192.0.2.9');
  assert.equal(parseAnnouncement(text('../../etc'), '192.0.2.9'), null);
  assert.equal(
    parseAnnouncement(text('01P00A000000009', 'Location: http://x/\r\n'), '192.0.2.9').host,
    '192.0.2.9',
  );
  assert.deepEqual(
    printersFromScan([{ source_ip: '192.0.2.1' }, null, { payload_base64: 'AAAA' }]),
    [],
  );
  assert.deepEqual(printersFromScan('nonsense'), []);
});

test('discovery: the manifest declares the announcement ports', () => {
  assert.deepEqual(manifest.network_discovery, [{ type: 'udp-broadcast', ports: DISCOVERY_PORTS }]);
});

test('TLS: Bambu Lab authorities, no host name check, TLS 1.2 at most', () => {
  const options = tlsOptions({ host: '192.0.2.10', port: 8883, verify: true });
  assert.equal(options.rejectUnauthorized, true);
  assert.equal(options.maxVersion, 'TLSv1.2');
  assert.equal(options.checkServerIdentity('192.0.2.10', {}), undefined);
  assert.equal(tlsOptions({ host: 'h', port: 1, verify: false }).rejectUnauthorized, false);
  const certificates = BAMBU_CA.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  );
  assert.equal(certificates.length, 8);
  const subjects = certificates.map((pem) => new X509Certificate(pem).subject);
  assert.ok(subjects.some((subject) => subject.includes('CN=BBL CA')));
  assert.equal(typeof connectTls, 'function');
});
