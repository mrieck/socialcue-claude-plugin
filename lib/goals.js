/**
 * Weekly goals — the Analytics tab's "did I do the routine this week" board.
 *
 * A goal is a per-week publishing target ("3 TikTok videos") with an optional
 * auto-rule that counts rows already in the store, plus manual "Log one"
 * entries for things Social Cue never sees (SEO articles on a blog, a demo
 * video). Auto and manual counts are reported separately so the user can see
 * what the store knows vs what they told it.
 *
 * Weeks run Sunday 00:00 local → next Sunday 00:00 local (weekStartsOn = 0),
 * computed in this process's timezone (the bridge runs on the user's machine).
 * Everything here is local; nothing leaves the machine.
 */
import * as db from './db.js';
import * as cfg from './config.js';

/* ---------- week math ---------- */

function pad2(n) { return String(n).padStart(2, '0'); }

/** Local calendar date as YYYY-MM-DD. */
export function localYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse YYYY-MM-DD as a LOCAL date (new Date('YYYY-MM-DD') would be UTC and
 *  shift a day west of Greenwich). Anything else → null. */
export function parseWeekParam(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3])) return null;
  return d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The local week containing `date`. `start`/`end` are UTC ISO strings for SQL
 * (end exclusive); `startDate`/`endDate` are local YYYY-MM-DD (endDate is the
 * last day of the week, for display); `label` reads "Sep 6 – Sep 12".
 */
export function weekBounds(date = new Date(), weekStartsOn = 0) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error('weekBounds: invalid date');
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - weekStartsOn + 7) % 7));
  const end = new Date(d);
  end.setDate(end.getDate() + 7); // setDate keeps local midnight across DST
  const last = new Date(end);
  last.setDate(last.getDate() - 1);
  const today = new Date();
  const sameYear = d.getFullYear() === today.getFullYear() && last.getFullYear() === today.getFullYear();
  const fmt = x => `${MONTHS[x.getMonth()]} ${x.getDate()}${sameYear ? '' : ` ${x.getFullYear()}`}`;
  return {
    start: d.toISOString(),
    end: end.toISOString(),
    startDate: localYmd(d),
    endDate: localYmd(last),
    label: `${fmt(d)} – ${fmt(last)}`,
    isCurrent: today >= d && today < end,
  };
}

/* ---------- platform normalisation ---------- */

// Discovery writes opportunities.platform as free text ("Hacker News",
// "Twitter/X", "indiehackers"); the SQL side lowercases and strips
// spaces/slashes/dots/dashes, so these keys must be in that same reduced form.
const PLATFORM_ALIASES = {
  x: ['x', 'twitter', 'twitterx', 'xtwitter', 'xcom', 'twittercom'],
  hackernews: ['hackernews', 'hn', 'newsycombinatorcom', 'ycombinator'],
  indiehackers: ['indiehackers', 'ih', 'indiehackerscom'],
  producthunt: ['producthunt', 'ph', 'producthuntcom'],
  threads: ['threads', 'threadsnet', 'threadscom'],
  reddit: ['reddit', 'redditcom'],
  devto: ['devto', 'dev', 'devcommunity'],
  instagram: ['instagram', 'instagramstandalone', 'ig'],
  youtube: ['youtube', 'youtubecom', 'yt'],
  tiktok: ['tiktok', 'tiktokcom'],
  linkedin: ['linkedin', 'linkedincom'],
  bluesky: ['bluesky', 'bsky', 'bskyapp'],
  facebook: ['facebook', 'fb', 'facebookcom'],
  mastodon: ['mastodon', 'mastodonsocial'],
  hashnode: ['hashnode'],
  medium: ['medium', 'mediumcom'],
};
const ALIAS_TO_CANON = new Map();
for (const [canon, list] of Object.entries(PLATFORM_ALIASES)) for (const a of list) ALIAS_TO_CANON.set(a, canon);

export function normalizePlatform(s) {
  const key = String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return '';
  return ALIAS_TO_CANON.get(key) ?? key;
}

/** Every reduced-form spelling that should count as `canon` (for SQL IN). */
export function platformAliases(canon) {
  const c = normalizePlatform(canon);
  return PLATFORM_ALIASES[c] ?? [c];
}

/* ---------- rules ---------- */

export const RULE_TYPES = ['content', 'post', 'reply'];
export const POST_TYPES = ['listing', 'article', 'thread', 'link'];

function optStr(v, name, { lower = false, max = 120 } = {}) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new Error(`invalid_rule: ${name} must be a string`);
  const s = (lower ? v.toLowerCase() : v).trim();
  if (s.length > max) throw new Error(`invalid_rule: ${name} too long`);
  return s || null;
}

/**
 * Validate + normalise a rule. Returns the canonical rule object, or null for
 * "manual only". Throws Error('invalid_rule: …') on anything else.
 */
export function validateRule(rule) {
  if (rule === undefined || rule === null || rule === '') return null;
  if (typeof rule === 'string') {
    try { rule = JSON.parse(rule); } catch { throw new Error('invalid_rule: not JSON'); }
  }
  if (typeof rule !== 'object' || Array.isArray(rule)) throw new Error('invalid_rule: must be an object');
  const type = String(rule.type ?? '');
  if (!RULE_TYPES.includes(type)) throw new Error(`invalid_rule: type must be one of ${RULE_TYPES.join('|')}`);
  if (type === 'content') {
    const platform = optStr(rule.platform, 'platform', { lower: true });
    return {
      type,
      platform: platform ? normalizePlatform(platform) : null,
      source: optStr(rule.source, 'source'),
      titlePrefix: optStr(rule.titlePrefix, 'titlePrefix'),
      excludeTitlePrefix: optStr(rule.excludeTitlePrefix, 'excludeTitlePrefix'),
    };
  }
  if (type === 'post') {
    const postType = optStr(rule.postType, 'postType', { lower: true });
    if (postType && !POST_TYPES.includes(postType)) {
      throw new Error(`invalid_rule: postType must be one of ${POST_TYPES.join('|')}`);
    }
    let host = optStr(rule.destinationHost, 'destinationHost', { lower: true });
    if (host) host = host.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    return { type, postType, destinationHost: host };
  }
  // reply
  const platform = optStr(rule.platform, 'platform', { lower: true });
  return { type, platform: platform ? normalizePlatform(platform) : null };
}

export function parseRule(raw) {
  if (!raw) return null;
  try { return validateRule(raw); } catch { return null; }
}

/** Auto count for one rule inside a week. Manual-only goals → 0. */
export function evaluateRule(rule, brandId, week) {
  const r = parseRule(rule);
  if (!r) return 0;
  const { start, end } = week;
  if (r.type === 'content') {
    return db.countContentInWeek({
      start, end, brandId: brandId ?? null,
      platform: r.platform, source: r.source, titlePrefix: r.titlePrefix, excludeTitlePrefix: r.excludeTitlePrefix,
    });
  }
  if (r.type === 'post') {
    return db.countPostsInWeek({ start, end, brandId: brandId ?? null, postType: r.postType, destinationHost: r.destinationHost });
  }
  return db.countRepliesInWeek({
    start, end, brandId: brandId ?? null,
    platformKeys: r.platform ? platformAliases(r.platform) : null,
  });
}

/** Short human label for a rule, for the goal card ("auto: threads · meme-"). */
export function describeRule(rule) {
  const r = parseRule(rule);
  if (!r) return 'manual';
  const bits = [];
  if (r.type === 'content') {
    bits.push('content');
    if (r.platform) bits.push(r.platform);
    if (r.source) bits.push(r.source);
    if (r.titlePrefix) bits.push(`"${r.titlePrefix}…"`);
    if (r.excludeTitlePrefix) bits.push(`not "${r.excludeTitlePrefix}…"`);
  } else if (r.type === 'post') {
    bits.push('post');
    if (r.destinationHost) bits.push(r.destinationHost);
    if (r.postType) bits.push(r.postType);
  } else {
    bits.push('reply');
    if (r.platform) bits.push(r.platform);
  }
  return bits.join(' · ');
}

/* ---------- summary ---------- */

function rowToEntry(e) {
  return { id: e.id, goalId: e.goal_id, at: e.at, note: e.note ?? '', source: e.source, ref: e.ref ?? null, createdAt: e.created_at };
}

function brandNameFor(brandId, brands) {
  if (!brandId) return null;
  return brands.find(b => b.id === brandId)?.name ?? null;
}

/** One goal with this week's numbers (the API shape). */
export function goalSummary(row, week, brands) {
  const rule = parseRule(row.rule);
  const entries = db.listGoalEntries(row.id, week).map(rowToEntry);
  const autoCount = evaluateRule(rule, row.brand_id, week);
  const manualCount = entries.length;
  return {
    id: row.id,
    title: row.title,
    target: row.target,
    period: row.period,
    brandId: row.brand_id ?? null,
    brandName: brandNameFor(row.brand_id, brands),
    rule,
    ruleLabel: describeRule(rule),
    sortOrder: row.sort_order,
    archivedAt: row.archived_at ?? null,
    autoCount,
    manualCount,
    count: autoCount + manualCount,
    entries,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The board: every goal with counts for the week containing `date` (default
 * now). `weekParam` accepts YYYY-MM-DD (any day in the wanted week).
 */
export function weekSummary({ weekParam = null, date = null, includeArchived = false } = {}) {
  const anchor = parseWeekParam(weekParam) ?? date ?? new Date();
  const week = weekBounds(anchor);
  const brands = safeBrands();
  const goals = db.listGoals({ includeArchived }).map(row => goalSummary(row, week, brands));
  const active = goals.filter(g => !g.archivedAt);
  const totals = {
    goals: active.length,
    target: active.reduce((n, g) => n + g.target, 0),
    count: active.reduce((n, g) => n + Math.min(g.count, g.target), 0),
    met: active.filter(g => g.count >= g.target).length,
  };
  return { week, goals, totals };
}

/** Sidebar badge: active goals still short this week. Zero queries when there are no goals. */
export function goalsShortCount() {
  if (!db.goalsExist()) return 0;
  const week = weekBounds(new Date());
  let short = 0;
  for (const row of db.listGoals()) {
    const auto = evaluateRule(parseRule(row.rule), row.brand_id, week);
    if (auto >= row.target) continue;
    const manual = db.listGoalEntries(row.id, week).length;
    if (auto + manual < row.target) short += 1;
  }
  return short;
}

function safeBrands() {
  try { return cfg.loadConfig().brands ?? []; } catch { return []; }
}

/** Resolve a goal by id, id prefix, or unique case-insensitive title substring. */
export function resolveGoal(ref, { includeArchived = true } = {}) {
  const r = String(ref ?? '').trim();
  if (!r) return { goal: null, candidates: [] };
  const exact = db.getGoalById(r);
  if (exact) return { goal: exact, candidates: [exact] };
  const all = db.listGoals({ includeArchived });
  const byPrefix = all.filter(g => g.id.startsWith(r));
  if (byPrefix.length === 1) return { goal: byPrefix[0], candidates: byPrefix };
  const needle = r.toLowerCase();
  const byTitle = all.filter(g => g.title.toLowerCase().includes(needle));
  if (byTitle.length === 1) return { goal: byTitle[0], candidates: byTitle };
  return { goal: null, candidates: byPrefix.length ? byPrefix : byTitle };
}

/* ---------- starter set ---------- */

/** The founder's stated weekly cadence. `brandHint` resolves to a configured
 *  brand by case-insensitive name containment (NULL when absent). */
export const STARTER_GOALS = [
  { title: 'Meme a day on Threads', target: 7, rule: { type: 'content', platform: 'threads', titlePrefix: 'meme-' } },
  { title: 'TikTok videos', target: 3, rule: { type: 'content', platform: 'tiktok' } },
  { title: 'Indie Hackers articles', target: 2, rule: { type: 'post', destinationHost: 'indiehackers.com' } },
  { title: 'Technical article on dev.to', target: 1, rule: { type: 'post', destinationHost: 'dev.to' } },
  { title: 'SEO articles on trysocialcue.com', target: 3, brandHint: 'social cue', rule: null },
  { title: 'SEO articles on tryoverboard.com', target: 3, brandHint: 'overboard', rule: null },
  { title: 'Non-meme Threads posts (questions / research)', target: 3, rule: { type: 'content', platform: 'threads', excludeTitlePrefix: 'meme-' } },
  { title: 'Widescreen demo video', target: 1, rule: null },
];

/** Insert the starter set once. No-op (skipped: true) when any goal exists. */
export function seedStarterGoals() {
  if (db.goalsExist()) return { added: 0, skipped: true };
  const brands = safeBrands();
  const findBrand = hint => hint
    ? brands.find(b => b.name.toLowerCase().includes(hint.toLowerCase()))?.id ?? null
    : null;
  let added = 0;
  STARTER_GOALS.forEach((g, i) => {
    db.createGoal({ title: g.title, target: g.target, brandId: findBrand(g.brandHint), rule: validateRule(g.rule), sortOrder: i });
    added += 1;
  });
  return { added, skipped: false };
}
