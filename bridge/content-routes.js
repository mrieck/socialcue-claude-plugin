/**
 * Content Strategy API — original posts scheduled through the user's own
 * Postiz account. Delegated from routes.js after auth, so every handler here
 * is already behind the pairing token.
 *
 * Free/Pro line mirrors the rest of the bridge: composing/editing/deleting
 * drafts is free (review is never gated); handing content to Postiz
 * (schedule) and pulling state back (sync) are acting/tracking — Pro.
 * The Postiz API key is write-only through this API: accepted on /connect,
 * never echoed by any response.
 */
import * as db from '../lib/db.js';
import * as cfg from '../lib/config.js';
import { bumpWrites } from './changes.js';
import { postizEnabled, listIntegrations, deletePost } from '../lib/postiz-client.js';
import { addContentItemWithMedia, channelsForBrand, parseContentRow, scheduleContentItem, syncContentFromPostiz } from '../lib/content-actions.js';
import { ingestMedia, removeItemMedia, removeMediaFile, saveUploadedMedia } from '../lib/media-store.js';

// Bridge-facing HTTP statuses for content-actions result codes.
const CODE_STATUS = {
  not_found: 404,
  already_sent: 409,
  no_channels: 400,
  empty_body: 400,
  no_date: 400,
  upload_failed: 502,
  postiz_error: 502,
};

// Re-sync throttle: skip a sync that fires within this window unless forced.
const SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
// Cap analytics calls per sync pass (rate-limit headroom).
const MAX_ANALYTICS_PER_SYNC = 10;

let lastSyncAt = 0;

// Attachment uploads bypass the shared 2MB JSON readBody: raw binary with its
// own, larger cap (Postiz allows video up to 1GB; this stays below that but
// comfortably fits a 1080p short — buffered in memory, so not unbounded).
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;

function readBinaryBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_MEDIA_BYTES) {
        reject(Object.assign(new Error('file too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** SQLite snake_case row -> API camelCase content item (JSON blobs parsed). */
export function rowToContentItem(r) {
  const p = parseContentRow(r);
  return {
    id: p.id,
    brandId: p.brand_id,
    brandName: p.brand_name ?? '',
    title: p.title ?? '',
    body: p.body ?? '',
    channels: p.channels,
    settings: p.settings,
    status: p.status,
    scheduledFor: p.scheduled_for ?? null,
    postizPostId: p.postiz_post_id ?? null,
    releaseUrl: p.release_url ?? null,
    venueId: p.venue_id ?? null,
    metrics: p.metrics,
    media: p.media,
    source: p.source ?? 'user',
    variants: p.variants,
    format: p.format ?? 'text',
    notes: p.notes ?? '',
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    sentAt: p.sent_at ?? null,
    publishedAt: p.published_at ?? null,
    lastSyncedAt: p.last_synced_at ?? null,
  };
}

/** Map a brand name/id from the request to {brandId, brandName}. */
function resolveBrand(config, { brandId, brandName }) {
  const brands = config.brands ?? [];
  const b = brands.find(x => x.id === brandId) ?? brands.find(x => x.name === brandName);
  return { brandId: b?.id ?? brandId ?? null, brandName: b?.name ?? brandName ?? '' };
}

/**
 * Handle a content/postiz request. Returns true if the route matched.
 * Shares helpers with routes.js via ctx: { json, readBody }.
 */
export async function handleContentApi(req, res, ctx) {
  const { json, readBody } = ctx;
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const method = req.method ?? 'GET';

  const parseBody = async () => {
    const raw = await readBody(req);
    return raw.trim() ? JSON.parse(raw) : {};
  };
  const badBody = err =>
    json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });

  /* ----- content CRUD (free) ----- */

  if (p === '/api/content' && method === 'GET') {
    const rows = db.queryContentItems({
      brandId: url.searchParams.get('brand') || null,
      status: url.searchParams.get('status') || null,
      limit: Math.min(Number(url.searchParams.get('limit')) || 100, 500),
      offset: Number(url.searchParams.get('offset')) || 0,
    });
    json(res, 200, { items: rows.map(rowToContentItem) });
    return true;
  }

  if (p === '/api/content' && method === 'POST') {
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    const config = cfg.loadConfig();
    const brand = resolveBrand(config, body);
    // No explicit channels → default to the brand's mapped Postiz accounts.
    const channels = Array.isArray(body.channels) && body.channels.length
      ? body.channels
      : channelsForBrand(config, brand.brandId);
    // Media is copied into the managed store; a bad path is the caller's error.
    let id;
    try {
      id = addContentItemWithMedia({
        ...brand,
        title: body.title ?? '',
        body: body.body ?? '',
        channels,
        settings: body.settings ?? {},
        status: body.status,
        scheduledFor: body.scheduledFor ?? null,
        venueId: body.venueId ?? null,
        media: Array.isArray(body.media) ? body.media.map(String) : [],
        source: body.source ? String(body.source) : 'user',
        variants: body.variants ?? {},
        format: body.format,
        notes: body.notes,
      });
    } catch (err) {
      json(res, 400, { error: err.message });
      return true;
    }
    bumpWrites();
    json(res, 200, rowToContentItem(db.getContentItemById(id)));
    return true;
  }

  const itemMatch = p.match(/^\/api\/content\/([^/]+)$/);
  if (itemMatch && method === 'PATCH') {
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    const id = decodeURIComponent(itemMatch[1]);
    const row = db.getContentItemById(id);
    if (!row) { json(res, 404, { error: `no content item ${id}` }); return true; }
    // Once handed to Postiz, the local copy is a mirror: content edits would
    // silently diverge from what actually publishes. Delete + recreate instead.
    const editsContent = body.body !== undefined || body.channels !== undefined
      || body.settings !== undefined || body.title !== undefined || body.media !== undefined
      || body.variants !== undefined;
    if (editsContent && row.postiz_post_id && (row.status === 'scheduled' || row.status === 'published')) {
      json(res, 409, { error: 'already_sent', message: 'this item is in Postiz — delete it and create a new one to change content' });
      return true;
    }
    if (body.status !== undefined && !db.CONTENT_STATUSES.includes(body.status)) {
      json(res, 400, { error: `status must be one of: ${db.CONTENT_STATUSES.join(', ')}` });
      return true;
    }
    const brand = body.brandId !== undefined || body.brandName !== undefined
      ? resolveBrand(cfg.loadConfig(), body) : {};
    if (Array.isArray(body.media)) {
      // New absolute paths get copied into the store; existing store-relative
      // entries pass through unchanged.
      try {
        body.media = ingestMedia(id, body.media.map(String));
      } catch (err) {
        json(res, 400, { error: err.message });
        return true;
      }
    }
    db.updateContentItem(id, { ...body, ...brand });
    bumpWrites();
    json(res, 200, rowToContentItem(db.getContentItemById(id)));
    return true;
  }

  // Attachment upload/removal from the dashboard editor (free — composing).
  // Upload: raw file bytes, ?filename= carries the name. The file lands in the
  // managed store and is pushed to Postiz at schedule time (content-actions).
  const mediaMatch = p.match(/^\/api\/content\/([^/]+)\/media$/);
  if (mediaMatch && (method === 'POST' || method === 'DELETE')) {
    const id = decodeURIComponent(mediaMatch[1]);
    const row = db.getContentItemById(id);
    if (!row) { json(res, 404, { error: `no content item ${id}` }); return true; }
    // Same mirror rule as content PATCH: once in Postiz, no local edits.
    if (row.postiz_post_id && (row.status === 'scheduled' || row.status === 'published')) {
      json(res, 409, { error: 'already_sent', message: 'this item is in Postiz — delete it and create a new one to change content' });
      return true;
    }
    const media = parseContentRow(row).media;
    if (method === 'POST') {
      let buf;
      try {
        buf = await readBinaryBody(req);
      } catch (err) {
        json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'file too large (64MB cap)' : 'upload failed' });
        return true;
      }
      if (!buf.length) { json(res, 400, { error: 'empty upload' }); return true; }
      let entry;
      try {
        entry = saveUploadedMedia(id, url.searchParams.get('filename') ?? 'upload', buf);
      } catch (err) {
        json(res, 400, { error: err.message });
        return true;
      }
      db.updateContentItem(id, { media: [...media, entry] });
    } else {
      const entry = url.searchParams.get('entry') ?? '';
      if (!media.includes(entry)) { json(res, 404, { error: 'no such attachment' }); return true; }
      removeMediaFile(entry);
      db.updateContentItem(id, { media: media.filter(m => m !== entry) });
    }
    bumpWrites();
    json(res, 200, rowToContentItem(db.getContentItemById(id)));
    return true;
  }

  if (itemMatch && method === 'DELETE') {
    const id = decodeURIComponent(itemMatch[1]);
    const row = db.getContentItemById(id);
    if (!row) { json(res, 404, { error: `no content item ${id}` }); return true; }
    const config = cfg.loadConfig();
    // Best-effort remote delete: keeps Postiz from publishing an item the user
    // just discarded locally. Failures are reported, not fatal.
    let remoteDeleted = false;
    if (row.postiz_post_id && postizEnabled(config) && row.status !== 'published') {
      const r = await deletePost(config, row.postiz_post_id);
      remoteDeleted = r.ok;
    }
    db.deleteContentItem(id);
    removeItemMedia(id);
    bumpWrites();
    json(res, 200, { id, deleted: true, remoteDeleted });
    return true;
  }

  /* ----- Postiz connection (free — setup, not acting) ----- */

  if (p === '/api/postiz/status' && method === 'GET') {
    const c = cfg.loadConfig();
    json(res, 200, {
      connected: postizEnabled(c),
      apiUrl: c.postiz?.apiUrl ?? '',
      channelMap: c.postiz?.channelMap ?? {},
    });
    return true;
  }

  // Brand ↔ Postiz-account association (setup, free): { channelMap: { [brandId]: [integrationId] } }.
  if (p === '/api/postiz/channel-map' && method === 'POST') {
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    const raw = body?.channelMap;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      json(res, 400, { error: 'channelMap must be an object of brandId -> [integrationId]' });
      return true;
    }
    const channelMap = {};
    for (const [brandId, ids] of Object.entries(raw)) {
      if (!Array.isArray(ids)) {
        json(res, 400, { error: `channelMap.${brandId} must be an array of integration ids` });
        return true;
      }
      const clean = ids.map(String).filter(Boolean);
      if (clean.length) channelMap[brandId] = clean;
    }
    const config = cfg.loadConfig();
    config.postiz = { ...config.postiz, channelMap };
    cfg.saveConfig(config);
    bumpWrites();
    json(res, 200, { channelMap });
    return true;
  }

  if (p === '/api/postiz/connect' && method === 'POST') {
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    const apiKey = String(body?.apiKey ?? '').trim();
    if (!apiKey) { json(res, 400, { error: 'apiKey required' }); return true; }
    const config = cfg.loadConfig();
    const candidate = {
      ...config,
      postiz: {
        ...config.postiz,
        apiKey,
        ...(body?.apiUrl ? { apiUrl: String(body.apiUrl).replace(/\/+$/, '') } : {}),
      },
    };
    // Validate before saving: a key that can't list channels is a typo.
    const r = await listIntegrations(candidate);
    if (!r.ok) {
      json(res, 502, { error: 'postiz_unreachable', message: r.reason ?? `status ${r.status}` });
      return true;
    }
    cfg.saveConfig(candidate);
    bumpWrites();
    json(res, 200, { connected: true, apiUrl: candidate.postiz.apiUrl, channels: r.data ?? [] });
    return true;
  }

  if (p === '/api/postiz/disconnect' && method === 'POST') {
    const config = cfg.loadConfig();
    config.postiz = { ...config.postiz, apiKey: '' };
    cfg.saveConfig(config);
    bumpWrites();
    json(res, 200, { connected: false });
    return true;
  }

  if (p === '/api/postiz/integrations' && method === 'GET') {
    const config = cfg.loadConfig();
    if (!postizEnabled(config)) { json(res, 409, { error: 'postiz_not_connected' }); return true; }
    const r = await listIntegrations(config);
    if (!r.ok) { json(res, 502, { error: 'postiz_unreachable', message: r.reason }); return true; }
    json(res, 200, { channels: r.data ?? [] });
    return true;
  }

  /* ----- acting/tracking via Postiz (free on purpose — Postiz adoption is
     good for us as a future affiliate; never Pro-gate this pillar) ----- */

  const scheduleMatch = p.match(/^\/api\/content\/([^/]+)\/schedule$/);
  if (scheduleMatch && method === 'POST') {
    const config = cfg.loadConfig();
    if (!postizEnabled(config)) { json(res, 409, { error: 'postiz_not_connected' }); return true; }
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    const id = decodeURIComponent(scheduleMatch[1]);
    const type = ['draft', 'schedule', 'now'].includes(body?.type) ? body.type : 'schedule';
    const r = await scheduleContentItem(config, id, { type, date: body?.date });
    if (!r.ok) {
      json(res, CODE_STATUS[r.code] ?? 500, { error: r.code, message: r.message });
      return true;
    }
    bumpWrites();
    json(res, 200, rowToContentItem(r.row));
    return true;
  }

  if (p === '/api/content/sync' && method === 'POST') {
    const config = cfg.loadConfig();
    if (!postizEnabled(config)) { json(res, 409, { error: 'postiz_not_connected' }); return true; }
    const force = url.searchParams.get('force') === '1';
    if (!force && Date.now() - lastSyncAt < SYNC_MIN_INTERVAL_MS) {
      json(res, 200, { synced: 0, skipped: 'recently synced' });
      return true;
    }
    const r = await syncContentFromPostiz(config, { maxAnalytics: MAX_ANALYTICS_PER_SYNC });
    if (!r.ok) { json(res, 502, { error: 'postiz_unreachable', message: r.message }); return true; }
    lastSyncAt = Date.now();
    if (r.synced) bumpWrites();
    json(res, 200, { synced: r.synced, checked: r.checked });
    return true;
  }

  return false;
}
