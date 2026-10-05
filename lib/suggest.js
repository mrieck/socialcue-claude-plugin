/**
 * The digest /suggest-crosspost reads: everything the user already made
 * (Content Library, logged activity, live product posts) with the platforms
 * each piece has ALREADY reached, so the agent proposes only new targets.
 */
import * as db from './db.js';
import * as cfg from './config.js';
import { normalizePlatform } from './goals.js';
import { parseContentRow } from './content-actions.js';
import { postizEnabled, listIntegrations } from './postiz-client.js';

/** Validate a derived_from key and make sure the referenced row exists. */
export function checkDerivedFrom(key) {
  if (key === undefined || key === null || key === '') return null;
  const m = String(key).match(/^(content|activity|post):([^:\s]+)$/);
  if (!m) throw new Error('derivedFrom must look like content:<id>, activity:<id> or post:<id>');
  const [, kind, id] = m;
  const exists = kind === 'content' ? db.getContentItemById(id)
    : kind === 'activity' ? db.getActivityById(id)
    : db.getPostById(id);
  if (!exists) throw new Error(`derivedFrom: no ${kind} with id ${id}`);
  return `${kind}:${id}`;
}

/** Derived drafts state their target as a `for <platform>: …` notes prefix. */
export function targetFromNotes(notes) {
  const m = String(notes ?? '').match(/^for\s+([a-z0-9.-]+)\s*:/i);
  return m ? normalizePlatform(m[1]) : null;
}

function hostPlatform(url) {
  try {
    const host = new URL(url).hostname.replace(/^(www|old|m)\./, '');
    return normalizePlatform(host.split('.').slice(0, -1).join('.') || host);
  } catch { return null; }
}

function snippet(text, max = 300) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

function derivedSummary(sourceKey) {
  return db.listDerivedFrom(sourceKey).map(r => ({
    id: r.id, title: r.title, status: r.status, target: targetFromNotes(r.notes),
  }));
}

function covered(base, derived) {
  const set = new Set(base.filter(Boolean));
  for (const d of derived) if (d.target) set.add(d.target);
  return [...set].sort();
}

export async function buildSuggestBrief(config = cfg.loadConfig(), { days = 60, max = 8000 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const brands = (config.brands ?? []).filter(b => b.isActive !== false)
    .map(b => ({ id: b.id, name: b.name, tagline: b.tagline ?? '', tags: b.tags ?? [] }));

  let channels = [];
  if (postizEnabled(config)) {
    const r = await listIntegrations(config);
    if (r.ok && Array.isArray(r.data)) {
      channels = r.data.map(c => ({ id: c.id, name: c.name, platform: normalizePlatform(String(c.identifier ?? '').replace(/-standalone$/, '')) }));
    }
  }
  const channelPlatform = Object.fromEntries(channels.map(c => [c.id, c.platform]));

  const contentRows = db.getDb().prepare(
    `SELECT * FROM content_items WHERE status IN ('published', 'scheduled')
       AND COALESCE(published_at, scheduled_for, updated_at) >= ?
     ORDER BY COALESCE(published_at, scheduled_for, updated_at) DESC LIMIT 25`
  ).all(since);
  const postsByContent = db.getDb().prepare(
    `SELECT subject_id, destination_url, listing_url FROM product_posts
     WHERE subject_kind = 'content' AND status IN ('live', 'submitted')`
  ).all();

  const sources = [];
  for (const raw of contentRows) {
    const r = parseContentRow(raw);
    const key = `content:${r.id}`;
    const viaChannels = r.channels.map(id => channelPlatform[id] ?? normalizePlatform(String(r.settings?.[id]?.__type ?? '').replace(/-standalone$/, '')));
    const viaVariants = Object.values(r.variants ?? {}).map(v => normalizePlatform(String(v?.settings?.__type ?? '').replace(/-standalone$/, '')));
    const viaPosts = postsByContent.filter(p => p.subject_id === r.id).map(p => hostPlatform(p.listing_url || p.destination_url));
    const derived = derivedSummary(key);
    sources.push({
      key, kind: 'content', title: r.title, snippet: snippet(r.body), format: r.format,
      brand: r.brand_name, publishedAt: r.published_at ?? r.scheduled_for, releaseUrl: r.release_url,
      hasVideo: r.media.some(m => /\.(mp4|mov|webm)$/i.test(String(m))),
      metrics: r.metrics ?? {}, perf: db.latestCheck(r.id),
      derivedFrom: raw.derived_from ?? null,
      covered: covered([hostPlatform(r.release_url), ...viaChannels, ...viaVariants, ...viaPosts], derived),
      derived,
    });
  }

  const actSince = new Date(Date.now() - 30 * 86400000).toISOString();
  const posts = db.listActivity({ kind: 'post', since: actSince, limit: 20 });
  const comments = db.listActivity({ since: actSince, limit: 200 })
    .filter(a => a.kind !== 'post')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .filter((a, i) => (a.score ?? 0) >= 3 || i < 10)
    .slice(0, 15);
  for (const a of [...posts, ...comments]) {
    const key = `activity:${a.id}`;
    const derived = derivedSummary(key);
    sources.push({
      key, kind: a.kind, platform: a.platform, title: a.title, snippet: snippet(a.body), community: a.community,
      parentTitle: a.parent_title || null, brand: a.brand_name, postedAt: a.posted_at, url: a.url,
      score: a.score, replyCount: a.reply_count, perf: db.latestCheck(a.id),
      contentItemId: a.content_item_id ?? null,
      covered: covered([normalizePlatform(a.platform), a.content_item_id ? 'library' : null], derived),
      derived,
    });
  }

  const live = db.getDb().prepare(
    `SELECT p.*, d.name AS destination_name FROM product_posts p LEFT JOIN destinations d ON d.id = p.destination_id
     WHERE p.status IN ('live', 'submitted') AND p.listing_url IS NOT NULL AND p.listing_url != ''
       AND COALESCE(p.verified_at, p.submitted_at, p.updated_at) >= ?
     ORDER BY COALESCE(p.verified_at, p.submitted_at, p.updated_at) DESC LIMIT 15`
  ).all(since);
  for (const p of live) {
    const key = `post:${p.id}`;
    const derived = derivedSummary(key);
    sources.push({
      key, kind: 'product_post', subject: p.subject_name, subjectKey: p.subject_key, postType: p.post_type,
      destination: p.destination_name || p.destination_url, listingUrl: p.listing_url,
      verifiedAt: p.verified_at ?? p.submitted_at, perf: db.latestCheck(p.id),
      covered: covered([hostPlatform(p.listing_url || p.destination_url)], derived),
      derived,
    });
  }

  const brief = {
    generatedAt: new Date().toISOString(),
    brands,
    platforms: config.platforms ?? [],
    handles: config.handles ?? {},
    channels,
    sources,
  };
  // Trim the oldest sources until the digest fits the prompt budget.
  let json = JSON.stringify(brief, null, 1);
  while (json.length > max && brief.sources.length > 5) {
    brief.sources.pop();
    json = JSON.stringify(brief, null, 1);
  }
  return brief;
}
