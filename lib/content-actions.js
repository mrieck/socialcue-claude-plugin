/**
 * Content Strategy actions shared by the bridge (bridge/content-routes.js) and
 * the CLI (`content schedule` / `content sync`). Pure orchestration over
 * lib/db.js + lib/postiz-client.js; callers own the Pro gate and (for the
 * bridge) mapping result codes to HTTP statuses.
 *
 * Results never throw: { ok: true, ... } or { ok: false, code, message? }.
 * Codes: not_found | already_sent | no_channels | empty_body | no_date |
 *        upload_failed | postiz_error
 */
import * as db from './db.js';
import { ingestMedia, removeItemMedia, resolveMediaPath } from './media-store.js';
import {
  createPost,
  listIntegrations,
  listPosts,
  getPostAnalytics,
  uploadFile,
  buildPostPayload,
} from './postiz-client.js';

/**
 * Insert a content item, copying media attachments into the managed store
 * (`.socialdiscovery/media/<id>/`) so the queue owns its files — the agent's
 * originals can be deleted the moment this returns. Callers pass absolute
 * source paths; the row stores store-relative entries. Throws on a missing
 * media file, rolling the row back.
 */
export function addContentItemWithMedia(item) {
  const media = (item.media ?? []).map(String);
  const id = db.addContentItem({ ...item, media: [] });
  try {
    const stored = ingestMedia(id, media);
    if (stored.length) db.updateContentItem(id, { media: stored });
  } catch (err) {
    db.deleteContentItem(id);
    removeItemMedia(id);
    throw err;
  }
  return id;
}

/** The Postiz integration ids mapped to a brand (config.postiz.channelMap). */
export function channelsForBrand(config, brandId) {
  if (!brandId) return [];
  const mapped = config?.postiz?.channelMap?.[brandId];
  return Array.isArray(mapped) ? mapped : [];
}

/** Parse a content_items row's JSON blobs. */
export function parseContentRow(r) {
  const parse = (s, fallback) => {
    try { return JSON.parse(s); } catch { return fallback; }
  };
  return {
    ...r,
    channels: parse(r.channels, []),
    settings: parse(r.settings, {}),
    metrics: parse(r.metrics, {}),
    media: parse(r.media, []),
  };
}

/** Map a Postiz post state to our content status vocab. */
export function postizStateToStatus(state) {
  const s = String(state ?? '').toUpperCase();
  if (s === 'PUBLISHED') return 'published';
  if (s === 'ERROR') return 'failed';
  if (s === 'DRAFT') return 'draft';
  if (s === 'QUEUE') return 'scheduled';
  return undefined; // unknown → leave local status alone
}

/**
 * Hand a content item to Postiz: upload any media attachments, create the
 * post (type: 'draft' | 'schedule' | 'now'), stamp the row.
 */
export async function scheduleContentItem(config, id, { type = 'schedule', date } = {}) {
  const row = db.getContentItemById(id);
  if (!row) return { ok: false, code: 'not_found', message: `no content item ${id}` };
  if (row.postiz_post_id) {
    return { ok: false, code: 'already_sent', message: 'already in Postiz — sync to see its state' };
  }
  const item = parseContentRow(row);
  if (!item.channels.length) return { ok: false, code: 'no_channels', message: 'pick at least one channel' };
  if (!item.body.trim()) return { ok: false, code: 'empty_body', message: 'draft is empty' };
  const when = date ?? row.scheduled_for;
  if (type === 'schedule' && !when) return { ok: false, code: 'no_date', message: 'a date is required to schedule' };

  // Media first: attachments live in the managed store (store-relative
  // entries; legacy rows hold absolute paths) — a failed upload aborts
  // before anything posts.
  const images = [];
  for (const filePath of item.media) {
    let abs;
    try {
      abs = resolveMediaPath(filePath);
    } catch (err) {
      return { ok: false, code: 'upload_failed', message: err.message };
    }
    const up = await uploadFile(config, abs);
    if (!up.ok) {
      return { ok: false, code: 'upload_failed', message: `upload failed for ${filePath}: ${up.reason}` };
    }
    images.push(up.data);
  }

  // Postiz validates per-channel settings against the platform schema
  // (`__type`, X's who_can_reply_post, …), so map integration id → platform
  // identifier to fill defaults. A failed lookup degrades to no defaults —
  // the create then surfaces Postiz's own validation message.
  const integ = await listIntegrations(config);
  const identifierById = Object.fromEntries(
    (integ.ok ? integ.data ?? [] : []).map(ch => [ch.id, ch.identifier])
  );

  const payload = buildPostPayload(
    { channels: item.channels, settings: item.settings, body: item.body, scheduledFor: when },
    { type, date: when, images, identifierById }
  );
  const r = await createPost(config, payload);
  if (!r.ok) {
    // Postiz failures were invisible before (nothing in bridge.log) — log the
    // reason (never the key) so the next "it failed" is diagnosable.
    console.log(new Date().toISOString(), '[postiz]', `create failed for item ${id}:`, r.reason ?? `status ${r.status}`);
    return { ok: false, code: 'postiz_error', message: r.reason ?? `status ${r.status}` };
  }

  // Response shape: [{postId|id, integration, ...}] or {id} — take the first id we find.
  const first = Array.isArray(r.data) ? r.data[0] : r.data;
  const postizPostId = first?.postId ?? first?.id ?? null;
  db.markContentSent(id, { postizPostId, scheduledFor: when ?? null, published: type === 'now' });
  // Postiz drafts stay editable there; locally the item leaves the queue either way.
  if (type === 'draft') db.updateContentItem(id, { status: 'draft' });
  // A venue-linked item (drafted from a "places to post" nudge) going out
  // closes the nudge and restarts its cadence clock. Postiz drafts don't count
  // yet — they complete via sync once Postiz actually publishes them.
  if ((type === 'schedule' || type === 'now') && row.venue_id && row.brand_id) {
    db.completeVenueRecommendation(row.brand_id, row.venue_id, when ?? undefined);
  }
  return { ok: true, row: db.getContentItemById(id) };
}

/**
 * Pull status/release/analytics back from Postiz for every pending item.
 * maxAnalytics caps per-post analytics calls for rate-limit headroom.
 */
export async function syncContentFromPostiz(config, { maxAnalytics = 10 } = {}) {
  const pending = db.listContentPendingSync();
  if (!pending.length) return { ok: true, synced: 0, checked: 0 };

  // One window covering everything pending beats a request per item.
  const dates = pending.map(r => r.scheduled_for ?? r.created_at).sort();
  const pad = 24 * 3600 * 1000;
  const r = await listPosts(config, {
    startDate: new Date(new Date(dates[0]).getTime() - pad).toISOString(),
    endDate: new Date(new Date(dates[dates.length - 1]).getTime() + 30 * pad).toISOString(),
  });
  if (!r.ok) return { ok: false, code: 'postiz_error', message: r.reason ?? `status ${r.status}` };
  const remote = new Map(
    (Array.isArray(r.data) ? r.data : r.data?.posts ?? []).map(post => [post.id, post])
  );

  let synced = 0;
  let analyticsCalls = 0;
  for (const row of pending) {
    const post = remote.get(row.postiz_post_id);
    if (!post) continue;
    const status = postizStateToStatus(post.state);
    const patch = {
      status,
      releaseUrl: post.releaseURL ?? undefined,
      publishedAt: status === 'published' ? (post.publishDate ?? new Date().toISOString()) : undefined,
    };
    if (status === 'published' && analyticsCalls < maxAnalytics) {
      analyticsCalls += 1;
      const a = await getPostAnalytics(config, row.postiz_post_id);
      if (a.ok && a.data) patch.metrics = a.data;
    }
    db.applyContentSync(row.id, patch);
    // A venue-linked item published from inside Postiz (e.g. a Postiz draft
    // scheduled there) closes its nudge on the way back. Idempotent.
    if (status === 'published' && row.venue_id && row.brand_id) {
      db.completeVenueRecommendation(row.brand_id, row.venue_id, patch.publishedAt);
    }
    synced += 1;
  }
  return { ok: true, synced, checked: pending.length };
}
