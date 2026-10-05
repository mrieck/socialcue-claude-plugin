/**
 * Activity log — things the user posted anywhere (often from the phone),
 * collected by /log-activity from their own profile / replies pages. Shared by
 * the CLI (`activity …`) and the MCP `collect_activity` tool.
 */
import * as db from './db.js';
import * as cfg from './config.js';
import { resolvePlatform, canonicalKey } from './platform-keys.js';

export const ACTIVITY_RUN = { turnsPerPlatform: 12, itemsPerRun: 40, firstRunDays: 30, stopAfterSkips: 2 };

function firstLine(text, max = 80) {
  const line = String(text ?? '').split('\n').map(s => s.trim()).find(Boolean) ?? '';
  return line.length > max ? line.slice(0, max - 1).trimEnd() + '…' : line;
}

/**
 * File an original post in the Content Library as published (so
 * /suggest-crosspost can repurpose it). Comments/replies/reposts are refused.
 * Idempotent: returns the existing content item id on a second call.
 */
export function promoteActivity(id) {
  const row = db.getActivityById(id);
  if (!row) throw new Error(`No activity ${id}`);
  if (row.content_item_id) return { contentItemId: row.content_item_id, created: false };
  if (row.kind !== 'post') throw new Error(`Only posts are filed in the Content Library (this is a ${row.kind})`);
  const platform = resolvePlatform(row.platform);
  const contentItemId = db.addContentItem({
    brandId: row.brand_id ?? null,
    brandName: row.brand_name ?? '',
    title: row.title || firstLine(row.body),
    body: row.body ?? '',
    status: 'published',
    source: 'activity',
    format: 'text',
    channels: [],
    notes: `Posted on ${platform.name}${row.community ? ' (' + row.community + ')' : ''}${row.handle ? ' as @' + row.handle : ''}; logged by /log-activity`,
  });
  db.markContentPublished(contentItemId, { releaseUrl: row.url, publishedAt: row.posted_at ?? null });
  db.linkActivityContent(id, contentItemId);
  return { contentItemId, created: true };
}

/** addActivity + (for posts) promotion. `brandId` may be a brand name or id. */
export function recordActivity(args, { promote = true } = {}) {
  const brand = args.brandId ? cfg.resolveBrand(args.brandId) : null;
  const platform = canonicalKey(args.platform);
  const { id, created } = db.addActivity({
    ...args,
    platform,
    brandId: brand?.id ?? null,
    brandName: brand?.name ?? '',
  });
  let contentItemId = db.getActivityById(id)?.content_item_id ?? null;
  if (created && promote && args.kind === 'post') contentItemId = promoteActivity(id).contentItemId;
  return { id, created, contentItemId };
}

/**
 * The per-platform plan for a /log-activity run: which URLs to read, from
 * when, and how. Platforms without a handle are listed so the agent can find
 * one; platforms without activityUrls (video-only) are skipped outright.
 */
export function buildActivityPlan(config = cfg.loadConfig(), { since = null, platforms = null } = {}) {
  const handles = config.handles ?? {};
  const wanted = (platforms && platforms.length ? platforms : config.platforms).map(canonicalKey);
  const plan = [];
  const missing = [];
  const skipped = [];
  const firstRun = new Date(Date.now() - ACTIVITY_RUN.firstRunDays * 86400000).toISOString();
  for (const key of wanted) {
    const p = resolvePlatform(key);
    if (typeof p.activityUrls !== 'function') { skipped.push({ key, name: p.name, reason: 'no readable activity pages (video-only or unsupported)' }); continue; }
    const handle = handles[key];
    if (!handle) { missing.push({ key, name: p.name, homeUrl: p.homeUrl }); continue; }
    const latest = db.latestActivityAt(key);
    // One day of tolerance: relative timestamps are approximate and pinned posts break ordering.
    const cutoff = since ?? (latest ? new Date(Date.parse(latest) - 86400000).toISOString() : firstRun);
    plan.push({
      key, name: p.name, handle, cutoff, firstRun: !latest,
      pages: p.activityUrls(handle),
      hints: p.activityHints ?? [],
    });
  }
  return { plan, missing, skipped, caps: ACTIVITY_RUN };
}

/** Markdown brief the /log-activity command pastes into its own reasoning. */
export function renderActivityBrief(planResult) {
  const { plan, missing, skipped, caps } = planResult;
  const lines = [];
  lines.push('# Activity log run');
  lines.push('');
  lines.push(`Caps: ${caps.turnsPerPlatform} turns per platform, ${caps.itemsPerRun} items per run, 3 scrolls per page. Stop a page after ${caps.stopAfterSkips} consecutive skipped:true from collect_activity (you have reached logged items) or once items are older than the cutoff.`);
  lines.push('Pacing: navigate already pauses; never issue bursts, never search, one tab, screenshots only when a page will not read. Do not like, reply or post anything.');
  lines.push('Notifications pages are not part of this run: your own comments/replies pages already contain everything you typed.');
  lines.push('');
  if (missing.length) {
    lines.push('## Missing handles');
    for (const m of missing) lines.push(`- ${m.key} (${m.name}): open ${m.homeUrl}, read your username from the account menu/header, then run \`config handles set ${m.key} <handle>\` and re-run \`activity brief\`.`);
    lines.push('');
  }
  if (skipped.length) {
    lines.push('## Skipped platforms');
    for (const s of skipped) lines.push(`- ${s.key}: ${s.reason}`);
    lines.push('');
  }
  for (const p of plan) {
    lines.push(`## ${p.name} (platform key: ${p.key}, handle: ${p.handle})`);
    lines.push(`Cutoff: ${p.cutoff}${p.firstRun ? ' (first run: last 30 days)' : ' (newest logged item minus a day)'}`);
    for (const page of p.pages) lines.push(`- [${page.kind}] ${page.url}\n  ${page.hint}`);
    for (const h of p.hints) lines.push(`- Hint: ${h}`);
    lines.push('');
  }
  if (!plan.length) lines.push('Nothing to read: add handles first.');
  return lines.join('\n');
}
