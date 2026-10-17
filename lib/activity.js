/**
 * Activity log — things the user posted anywhere (often from the phone),
 * collected by /log-activity from their own profile / replies pages. Shared by
 * the CLI (`activity …`) and the MCP `collect_activity` tool.
 */
import * as db from './db.js';
import * as cfg from './config.js';
import { resolvePlatform, canonicalKey } from './platform-keys.js';

// Not a cap: two already-logged items in a row means the rest of the page is logged too.
export const STOP_AFTER_SKIPS = 2;

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
 * Budgets come from Settings (maxTurnsPerPlatform, activityLookbackDays) only.
 *
 * A platform's cutoff only moves once a run read it down to the cutoff
 * (`activity synced`). If a run stopped early, the next one keeps the old
 * cutoff and walks past already-logged items to fill the gap.
 */
export function buildActivityPlan(config = cfg.loadConfig(), { since = null, platforms = null } = {}) {
  const handles = config.handles ?? {};
  const wanted = (platforms && platforms.length ? platforms : config.platforms).map(canonicalKey);
  const plan = [];
  const missing = [];
  const skipped = [];
  const lookbackDays = config.activityLookbackDays ?? 30;
  const lookback = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  for (const key of wanted) {
    const p = resolvePlatform(key);
    if (typeof p.activityUrls !== 'function') { skipped.push({ key, name: p.name, reason: 'no readable activity pages (video-only or unsupported)' }); continue; }
    const handle = handles[key];
    if (!handle) { missing.push({ key, name: p.name, homeUrl: p.homeUrl }); continue; }
    const synced = db.activitySyncedAt(key);
    const latest = db.latestActivityAt(key);
    let cutoff, mode;
    if (since) { cutoff = since; mode = 'since'; }
    // One day of tolerance: relative timestamps are approximate and pinned posts break ordering.
    else if (synced) { cutoff = new Date(Date.parse(synced) - 86400000).toISOString(); mode = latest && latest > synced ? 'gap' : 'synced'; }
    else { cutoff = lookback; mode = latest ? 'gap' : 'first'; }
    plan.push({
      key, name: p.name, handle, cutoff, mode,
      stopOnSkips: mode === 'synced' || mode === 'first',
      pages: p.activityUrls(handle),
      hints: p.activityHints ?? [],
    });
  }
  return { plan, missing, skipped, budget: { turnsPerPlatform: config.maxTurnsPerPlatform ?? 75, lookbackDays } };
}

const CUTOFF_REASON = {
  since: 'from the requested start date',
  first: 'first run: the Settings lookback',
  synced: 'last complete read minus a day',
  gap: 'a previous run stopped before reaching this cutoff',
};

/** Markdown brief the /log-activity command pastes into its own reasoning. */
export function renderActivityBrief(planResult) {
  const { plan, missing, skipped, budget } = planResult;
  const lines = [];
  lines.push('# Activity log run');
  lines.push('');
  lines.push(`Budget (from Settings): ${budget.turnsPerPlatform} turns per platform. Every platform gets its own budget; there is no per-run item or scroll cap. First runs look back ${budget.lookbackDays} days.`);
  lines.push(`Read each page down to the cutoff. On platforms marked "stop on logged items", also stop after ${STOP_AFTER_SKIPS} consecutive skipped:true from collect_activity (the rest is logged). On the others keep scrolling past logged items until the cutoff.`);
  lines.push('When a platform has been read down to its cutoff (or stopped on logged items where allowed), run `activity synced <platform key>`. Do not run it if the turn budget ran out first: the next run then continues from the same cutoff.');
  lines.push('Pacing: navigate already pauses; never issue bursts, never search, one tab, screenshots only when a page will not read. Do not like, reply or post anything.');
  lines.push('Notifications pages are not part of this run: your own comments/replies pages already contain everything you typed.');
  lines.push('');
  if (missing.length) {
    lines.push('## Missing handles');
    for (const m of missing) lines.push(`- ${m.key} (${m.name}): open ${m.homeUrl}, read your username from the account menu/header, then run \`config handles set ${m.key} <handle>\` and re-run \`activity brief\`.`);
    lines.push('');
  }
  if (skipped.length) {
    lines.push('## Unsupported platforms');
    for (const s of skipped) lines.push(`- ${s.key}: ${s.reason}`);
    lines.push('');
  }
  for (const p of plan) {
    lines.push(`## ${p.name} (platform key: ${p.key}, handle: ${p.handle})`);
    lines.push(`Cutoff: ${p.cutoff} (${CUTOFF_REASON[p.mode]}). ${p.stopOnSkips ? 'Stop on logged items.' : 'Keep going past logged items.'}`);
    for (const page of p.pages) lines.push(`- [${page.kind}] ${page.url}\n  ${page.hint}`);
    for (const h of p.hints) lines.push(`- Hint: ${h}`);
    lines.push('');
  }
  if (!plan.length) lines.push('Nothing to read: add handles first.');
  return lines.join('\n');
}
