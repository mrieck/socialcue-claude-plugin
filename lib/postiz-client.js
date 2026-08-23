/**
 * Postiz client — the plugin's SECOND outbound integration (the first is the
 * license refresh in license-refresh.js), and strictly opt-in: every function
 * is dormant until the user pastes an API key into config.postiz. Requests go
 * only to the user's own Postiz endpoint (cloud or self-hosted apiUrl) and
 * carry only content the user explicitly composed for scheduling — never
 * opportunities, brand metadata, or page data. The API key is never logged
 * and never included in any return value.
 *
 * Like license-refresh.js this module never throws into hot paths: every call
 * resolves to { ok, status?, data?, reason? }.
 */

const TIMEOUT_MS = 8000;
// Creating a post can fan out to many platforms server-side; give it longer.
const CREATE_TIMEOUT_MS = 20000;
// Uploads carry whole video files (Postiz allows up to 1GB of mp4) — 20s would
// abort any real video on a home connection.
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** Is the Postiz integration configured (opt-in switch)? */
export function postizEnabled(config) {
  return !!config?.postiz?.apiKey;
}

async function request(config, method, path, { body, timeoutMs = TIMEOUT_MS } = {}) {
  const { apiUrl, apiKey } = config?.postiz ?? {};
  if (!apiKey) return { ok: false, reason: 'postiz not configured' };
  const base = String(apiUrl || 'https://api.postiz.com/public/v1').replace(/\/+$/, '');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        // Postiz expects the raw key, not a Bearer scheme.
        authorization: apiKey,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, reason: 'invalid API key or unauthorized' };
    }
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch { /* body unavailable */ }
      return { ok: false, status: res.status, reason: `postiz ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    let data = null;
    try { data = await res.json(); } catch { /* some endpoints return no body */ }
    return { ok: true, status: res.status, data };
  } catch (err) {
    // Offline / DNS / abort — reported, never thrown.
    return { ok: false, reason: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Connected channels: [{id, name, identifier (platform), picture, disabled}]. */
export function listIntegrations(config) {
  return request(config, 'GET', '/integrations');
}

/**
 * Live per-platform schema for one channel: {output: {rules, maxLength,
 * settings (JSON Schema of the provider DTO, or a string when none), tools}}.
 * Lets an authoring agent check the real field list instead of guessing;
 * note Postiz silently DISCARDS inapplicable settings rather than rejecting.
 */
export function getIntegrationSettings(config, integrationId) {
  return request(config, 'GET', `/integration-settings/${encodeURIComponent(integrationId)}`);
}

/** Create/schedule a post (payload from buildPostPayload). */
export function createPost(config, payload) {
  return request(config, 'POST', '/posts', { body: payload, timeoutMs: CREATE_TIMEOUT_MS });
}

/** List posts, optionally within a window (ISO strings). */
export function listPosts(config, { startDate, endDate } = {}) {
  const q = new URLSearchParams();
  if (startDate) q.set('startDate', startDate);
  if (endDate) q.set('endDate', endDate);
  const qs = q.toString();
  return request(config, 'GET', `/posts${qs ? `?${qs}` : ''}`);
}

export function deletePost(config, postId) {
  return request(config, 'DELETE', `/posts/${encodeURIComponent(postId)}`);
}

/** Per-post performance (likes/comments/shares — shape varies by platform). */
export function getPostAnalytics(config, postId) {
  return request(config, 'GET', `/analytics/post/${encodeURIComponent(postId)}`);
}

/**
 * Upload a local media file (meme, screenshot, demo video) so posts can
 * reference it. Multipart, so it bypasses the JSON request() helper; same
 * never-throws contract. Returns the raw upload descriptor in data — pass it
 * into buildPostPayload's images as-is.
 */
export async function uploadFile(config, filePath) {
  const { apiUrl, apiKey } = config?.postiz ?? {};
  if (!apiKey) return { ok: false, reason: 'postiz not configured' };
  const base = String(apiUrl || 'https://api.postiz.com/public/v1').replace(/\/+$/, '');

  let blob;
  try {
    const { openAsBlob } = await import('node:fs');
    blob = await openAsBlob(filePath);
  } catch (err) {
    return { ok: false, reason: `cannot read ${filePath}: ${String(err?.message ?? err)}` };
  }
  const form = new FormData();
  form.append('file', blob, filePath.split('/').pop());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${base}/upload`, {
      method: 'POST',
      headers: { authorization: apiKey },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 300); } catch { /* body unavailable */ }
      return { ok: false, status: res.status, reason: `upload ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    return { ok: true, status: res.status, data: await res.json() };
  } catch (err) {
    return { ok: false, reason: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/** YouTube requires a 2–100 char title; make any fallback string legal. */
function clampTitle(title) {
  const t = String(title ?? '').trim().slice(0, 100);
  return t.length >= 2 ? t : 'Untitled';
}

/**
 * Baseline settings Postiz's validator demands per platform, merged UNDER the
 * editor's settings. `__type` picks the platform settings schema and is
 * required for every channel. Some platforms validate more than __type, so a
 * bare schedule must not 400: YouTube needs title+type, TikTok a whole block
 * of publish flags (DIRECT_POST — the UPLOAD method only drops media in the
 * TikTok inbox while reporting success), Instagram needs post_type ('post'
 * with a single video is how a Reel is expressed; there is no 'reel' value).
 */
function defaultSettingsFor(identifier, { fallbackTitle } = {}) {
  if (!identifier) return {};
  const base = { __type: identifier };
  switch (identifier) {
    case 'x':
    case 'twitter':
      return { ...base, who_can_reply_post: 'everyone' };
    case 'youtube':
      return { ...base, title: clampTitle(fallbackTitle), type: 'public' };
    case 'tiktok':
      return {
        ...base,
        privacy_level: 'PUBLIC_TO_EVERYONE',
        duet: true, stitch: true, comment: true,
        autoAddMusic: 'no',
        brand_content_toggle: false, brand_organic_toggle: false,
        content_posting_method: 'DIRECT_POST',
      };
    case 'instagram':
    case 'instagram-standalone':
      return { ...base, post_type: 'post' };
    default:
      return base;
  }
}

/**
 * Build the Postiz create-post payload from a content_items row (parsed:
 * channels as array, settings/variants as objects). Pure — exported for CLI
 * reuse. One call carries every selected channel, which keeps us far under
 * the ~90 req/hour create limit.
 *
 * The API rejects payloads without shortLink/tags and without per-channel
 * `__type` settings, so callers should pass identifierById (integration id →
 * platform identifier, from listIntegrations) to fill setting defaults.
 * Per-channel packaging comes from item.variants[integrationId] =
 * { content?, settings? }: content falls back to item.body, and settings
 * layer platform defaults < item.settings[id] < variant.settings.
 */
export function buildPostPayload(item, { type = 'schedule', date, images = [], identifierById = {} } = {}) {
  return {
    type,
    date: date ?? item.scheduledFor ?? new Date().toISOString(),
    shortLink: false,
    tags: [],
    posts: (item.channels ?? []).map(id => {
      const variant = item.variants?.[id] ?? {};
      return {
        integration: { id },
        // images = upload descriptors from uploadFile(), attached to every channel.
        value: [{ content: variant.content ?? item.body ?? '', image: images }],
        settings: {
          ...defaultSettingsFor(identifierById[id], { fallbackTitle: item.title }),
          ...(item.settings?.[id] ?? {}),
          ...(variant.settings ?? {}),
        },
      };
    }),
  };
}
