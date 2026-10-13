// -----------------------------------------------------------------------------
// Camera of the P1 and A1 series: a JPEG stream over TLS on port 6000.
//
// Protocol (ha-bambulab, ChamberImageThread): the client sends an 80-byte
// authentication packet — four little-endian words 0x40, 0x3000, 0, 0, then
// the user name `bblp` and the access code, each padded to 32 bytes — and the
// printer sends one frame every second or two: a 16-byte header whose first
// word is the JPEG size, then the JPEG itself. A wrong access code closes the
// connection without a byte.
//
// The X1, H2 and P2S series film over RTSPS instead (port 322): out of reach
// without ffmpeg, they have no camera here.
// -----------------------------------------------------------------------------

const HEADER_BYTES = 16;
const MAX_FRAME_BYTES = 2 * 1024 * 1024;

export function authPacket(accessCode) {
  const packet = Buffer.alloc(80);
  packet.writeUInt32LE(0x40, 0);
  packet.writeUInt32LE(0x3000, 4);
  packet.write('bblp', 16, 32, 'ascii');
  packet.write(accessCode, 48, 32, 'ascii');
  return packet;
}

export const isJpeg = (data) =>
  data.length > 4 &&
  data[0] === 0xff &&
  data[1] === 0xd8 &&
  data[data.length - 2] === 0xff &&
  data[data.length - 1] === 0xd9;

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Reads frames from the stream: header, then JPEG. Returns the frames found
 * and the bytes left, or throws on a frame size no camera sends.
 * @param {Buffer} buffer
 */
export function splitFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= HEADER_BYTES) {
    const size = buffer.readUInt32LE(offset);
    if (size === 0 || size > MAX_FRAME_BYTES) {
      throw codedError('camera_format', `Unexpected camera frame size (${size} bytes)`);
    }
    if (buffer.length - offset - HEADER_BYTES < size) {
      break;
    }
    frames.push(buffer.subarray(offset + HEADER_BYTES, offset + HEADER_BYTES + size));
    offset += HEADER_BYTES + size;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/**
 * Connects, authenticates and resolves the first complete JPEG frame.
 * Rejects with a `code`: `camera_auth` (closed without data: wrong access
 * code), `camera_format`, `camera_timeout` or `unreachable`.
 * @param {{ connect: () => import('node:stream').Duplex, accessCode: string, timeout?: number }} options
 * @returns {Promise<Buffer>}
 */
export function captureFrame({ connect, accessCode, timeout = 10_000 }) {
  return new Promise((resolve, reject) => {
    let socket;
    let buffer = Buffer.alloc(0);
    let received = 0;
    let done = false;
    const finish = (err, frame) => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      socket?.destroy();
      if (err) {
        reject(err);
      } else {
        resolve(frame);
      }
    };
    const timer = setTimeout(
      () => finish(codedError('camera_timeout', 'No image from the printer camera in time')),
      timeout,
    );
    try {
      socket = connect();
    } catch (err) {
      finish(codedError('unreachable', err.message));
      return;
    }
    socket.on('data', (chunk) => {
      received += chunk.length;
      buffer = Buffer.concat([buffer, chunk]);
      let result;
      try {
        result = splitFrames(buffer);
      } catch (err) {
        finish(err);
        return;
      }
      buffer = Buffer.from(result.rest);
      const frame = result.frames.findLast(isJpeg);
      if (frame) {
        finish(null, Buffer.from(frame));
      } else if (result.frames.length > 0) {
        finish(codedError('camera_format', 'The camera sent something else than a JPEG'));
      }
    });
    socket.on('error', (err) => finish(codedError('unreachable', err.message)));
    const closed = () =>
      finish(
        received === 0
          ? codedError('camera_auth', 'The camera closed the connection: access code refused?')
          : codedError('unreachable', 'The camera connection closed'),
      );
    socket.on('end', closed);
    socket.on('close', closed);
    socket.write(authPacket(accessCode));
  });
}
