/**
 * Venue playbook sync — the plugin's second outbound call after the license
 * refresh, and like it the request carries ONLY the opaque account token.
 *
 * Pro users pull the shared playbook (how each directory / launch site /
 * community / forum accepts posts) from GET {licenseServerUrl}/api/venues
 * into the local `destinations` table. Server rows own every catalog field
 * including `notes`; the user's own learnings stay in `local_notes` and never
 * leave the machine.
 *
 * The maintainer's machine additionally holds `config.venues.adminKey`; with
 * it set, `pushVenue` PUTs learned fields to the server so they reach every
 * Pro user without a commit. Everyone else: adminKey is empty and pushVenue is
 * a no-op. The key is never shipped in the plugin.
 *
 * Offline-tolerant like license-refresh.js: every failure resolves to
 * { synced:false, reason } and the last synced catalog keeps working.
 */
import * as cfg from './config.js';
import * as db from './db.js';
import { isPro } from './license.js';

const DEFAULT_SERVER = 'https://trysocialcue.com';
const TIMEOUT_MS = 8000;
/** Don't hit the server more than once per this window unless forced. */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

const KV_VERSION = 'venues_version';
const KV_SYNCED_AT = 'venues_synced_at';

function serverBase(config) {
  return (config.licenseServerUrl || DEFAULT_SERVER).replace(/\/+$/, '');
}

/**
 * Pull the playbook if warranted.
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<{synced: boolean, reason?: string, status?: number, count?: number, added?: number, updated?: number, removed?: number}>}
 */
export async function syncVenues({ force = false } = {}) {
  const config = cfg.loadConfig();
  const token = config.licenseAccountToken;
  if (!token) return { synced: false, reason: 'no account token' };
  if (!isPro(config)) return { synced: false, reason: 'pro_required' };

  if (!force) {
    const last = Number(db.getKv(KV_SYNCED_AT) || 0);
    if (last && Date.now() - last < SYNC_INTERVAL_MS && db.listDestinations().length) {
      return { synced: false, reason: 'fresh' };
    }
  }

  const url = `${serverBase(config)}/api/venues`;
  const headers = { authorization: `Bearer ${token}` };
  const version = db.getKv(KV_VERSION);
  if (version && db.listDestinations().length) headers['if-none-match'] = `"${version}"`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (res.status === 304) {
      db.setKv(KV_SYNCED_AT, String(Date.now()));
      return { synced: false, reason: 'unchanged', status: 304, count: db.listDestinations().length };
    }
    if (res.status === 401 || res.status === 403) {
      return { synced: false, reason: 'subscription inactive', status: res.status };
    }
    if (!res.ok) return { synced: false, reason: `server ${res.status}`, status: res.status };

    const data = await res.json();
    const list = Array.isArray(data?.venues) ? data.venues : null;
    if (!list) return { synced: false, reason: 'server returned no venues' };
    const result = db.applyServerVenues(list);
    db.setKv(KV_VERSION, String(data.version ?? ''));
    db.setKv(KV_SYNCED_AT, String(Date.now()));
    return { synced: true, status: res.status, count: list.length, ...result };
  } catch (err) {
    // Offline / DNS / abort — non-fatal by design.
    return { synced: false, reason: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fire-and-forget variant for hot paths (bridge start / dashboard load). */
export function syncVenuesInBackground(onDone) {
  syncVenues().then(r => { if (r.synced && onDone) onDone(r); }).catch(() => {});
}

/** Fields the server accepts on PUT (never localNotes, never testStatus). */
const PUSHABLE = ['name', 'url', 'submitUrl', 'signup', 'oauthProviders', 'notes', 'kind', 'postTypes', 'category', 'fits', 'cost'];

export function hasAdminKey(config = cfg.loadConfig()) {
  return !!config.venues?.adminKey;
}

/**
 * Maintainer-only: push learned fields for one venue to the shared playbook.
 * @returns {Promise<{pushed: boolean, status?: number, reason?: string}>}
 */
export async function pushVenue(id, patch = {}) {
  const config = cfg.loadConfig();
  const key = config.venues?.adminKey;
  if (!key) return { pushed: false, reason: 'no admin key' };
  const body = {};
  for (const k of PUSHABLE) if (patch[k] !== undefined) body[k] = patch[k];
  if (!Object.keys(body).length) return { pushed: false, reason: 'nothing to push' };

  const url = `${serverBase(config)}/api/venues/${encodeURIComponent(id)}`;
  let lastReason = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'x-api-key': key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.ok) return { pushed: true, status: res.status };
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* no body */ }
      // 4xx won't get better on retry (bad key → 404, bad body → 400).
      return { pushed: false, status: res.status, reason: `server ${res.status}${detail ? `: ${detail}` : ''}` };
    } catch (err) {
      lastReason = String(err?.message ?? err);
      await new Promise(r => setTimeout(r, 1000));
    } finally {
      clearTimeout(timer);
    }
  }
  return { pushed: false, reason: lastReason || 'network error' };
}
