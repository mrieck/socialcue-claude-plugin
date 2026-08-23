/**
 * License auto-refresh — the plugin's only outbound network call besides
 * inference itself (page content goes to Anthropic via the user's Claude
 * subscription) and the opt-in Postiz integration.
 *
 * If a Pro account token is configured, this fetches a fresh short-lived key from
 * the licensing site (GET {licenseServerUrl}/api/license/current, Bearer token)
 * and saves it to config.license. The request carries only the account token —
 * never brands, pages, or opportunities.
 *
 * It is deliberately offline-tolerant: any network/HTTP failure is swallowed and
 * the existing key keeps working until it actually expires. A 403 (subscription
 * lapsed) is reported but not fatal — the key simply ages out to free.
 */
import * as cfg from './config.js';
import { parseLicense } from './license.js';

const DEFAULT_SERVER = 'https://trysocialcue.com';
// Refresh once the current key is within this many days of expiring.
const REFRESH_WINDOW_DAYS = 7;
const TIMEOUT_MS = 8000;

/** Does the current key need refreshing (missing, unparseable, or near expiry)? */
function needsRefresh(license) {
  if (!license) return true;
  const parsed = parseLicense(license);
  if (!parsed.valid) return true; // expired or otherwise unusable
  const expires = parsed.payload.expires;
  if (!expires) return false; // legacy no-expiry key: nothing to refresh
  const soon = Date.now() + REFRESH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return new Date(`${expires}T23:59:59Z`).getTime() <= soon;
}

/**
 * Refresh the license key if warranted.
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<{refreshed: boolean, reason?: string, status?: number}>}
 */
export async function refreshLicense({ force = false } = {}) {
  const config = cfg.loadConfig();
  const token = config.licenseAccountToken;
  if (!token) return { refreshed: false, reason: 'no account token' };
  if (!force && !needsRefresh(config.license)) {
    return { refreshed: false, reason: 'current key still fresh' };
  }

  const base = (config.licenseServerUrl || DEFAULT_SERVER).replace(/\/+$/, '');
  const url = `${base}/api/license/current`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      // Token unknown or subscription inactive — leave the old key to age out.
      return { refreshed: false, reason: 'subscription inactive', status: res.status };
    }
    if (!res.ok) return { refreshed: false, reason: `server ${res.status}`, status: res.status };

    const data = await res.json();
    const key = data?.key;
    if (!key || !parseLicense(key).valid) {
      return { refreshed: false, reason: 'server returned an invalid key' };
    }
    // Reload latest config before writing so we don't clobber concurrent edits.
    const latest = cfg.loadConfig();
    if (latest.license === key) return { refreshed: false, reason: 'already current' };
    latest.license = key;
    cfg.saveConfig(latest);
    return { refreshed: true };
  } catch (err) {
    // Offline / DNS / abort — non-fatal by design.
    return { refreshed: false, reason: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget variant for hot paths (bridge start / discovery kickoff). */
export function refreshLicenseInBackground() {
  refreshLicense().catch(() => {});
}
