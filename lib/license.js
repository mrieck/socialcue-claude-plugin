/**
 * Pro license verification — fully offline (node:crypto Ed25519, no phone-home:
 * the verification path makes no network calls, and that must stay verifiable
 * in source).
 *
 * Key format: SC1-<base64url(JSON payload)>.<base64url(signature)>
 *   payload = { email, tier: 'pro', issued: 'YYYY-MM-DD', expires: 'YYYY-MM-DD' }
 *   signature = Ed25519 over the raw payload bytes, by the Social Cue private key
 *   (the licensing site holds it — socialcue-website/server/license-sign.ts).
 *
 * Keys are short-lived and refreshed by lib/license-refresh.js: the plugin pulls
 * a fresh key from the licensing site using the account token while the Pro
 * subscription is active. Verification itself stays offline — an expired key just
 * reads as free. Honesty model: source-visible; don't add obfuscation here.
 */
import crypto from 'node:crypto';

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAL4gahtoUfjf3AAsVlo1H5BYcgL6El+Mbt30gdD+tr1M=
-----END PUBLIC KEY-----`;

const PREFIX = 'SC1-';

/** Is an ISO date (YYYY-MM-DD) strictly in the past (end-of-day)? */
function isExpired(expires) {
  if (!expires) return false; // legacy keys without an expiry never expire
  const end = new Date(`${expires}T23:59:59Z`).getTime();
  return Number.isFinite(end) && end < Date.now();
}

/**
 * Parse + verify a license key. A well-signed but expired key is reported invalid
 * (with error 'expired') so callers treat it as free.
 * @returns {{valid: true, payload: object} | {valid: false, error: string, expired?: boolean}}
 */
export function parseLicense(key) {
  try {
    if (typeof key !== 'string' || !key.startsWith(PREFIX)) {
      return { valid: false, error: 'not an SC1 license key' };
    }
    const [payloadB64, sigB64, ...rest] = key.slice(PREFIX.length).split('.');
    if (!payloadB64 || !sigB64 || rest.length) {
      return { valid: false, error: 'malformed key' };
    }
    const payloadBuf = Buffer.from(payloadB64, 'base64url');
    const sigBuf = Buffer.from(sigB64, 'base64url');
    const ok = crypto.verify(null, payloadBuf, crypto.createPublicKey(PUBLIC_KEY_PEM), sigBuf);
    if (!ok) return { valid: false, error: 'signature check failed' };
    const payload = JSON.parse(payloadBuf.toString('utf8'));
    if (payload.tier !== 'pro') return { valid: false, error: `unknown tier "${payload.tier}"` };
    if (isExpired(payload.expires)) return { valid: false, error: 'expired', expired: true };
    return { valid: true, payload };
  } catch (err) {
    return { valid: false, error: String(err?.message ?? err) };
  }
}

/** Is this config Pro-licensed (signed, right tier, not expired)? */
export function isPro(config) {
  return !!config.license && parseLicense(config.license).valid;
}

/** License status for display / the dashboard API. */
export function licenseInfo(config) {
  if (!config.license) return { pro: false };
  const parsed = parseLicense(config.license);
  if (!parsed.valid) {
    // Surface an expired-but-genuine key so the UI can nudge a reconnect.
    return { pro: false, expired: parsed.expired === true };
  }
  return {
    pro: true,
    email: parsed.payload.email,
    issued: parsed.payload.issued,
    expires: parsed.payload.expires,
  };
}
