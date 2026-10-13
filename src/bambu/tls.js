// -----------------------------------------------------------------------------
// TLS to the printer (MQTT on 8883, camera on 6000).
//
// The printer presents a certificate signed by Bambu Lab's own authorities,
// issued for its serial number, not for its IP address. Like ha-bambulab, the
// chain is checked against those authorities (certs/bambu-ca.pem, the
// printer.cer of Bambu Studio) and the host name is not. The "do not check the
// certificate" option of the configuration turns the check off, for a printer
// whose authority is not in the bundle yet.
//
// TLS 1.2 at most: P2S firmware 01.02.00.00 never answers a TLS 1.3
// ClientHello (ha-bambulab, bambu_client.py).
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import tls from 'node:tls';

export const BAMBU_CA = readFileSync(new URL('./certs/bambu-ca.pem', import.meta.url), 'utf8');

export const MQTT_PORT = 8883;
export const CAMERA_PORT = 6000;

/**
 * Options of tls.connect for a printer.
 * @param {{ host: string, port: number, verify: boolean }} options
 */
export function tlsOptions({ host, port, verify }) {
  return {
    host,
    port,
    ca: BAMBU_CA,
    rejectUnauthorized: verify,
    // The certificate names the serial number, not the address.
    checkServerIdentity: () => undefined,
    maxVersion: 'TLSv1.2',
    // A printer that is off: give up on the TCP connection in time.
    timeout: 10_000,
  };
}

/** Opens a TLS socket to the printer (the transport of MqttSession and the camera). */
export function connectTls({ host, port, verify }) {
  const socket = tls.connect(tlsOptions({ host, port, verify }));
  socket.setNoDelay(true);
  socket.once('timeout', () => socket.destroy(new Error(`No answer from ${host}:${port}`)));
  socket.once('secureConnect', () => socket.setTimeout(0));
  return socket;
}
