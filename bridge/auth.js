/**
 * Bridge auth: Bearer pairing-token check + Host-header allowlist.
 *
 * The server binds 127.0.0.1 only; the Host check additionally defeats DNS
 * rebinding (a hostile page resolving its own domain to 127.0.0.1 would carry
 * that domain in Host and is rejected before any handler runs).
 */
import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison via digest (inputs may differ in length). */
function safeEqual(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** True when the request's Host header is the loopback host we serve on. */
export function checkHost(req, port) {
  const host = req.headers.host ?? '';
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** True when the request carries `Authorization: Bearer <token>`. */
export function checkToken(req, token) {
  if (!token) return false; // no token configured -> nothing authenticates
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7).trim(), token);
}
