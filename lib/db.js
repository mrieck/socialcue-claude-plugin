/**
 * Local SQLite store (better-sqlite3).
 *
 * Holds generated state only — brands/accounts live in config.json (the
 * user-editable source of truth). Tables:
 *   - seen_urls     : cross-run dedupe (normalized key + TTL pruning)
 *   - opportunities : discovered opportunities (from either sensor)
 *   - runs          : discovery run history
 */
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { dbPath, ensureBaseDir } from './paths.js';
import { normalizeUrl } from '../vendor/shared/normalize-url.js';

let _db = null;

export function getDb() {
  if (_db) return _db;
  ensureBaseDir();
  _db = new Database(dbPath());
  _db.pragma('journal_mode = WAL');
  // The bridge server and the discovery MCP server may hit the DB from separate
  // processes; WAL + a busy timeout lets writers queue instead of throwing SQLITE_BUSY.
  _db.pragma('busy_timeout = 5000');
  migrate(_db);
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS seen_urls (
      normalized   TEXT PRIMARY KEY,
      url          TEXT NOT NULL,
      platform     TEXT,
      opp_id       TEXT,
      first_seen   TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id               TEXT PRIMARY KEY,
      brand_id         TEXT,
      run_id           TEXT,
      source           TEXT NOT NULL DEFAULT 'plugin',
      platform         TEXT NOT NULL,
      platform_url     TEXT NOT NULL,
      title            TEXT DEFAULT '',
      context          TEXT DEFAULT '',
      opportunity_type TEXT DEFAULT 'general_comment',
      relevance_score  REAL,
      relevance_reason TEXT DEFAULT '',
      suggested_reply  TEXT DEFAULT '',
      suggested_action TEXT DEFAULT '',
      status           TEXT NOT NULL DEFAULT 'new',
      screenshot_path  TEXT,
      created_at       TEXT NOT NULL,
      published_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_opp_status ON opportunities(status);
    CREATE INDEX IF NOT EXISTS idx_opp_run ON opportunities(run_id);

    CREATE TABLE IF NOT EXISTS runs (
      id           TEXT PRIMARY KEY,
      started_at   TEXT NOT NULL,
      finished_at  TEXT,
      platforms    TEXT,
      status       TEXT NOT NULL DEFAULT 'running',
      summary      TEXT DEFAULT ''
    );
  `);

  // Additive migrations (bridge/dashboard). seen_urls.opp_id can't serve as the
  // URL→opportunity link (it stays NULL when the URL was seen before the opp
  // existed), so opportunities carries its own normalized_url dedupe key.
  const cols = db.prepare('PRAGMA table_info(opportunities)').all().map(c => c.name);
  if (!cols.includes('normalized_url')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN normalized_url TEXT');
  }
  if (!cols.includes('brand_name')) {
    db.exec("ALTER TABLE opportunities ADD COLUMN brand_name TEXT DEFAULT ''");
  }
  // Assisted-posting audit trail: when a post intent last opened this
  // opportunity in the browser. Marking 'posted' stays a manual user action.
  if (!cols.includes('posted_intent_at')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN posted_intent_at TEXT');
  }
  // Sensor axis: 'reply' (a discovered conversation to reply to — the default)
  // vs 'recommendation' (a plugin-only "place to post" nudge). Kept separate
  // from opportunity_type (the free-text scoring taxonomy) so the two tabs can
  // filter cleanly. Existing rows backfill to 'reply' via the column DEFAULT.
  if (!cols.includes('kind')) {
    db.exec("ALTER TABLE opportunities ADD COLUMN kind TEXT NOT NULL DEFAULT 'reply'");
  }
  // Links a recommendation row back to its catalog venue, so cadence tracking
  // keys on venue_id rather than reverse-mapping the (shareable) submit URL.
  if (!cols.includes('venue_id')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN venue_id TEXT');
  }
  // Source post's publish time (ISO), distinct from created_at (discovery time).
  // Nullable — not every sensor can read it; drives the "fresh" badge only.
  if (!cols.includes('published_at')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN published_at TEXT');
  }
  // Draft feedback loop. suggested_reply stays immutable (the generated draft);
  // user_reply is the user's rewrite (NULL = untouched; effective reply =
  // user_reply || suggested_reply), reply_note holds per-opportunity feedback,
  // example_saved_at stamps promotion into voice-guidance.md.
  if (!cols.includes('user_reply')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN user_reply TEXT');
  }
  if (!cols.includes('reply_note')) {
    db.exec("ALTER TABLE opportunities ADD COLUMN reply_note TEXT DEFAULT ''");
  }
  if (!cols.includes('example_saved_at')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN example_saved_at TEXT');
  }
  // note_swept_at marks a reply_note as distilled into voice-guidance.md, so
  // the discovery pre-run sweep only touches genuinely new feedback. Editing
  // the note clears the stamp (it becomes unswept again).
  if (!cols.includes('note_swept_at')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN note_swept_at TEXT');
  }
  // Text read from the post's image/video by local OCR (read_image_text) at
  // collection time — a lossy hint kept for review context. Plugin-only:
  // deliberately not in the shared sync schema.
  if (!cols.includes('ocr_text')) {
    db.exec('ALTER TABLE opportunities ADD COLUMN ocr_text TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_opp_norm ON opportunities(normalized_url)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_opp_kind ON opportunities(kind)');

  // Per-brand+venue posting ledger — the "you haven't posted here in N days"
  // cadence source. Stamped when a recommendation is confirmed posted.
  db.exec(`
    CREATE TABLE IF NOT EXISTS venue_posts (
      brand_id    TEXT NOT NULL,
      venue_id    TEXT NOT NULL,
      last_posted TEXT,
      PRIMARY KEY (brand_id, venue_id)
    );
  `);

  // Performance ledger for posted replies (the Pro "track" pillar): one row per
  // check-in, so the dashboard can show growth over time, not just a snapshot.
  // Checks run from the user's own browser during discovery runs.
  db.exec(`
    CREATE TABLE IF NOT EXISTS reply_checks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      opp_id      TEXT NOT NULL,
      checked_at  TEXT NOT NULL,
      upvotes     INTEGER,
      reply_count INTEGER,
      note        TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_reply_checks_opp ON reply_checks(opp_id);
  `);

  // Content Strategy (Postiz-backed original posts): drafts composed locally,
  // optionally scheduled through the user's own Postiz account. Unlike
  // opportunities these are authored, not discovered — no seen-URL identity.
  // channels/settings/metrics are JSON blobs (integration ids, per-channel
  // settings like subreddit, latest analytics snapshot).
  db.exec(`
    CREATE TABLE IF NOT EXISTS content_items (
      id              TEXT PRIMARY KEY,
      brand_id        TEXT,
      brand_name      TEXT DEFAULT '',
      title           TEXT DEFAULT '',
      body            TEXT DEFAULT '',
      channels        TEXT DEFAULT '[]',
      settings        TEXT DEFAULT '{}',
      status          TEXT NOT NULL DEFAULT 'idea',
      scheduled_for   TEXT,
      postiz_post_id  TEXT,
      release_url     TEXT,
      venue_id        TEXT,
      metrics         TEXT DEFAULT '{}',
      media           TEXT DEFAULT '[]',
      source          TEXT NOT NULL DEFAULT 'user',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      sent_at         TEXT,
      published_at    TEXT,
      last_synced_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_content_status ON content_items(status);
    CREATE INDEX IF NOT EXISTS idx_content_brand ON content_items(brand_id);
  `);

  // Agent ingestion (added after first ship): local file attachments (JSON
  // array of absolute paths, uploaded to Postiz at schedule time) and which
  // producer created the item ('user' = dashboard/manual; agents pass their
  // own name, e.g. 'meme-agent').
  const contentCols = db.prepare('PRAGMA table_info(content_items)').all().map(c => c.name);
  if (!contentCols.includes('media')) {
    db.exec("ALTER TABLE content_items ADD COLUMN media TEXT DEFAULT '[]'");
  }
  if (!contentCols.includes('source')) {
    db.exec("ALTER TABLE content_items ADD COLUMN source TEXT NOT NULL DEFAULT 'user'");
  }

  // Directory submission (Pro): a registry of listing sites + per-brand
  // submission state. `directories` mixes seeded rows (source 'seed', from
  // data/directories.json via INSERT OR IGNORE — user edits survive re-seed)
  // with user-added ones ('user'). `signup` is how the site gates submissions
  // (NULL unknown | none | email | oauth | mixed), `oauth_providers` a JSON
  // list of the OAuth buttons seen, `test_status` what past runs learned
  // (NULL untested | works | needs_fix | blocked), and `notes` accumulates
  // learned form quirks so re-runs improve. Account passwords are deliberately
  // NOT here — they live in the 0600 credentials file (lib/credentials.js) so
  // no bridge query can ever serve them; email_used is just an address.
  db.exec(`
    CREATE TABLE IF NOT EXISTS directories (
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      url              TEXT NOT NULL,
      submit_url       TEXT DEFAULT '',
      signup           TEXT,
      oauth_providers  TEXT DEFAULT '[]',
      test_status      TEXT,
      notes            TEXT DEFAULT '',
      source           TEXT NOT NULL DEFAULT 'seed',
      created_at       TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id             TEXT PRIMARY KEY,
      brand_id       TEXT NOT NULL,
      brand_name     TEXT DEFAULT '',
      directory_id   TEXT,
      directory_url  TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'pending',
      email_used     TEXT DEFAULT '',
      listing_url    TEXT,
      log            TEXT DEFAULT '[]',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL,
      submitted_at   TEXT,
      verified_at    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_submissions_brand ON submissions(brand_id);
  `);

  // Registry model upgrade: the binary requires_account couldn't express
  // "OAuth only" vs "email signup", so it became signup + oauth_providers +
  // test_status. Old rows: requires_account 0 -> signup 'none'; 1/NULL -> NULL
  // (method unknown; the agent learns it on the next run).
  const dirCols = db.prepare('PRAGMA table_info(directories)').all().map(c => c.name);
  if (!dirCols.includes('signup')) {
    db.exec('ALTER TABLE directories ADD COLUMN signup TEXT');
    if (dirCols.includes('requires_account')) {
      db.exec("UPDATE directories SET signup = 'none' WHERE requires_account = 0");
    }
  }
  if (!dirCols.includes('oauth_providers')) {
    db.exec("ALTER TABLE directories ADD COLUMN oauth_providers TEXT DEFAULT '[]'");
  }
  if (!dirCols.includes('test_status')) {
    db.exec('ALTER TABLE directories ADD COLUMN test_status TEXT');
  }
  if (dirCols.includes('requires_account')) {
    db.exec('ALTER TABLE directories DROP COLUMN requires_account');
  }

  // Backfill normalized_url for pre-migration rows (normalizeUrl lives in JS).
  const missing = db
    .prepare('SELECT id, platform_url FROM opportunities WHERE normalized_url IS NULL')
    .all();
  if (missing.length) {
    const upd = db.prepare('UPDATE opportunities SET normalized_url = ? WHERE id = ?');
    const backfill = db.transaction(rows => {
      for (const r of rows) upd.run(normalizeUrl(r.platform_url), r.id);
    });
    backfill(missing);
  }
}

/* ---------- seen URLs ---------- */

export function isUrlSeen(url) {
  const db = getDb();
  const row = db.prepare('SELECT 1 FROM seen_urls WHERE normalized = ?').get(normalizeUrl(url));
  return !!row;
}

export function markUrlSeen(url, { platform = null, oppId = null } = {}) {
  const db = getDb();
  db.prepare(
    `INSERT INTO seen_urls (normalized, url, platform, opp_id, first_seen)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(normalized) DO NOTHING`
  ).run(normalizeUrl(url), url, platform, oppId, new Date().toISOString());
}

export function getRecentSeenUrls({ days = 90, limit = 500 } = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return db
    .prepare('SELECT url FROM seen_urls WHERE first_seen >= ? ORDER BY first_seen DESC LIMIT ?')
    .all(cutoff, limit)
    .map(r => r.url);
}

export function pruneOldUrls({ maxAgeDays = 90 } = {}) {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString();
  const info = db.prepare('DELETE FROM seen_urls WHERE first_seen < ?').run(cutoff);
  return info.changes;
}

/* ---------- opportunities ---------- */

export function addOpportunity(opp) {
  const db = getDb();
  const id = opp.id || randomUUID();
  db.prepare(
    `INSERT INTO opportunities
       (id, brand_id, brand_name, run_id, source, platform, platform_url, normalized_url,
        title, context, opportunity_type, relevance_score, relevance_reason, suggested_reply,
        suggested_action, status, screenshot_path, created_at, published_at, kind, venue_id, ocr_text)
     VALUES
       (@id, @brand_id, @brand_name, @run_id, @source, @platform, @platform_url, @normalized_url,
        @title, @context, @opportunity_type, @relevance_score, @relevance_reason, @suggested_reply,
        @suggested_action, @status, @screenshot_path, @created_at, @published_at, @kind, @venue_id, @ocr_text)`
  ).run({
    id,
    brand_id: opp.brandId ?? null,
    brand_name: opp.brandName ?? '',
    run_id: opp.runId ?? null,
    source: opp.source ?? 'plugin',
    platform: opp.platform,
    platform_url: opp.platformUrl,
    normalized_url: normalizeUrl(opp.platformUrl),
    title: opp.title ?? '',
    context: opp.context ?? '',
    opportunity_type: opp.opportunityType ?? 'general_comment',
    relevance_score: opp.relevanceScore ?? null,
    relevance_reason: opp.relevanceReason ?? '',
    suggested_reply: opp.suggestedReply ?? '',
    suggested_action: opp.suggestedAction ?? '',
    status: opp.status ?? 'new',
    screenshot_path: opp.screenshotPath ?? null,
    created_at: opp.createdAt ?? new Date().toISOString(),
    published_at: opp.publishedAt ?? null,
    kind: opp.kind ?? 'reply',
    venue_id: opp.venueId ?? null,
    ocr_text: opp.ocrText ?? null,
  });
  // Recommendation submit URLs (e.g. /r/SaaS/submit) aren't discovery targets,
  // so don't pollute the seen-URL dedupe set with them.
  if (!opp.skipSeen) markUrlSeen(opp.platformUrl, { platform: opp.platform, oppId: id });
  return id;
}

export function listOpportunities({ status = null, limit = 50 } = {}) {
  const db = getDb();
  if (status) {
    return db
      .prepare('SELECT * FROM opportunities WHERE status = ? ORDER BY created_at DESC LIMIT ?')
      .all(status, limit);
  }
  return db
    .prepare('SELECT * FROM opportunities ORDER BY created_at DESC LIMIT ?')
    .all(limit);
}

export function listOpportunitiesByRun(runId) {
  return getDb()
    .prepare('SELECT * FROM opportunities WHERE run_id = ? ORDER BY created_at DESC')
    .all(runId);
}

export function setOpportunityStatus(id, status) {
  const db = getDb();
  return db.prepare('UPDATE opportunities SET status = ? WHERE id = ?').run(status, id).changes;
}

/** Update the drafted reply (user edits it in the dashboard before posting). */
export function getOpportunityById(id) {
  return getDb().prepare('SELECT * FROM opportunities WHERE id = ?').get(id) ?? null;
}

/**
 * Partial update of the user's review fields. Only keys present in the patch
 * are written; userReply: null reverts to the original generated draft.
 * Writing replyNote clears note_swept_at (new/edited feedback is unswept);
 * noteSwept: true stamps it (the note has been distilled into voice guidance).
 */
export function updateOpportunityReview(id, { userReply, replyNote, noteSwept } = {}) {
  const sets = [];
  const args = [];
  if (userReply !== undefined) { sets.push('user_reply = ?'); args.push(userReply); }
  if (replyNote !== undefined) { sets.push('reply_note = ?'); args.push(replyNote); }
  if (noteSwept) {
    sets.push('note_swept_at = ?'); args.push(new Date().toISOString());
  } else if (replyNote !== undefined) {
    sets.push('note_swept_at = NULL');
  }
  if (!sets.length) return 0;
  return getDb()
    .prepare(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = ?`)
    .run(...args, id).changes;
}

/** Reply notes not yet distilled into voice-guidance.md (the pre-run sweep list). */
export function listUnsweptNotes() {
  return getDb()
    .prepare(`SELECT id, brand_id, platform, title, reply_note, suggested_reply, user_reply
              FROM opportunities
              WHERE reply_note != '' AND reply_note IS NOT NULL AND note_swept_at IS NULL
              ORDER BY created_at DESC`)
    .all();
}

/** Stamp that this opportunity's rewrite was promoted to a golden example. Returns the ISO stamp, or null if no such row. */
export function markExampleSaved(id) {
  const ts = new Date().toISOString();
  const n = getDb().prepare('UPDATE opportunities SET example_saved_at = ? WHERE id = ?').run(ts, id).changes;
  return n ? ts : null;
}

/** Stamp a post intent (assisted posting opened this in the browser). Returns the ISO stamp, or null if no such row. */
export function markPostIntent(id) {
  const ts = new Date().toISOString();
  const n = getDb().prepare('UPDATE opportunities SET posted_intent_at = ? WHERE id = ?').run(ts, id).changes;
  return n ? ts : null;
}

/* ---------- bridge / dashboard queries ---------- */

/** Canonical URL→opportunity lookup (dedupe identity across both sensors). */
export function findOpportunityByUrl(url) {
  return getDb()
    .prepare('SELECT * FROM opportunities WHERE normalized_url = ?')
    .get(normalizeUrl(url)) ?? null;
}

/** Filterable listing for the dashboard API. All filters optional. */
export function queryOpportunities({
  status = null,
  excludeStatuses = null,
  platform = null,
  brandId = null,
  source = null,
  kind = null,
  limit = 100,
  offset = 0,
} = {}) {
  const where = [];
  const args = [];
  if (status) { where.push('status = ?'); args.push(status); }
  if (excludeStatuses?.length) {
    where.push(`status NOT IN (${excludeStatuses.map(() => '?').join(', ')})`);
    args.push(...excludeStatuses);
  }
  if (platform) { where.push('platform = ?'); args.push(platform); }
  if (brandId) { where.push('brand_id = ?'); args.push(brandId); }
  if (source) { where.push('source = ?'); args.push(source); }
  if (kind) { where.push('kind = ?'); args.push(kind); }
  const sql = `SELECT * FROM opportunities
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  return getDb().prepare(sql).all(...args, limit, offset);
}

/* ---------- recommendations (places to post) ---------- */

/**
 * A blocking recommendation for a brand+venue: one that's still actionable
 * (not yet posted/skipped), or — when snoozeDays is set — one the user skipped
 * within that window (dismiss = snooze for one cadence, not "re-nudge next
 * refresh"). Used to keep generation idempotent.
 */
export function findOpenRecommendation(brandId, venueId, { snoozeDays = null } = {}) {
  const db = getDb();
  const open = db
    .prepare(
      `SELECT * FROM opportunities
       WHERE kind = 'recommendation' AND brand_id IS ? AND venue_id = ?
         AND status IN ('new', 'reviewed', 'approved')`
    )
    .get(brandId, venueId) ?? null;
  if (open || !snoozeDays) return open;
  const cutoff = new Date(Date.now() - snoozeDays * 86400000).toISOString();
  return db
    .prepare(
      `SELECT * FROM opportunities
       WHERE kind = 'recommendation' AND brand_id IS ? AND venue_id = ?
         AND status = 'skipped' AND created_at >= ?
       ORDER BY created_at DESC`
    )
    .get(brandId, venueId, cutoff) ?? null;
}

/** Stamp that this brand posted to this venue (the venue_posts ledger). */
export function recordVenuePost(brandId, venueId, ts = new Date().toISOString()) {
  getDb()
    .prepare(
      `INSERT INTO venue_posts (brand_id, venue_id, last_posted)
       VALUES (?, ?, ?)
       ON CONFLICT(brand_id, venue_id) DO UPDATE SET last_posted = excluded.last_posted`
    )
    .run(brandId, venueId, ts);
  return ts;
}

/**
 * A brand actually posted to a venue (a venue-linked content item went out via
 * Postiz, or the user confirmed a nudge): close the open recommendation and
 * stamp the cadence ledger. Idempotent — safe to fire from both the schedule
 * path and a later sync. Returns the closed recommendation id, or null.
 */
export function completeVenueRecommendation(brandId, venueId, ts = undefined) {
  const open = findOpenRecommendation(brandId, venueId);
  if (open) setOpportunityStatus(open.id, 'posted');
  recordVenuePost(brandId, venueId, ts);
  return open?.id ?? null;
}

/* ---------- reply performance (the Pro "track" pillar) ---------- */

/** Record a check-in on a posted reply's reception. */
export function recordReplyCheck(oppId, { upvotes = null, replyCount = null, note = '' } = {}) {
  getDb()
    .prepare(
      `INSERT INTO reply_checks (opp_id, checked_at, upvotes, reply_count, note)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(oppId, new Date().toISOString(), upvotes, replyCount, note);
}

/**
 * Posted replies due for a performance check-in: no check yet, or the latest
 * one is older than minHoursBetween. Recommendations are excluded — their
 * platform_url is a submit page, not the resulting post, so there's nothing to
 * revisit. Newest posts first: early reception is the interesting signal.
 */
export function listPerformanceDue({ limit = 10, minHoursBetween = 20 } = {}) {
  const cutoff = new Date(Date.now() - minHoursBetween * 3600000).toISOString();
  return getDb()
    .prepare(
      `SELECT o.id, o.platform, o.platform_url, o.title, o.brand_name, o.posted_intent_at
       FROM opportunities o
       LEFT JOIN (
         SELECT opp_id, MAX(checked_at) AS last_checked FROM reply_checks GROUP BY opp_id
       ) rc ON rc.opp_id = o.id
       WHERE o.kind = 'reply' AND o.status = 'posted'
         AND (rc.last_checked IS NULL OR rc.last_checked < ?)
       ORDER BY COALESCE(o.posted_intent_at, o.created_at) DESC
       LIMIT ?`
    )
    .all(cutoff, limit);
}

/**
 * Every posted reply with its first and latest check (for deltas) — decorates
 * the dashboard's Submitted tab (Pro). One row per opportunity.
 */
export function performanceSummary() {
  return getDb()
    .prepare(
      `SELECT o.id, o.platform, o.platform_url, o.title, o.brand_name,
              COALESCE(o.posted_intent_at, o.created_at) AS posted_at,
              first.upvotes AS first_upvotes, first.reply_count AS first_replies,
              last.upvotes AS upvotes, last.reply_count AS replies,
              last.checked_at AS checked_at, last.note AS note,
              (SELECT COUNT(*) FROM reply_checks WHERE opp_id = o.id) AS checks
       FROM opportunities o
       LEFT JOIN reply_checks first
         ON first.id = (SELECT id FROM reply_checks WHERE opp_id = o.id ORDER BY checked_at ASC LIMIT 1)
       LEFT JOIN reply_checks last
         ON last.id = (SELECT id FROM reply_checks WHERE opp_id = o.id ORDER BY checked_at DESC LIMIT 1)
       WHERE o.kind = 'reply' AND o.status = 'posted'
       ORDER BY posted_at DESC`
    )
    .all();
}

/** Counts for the sidebar badges. */
/**
 * Bulk "clear the queue": skip every reply that isn't already posted or
 * skipped. Posted rows are history (the Submitted tab + performance tracking
 * hang off them), so they never get swept. Returns the number of rows skipped.
 */
export function skipAllReplies() {
  return getDb()
    .prepare(
      `UPDATE opportunities SET status = 'skipped'
       WHERE kind = 'reply' AND status NOT IN ('posted', 'skipped')`
    )
    .run().changes;
}

export function opportunityCounts() {
  const db = getDb();
  const one = sql => db.prepare(sql).get().n;
  return {
    // Matches the Opportunities queue view: every reply still in play.
    opportunities: one("SELECT COUNT(*) n FROM opportunities WHERE kind = 'reply' AND status NOT IN ('posted', 'skipped')"),
    submitted: one("SELECT COUNT(*) n FROM opportunities WHERE status = 'posted'"),
    // Content Strategy's badge: real working drafts (user/agent/CLI), nothing else.
    content: one("SELECT COUNT(*) n FROM content_items WHERE status IN ('idea', 'draft')"),
  };
}

/** SQLite's cheap cross-connection change counter — the dashboard's poll target. */
export function getDataVersion() {
  return getDb().pragma('data_version', { simple: true });
}

/**
 * Merge an extension-pushed opportunity (canonical field names, status already
 * mapped to canonical vocab). First-wins: if any opportunity already exists for
 * the normalized URL, nothing is inserted or overwritten.
 * @returns {{ id: string, status: string, merged: boolean }}
 */
export function upsertExtensionOpportunity(opp) {
  const existing = findOpportunityByUrl(opp.platformUrl);
  if (existing) return { id: existing.id, status: existing.status, merged: true };
  const id = addOpportunity({ ...opp, source: 'extension' });
  return { id, status: opp.status ?? 'new', merged: false };
}

/* ---------- content items (Content Strategy — original posts) ---------- */

export const CONTENT_STATUSES = ['idea', 'draft', 'scheduled', 'published', 'failed'];

/** Statuses that still track a live Postiz post (worth re-syncing). */
const CONTENT_PENDING_SYNC = ['draft', 'scheduled'];

export function addContentItem(item) {
  const db = getDb();
  const id = item.id || randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO content_items
       (id, brand_id, brand_name, title, body, channels, settings, status,
        scheduled_for, venue_id, media, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    item.brandId ?? null,
    item.brandName ?? '',
    item.title ?? '',
    item.body ?? '',
    JSON.stringify(item.channels ?? []),
    JSON.stringify(item.settings ?? {}),
    CONTENT_STATUSES.includes(item.status) ? item.status : 'idea',
    item.scheduledFor ?? null,
    item.venueId ?? null,
    JSON.stringify(item.media ?? []),
    item.source ?? 'user',
    now,
    now
  );
  return id;
}

/**
 * An unsent content draft already linked to this brand+venue — "Draft post" on
 * a checklist nudge reopens it instead of creating a duplicate.
 */
export function getContentItemById(id) {
  return getDb().prepare('SELECT * FROM content_items WHERE id = ?').get(id) ?? null;
}

export function queryContentItems({ brandId = null, status = null, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (brandId) { where.push('brand_id = ?'); args.push(brandId); }
  if (status) { where.push('status = ?'); args.push(status); }
  const sql = `SELECT * FROM content_items
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY COALESCE(scheduled_for, created_at) DESC LIMIT ? OFFSET ?`;
  return getDb().prepare(sql).all(...args, limit, offset);
}

/** Partial update; only keys present in the patch are written. */
export function updateContentItem(
  id,
  { brandId, brandName, title, body, channels, settings, status, scheduledFor, venueId, media } = {}
) {
  const sets = ['updated_at = ?'];
  const args = [new Date().toISOString()];
  if (brandId !== undefined) { sets.push('brand_id = ?'); args.push(brandId); }
  if (brandName !== undefined) { sets.push('brand_name = ?'); args.push(brandName); }
  if (title !== undefined) { sets.push('title = ?'); args.push(title); }
  if (body !== undefined) { sets.push('body = ?'); args.push(body); }
  if (channels !== undefined) { sets.push('channels = ?'); args.push(JSON.stringify(channels)); }
  if (settings !== undefined) { sets.push('settings = ?'); args.push(JSON.stringify(settings)); }
  if (status !== undefined) { sets.push('status = ?'); args.push(status); }
  if (scheduledFor !== undefined) { sets.push('scheduled_for = ?'); args.push(scheduledFor); }
  if (venueId !== undefined) { sets.push('venue_id = ?'); args.push(venueId); }
  if (media !== undefined) { sets.push('media = ?'); args.push(JSON.stringify(media)); }
  return getDb()
    .prepare(`UPDATE content_items SET ${sets.join(', ')} WHERE id = ?`)
    .run(...args, id).changes;
}

export function deleteContentItem(id) {
  return getDb().prepare('DELETE FROM content_items WHERE id = ?').run(id).changes;
}

/** Stamp a successful hand-off to Postiz. `now` publishes immediately. */
export function markContentSent(id, { postizPostId, scheduledFor = null, published = false } = {}) {
  const ts = new Date().toISOString();
  return getDb()
    .prepare(
      `UPDATE content_items
       SET postiz_post_id = ?, status = ?, scheduled_for = COALESCE(?, scheduled_for),
           sent_at = ?, updated_at = ?, published_at = CASE WHEN ? THEN ? ELSE published_at END
       WHERE id = ?`
    )
    .run(postizPostId ?? null, published ? 'published' : 'scheduled', scheduledFor, ts, ts, published ? 1 : 0, ts, id)
    .changes;
}

/** Apply state pulled back from Postiz (status/release/analytics). */
export function applyContentSync(id, { status, releaseUrl, publishedAt, metrics } = {}) {
  const ts = new Date().toISOString();
  const sets = ['last_synced_at = ?', 'updated_at = ?'];
  const args = [ts, ts];
  if (status !== undefined && CONTENT_STATUSES.includes(status)) { sets.push('status = ?'); args.push(status); }
  if (releaseUrl !== undefined) { sets.push('release_url = ?'); args.push(releaseUrl); }
  if (publishedAt !== undefined) { sets.push('published_at = ?'); args.push(publishedAt); }
  if (metrics !== undefined) { sets.push('metrics = ?'); args.push(JSON.stringify(metrics)); }
  return getDb()
    .prepare(`UPDATE content_items SET ${sets.join(', ')} WHERE id = ?`)
    .run(...args, id).changes;
}

/** Items handed to Postiz whose state is still worth refreshing. */
export function listContentPendingSync({ limit = 50 } = {}) {
  return getDb()
    .prepare(
      `SELECT * FROM content_items
       WHERE postiz_post_id IS NOT NULL AND status IN (${CONTENT_PENDING_SYNC.map(() => '?').join(', ')})
       ORDER BY COALESCE(scheduled_for, created_at) ASC LIMIT ?`
    )
    .all(...CONTENT_PENDING_SYNC, limit);
}

/* ---------- directory submissions (Pro "submit anywhere" pillar) ---------- */

export const SUBMISSION_STATUSES = [
  'pending', 'account_created', 'awaiting_verification',
  'submitted', 'live', 'failed', 'skipped',
];

/** Statuses that still count as an attempt in flight (dupe-guard set). */
const SUBMISSION_ACTIVE = ['pending', 'account_created', 'awaiting_verification', 'submitted', 'live'];

export const DIRECTORY_SIGNUPS = ['none', 'email', 'oauth', 'mixed'];
export const DIRECTORY_TEST_STATUSES = ['works', 'needs_fix', 'blocked'];

/** Seed ids that were merged into another entry (deleted on seed if unused). */
const RETIRED_SEED_IDS = ['betapage']; // -> pitchwall (betapage.co redirects there)

const providersJson = (list) => JSON.stringify(Array.isArray(list) ? list.map(String) : []);

/**
 * Idempotent registry load; user-added rows and user edits always survive.
 * New rows are inserted; existing seed-sourced rows only get their
 * still-empty fields (signup, oauth_providers, test_status, submit_url)
 * backfilled from the seed — never notes (the agent appends learned quirks
 * there) and never a value the user or agent already set.
 */
export function seedDirectories(list = []) {
  const db = getDb();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO directories
       (id, name, url, submit_url, signup, oauth_providers, test_status, notes, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'seed', ?)`
  );
  const backfill = db.prepare(
    `UPDATE directories SET
       signup          = COALESCE(signup, ?),
       oauth_providers = CASE WHEN oauth_providers IS NULL OR oauth_providers = '[]' THEN ? ELSE oauth_providers END,
       test_status     = COALESCE(test_status, ?),
       submit_url      = CASE WHEN submit_url IS NULL OR submit_url = '' THEN ? ELSE submit_url END
     WHERE id = ? AND source = 'seed'`
  );
  const retire = db.prepare(
    `DELETE FROM directories WHERE id = ? AND source = 'seed'
       AND NOT EXISTS (SELECT 1 FROM submissions WHERE directory_id = ?)`
  );
  const now = new Date().toISOString();
  let added = 0;
  const tx = db.transaction(rows => {
    for (const d of rows) {
      const signup = d.signup ?? null;
      const providers = providersJson(d.oauthProviders);
      const testStatus = d.testStatus ?? null;
      const changes = ins.run(
        d.id, d.name, d.url, d.submitUrl ?? '', signup, providers, testStatus, d.notes ?? '', now
      ).changes;
      added += changes;
      if (!changes) backfill.run(signup, providers, testStatus, d.submitUrl ?? '', d.id);
    }
    for (const id of RETIRED_SEED_IDS) retire.run(id, id);
  });
  tx(list);
  return added;
}

export function listDirectories() {
  return getDb().prepare('SELECT * FROM directories ORDER BY name COLLATE NOCASE').all();
}

export function getDirectoryById(id) {
  return getDb().prepare('SELECT * FROM directories WHERE id = ?').get(id) ?? null;
}

export function addDirectory({
  id, name, url, submitUrl = '', signup = null, oauthProviders = [], testStatus = null,
  notes = '', source = 'user',
}) {
  getDb().prepare(
    `INSERT INTO directories
       (id, name, url, submit_url, signup, oauth_providers, test_status, notes, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, url, submitUrl, signup, providersJson(oauthProviders), testStatus,
    notes, source, new Date().toISOString());
  return id;
}

/**
 * Partial update (learned quirks, submit_url discovery, signup method).
 * Throws on an invalid signup / testStatus value.
 */
export function updateDirectory(id, { name, submitUrl, signup, oauthProviders, testStatus, notes } = {}) {
  const sets = [];
  const args = [];
  if (name !== undefined) { sets.push('name = ?'); args.push(name); }
  if (submitUrl !== undefined) { sets.push('submit_url = ?'); args.push(submitUrl); }
  if (signup !== undefined) {
    if (signup !== null && !DIRECTORY_SIGNUPS.includes(signup)) {
      throw new Error(`invalid signup: ${signup} (use ${DIRECTORY_SIGNUPS.join('|')} or null)`);
    }
    sets.push('signup = ?'); args.push(signup);
  }
  if (oauthProviders !== undefined) { sets.push('oauth_providers = ?'); args.push(providersJson(oauthProviders)); }
  if (testStatus !== undefined) {
    if (testStatus !== null && !DIRECTORY_TEST_STATUSES.includes(testStatus)) {
      throw new Error(`invalid testStatus: ${testStatus} (use ${DIRECTORY_TEST_STATUSES.join('|')} or null)`);
    }
    sets.push('test_status = ?'); args.push(testStatus);
  }
  if (notes !== undefined) { sets.push('notes = ?'); args.push(notes); }
  if (!sets.length) return 0;
  return getDb().prepare(`UPDATE directories SET ${sets.join(', ')} WHERE id = ?`).run(...args, id).changes;
}

/** Parse a directory row's oauth_providers JSON safely. */
export function directoryProviders(row) {
  try {
    const v = JSON.parse(row?.oauth_providers || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch { return []; }
}

/**
 * An attempt already in flight (or completed) for this brand+directory —
 * `submission start` refuses a duplicate so re-runs resume instead of
 * re-registering. failed/skipped rows don't block a retry.
 */
export function findActiveSubmission(brandId, directoryId) {
  return getDb()
    .prepare(
      `SELECT * FROM submissions
       WHERE brand_id = ? AND directory_id = ?
         AND status IN (${SUBMISSION_ACTIVE.map(() => '?').join(', ')})
       ORDER BY created_at DESC`
    )
    .get(brandId, directoryId, ...SUBMISSION_ACTIVE) ?? null;
}

export function createSubmission({ brandId, brandName = '', directoryId = null, directoryUrl }) {
  const db = getDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO submissions (id, brand_id, brand_name, directory_id, directory_url, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).run(id, brandId, brandName, directoryId, directoryUrl, now, now);
  return id;
}

export function getSubmissionById(id) {
  return getDb().prepare('SELECT * FROM submissions WHERE id = ?').get(id) ?? null;
}

/** Partial update; status changes stamp submitted_at / verified_at once. */
export function updateSubmission(id, { status, emailUsed, listingUrl } = {}) {
  const sets = ['updated_at = ?'];
  const args = [new Date().toISOString()];
  if (status !== undefined) {
    if (!SUBMISSION_STATUSES.includes(status)) throw new Error(`invalid submission status: ${status}`);
    sets.push('status = ?'); args.push(status);
    if (status === 'submitted') { sets.push('submitted_at = COALESCE(submitted_at, ?)'); args.push(new Date().toISOString()); }
    if (status === 'live') { sets.push('verified_at = COALESCE(verified_at, ?)'); args.push(new Date().toISOString()); }
  }
  if (emailUsed !== undefined) { sets.push('email_used = ?'); args.push(emailUsed); }
  if (listingUrl !== undefined) { sets.push('listing_url = ?'); args.push(listingUrl); }
  return getDb().prepare(`UPDATE submissions SET ${sets.join(', ')} WHERE id = ?`).run(...args, id).changes;
}

/** Append a timestamped step to the submission's JSON log. */
export function appendSubmissionLog(id, msg) {
  const row = getSubmissionById(id);
  if (!row) return 0;
  const log = JSON.parse(row.log || '[]');
  log.push({ at: new Date().toISOString(), msg: String(msg) });
  return getDb()
    .prepare('UPDATE submissions SET log = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(log), new Date().toISOString(), id).changes;
}

export function querySubmissions({ brandId = null, status = null, limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (brandId) { where.push('brand_id = ?'); args.push(brandId); }
  if (status) { where.push('status = ?'); args.push(status); }
  const sql = `SELECT * FROM submissions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  return getDb().prepare(sql).all(...args, limit, offset);
}

/* ---------- runs ---------- */

export function createRun({ platforms = [] } = {}) {
  const db = getDb();
  const id = randomUUID();
  db.prepare('INSERT INTO runs (id, started_at, platforms, status) VALUES (?, ?, ?, ?)').run(
    id,
    new Date().toISOString(),
    JSON.stringify(platforms),
    'running'
  );
  return id;
}

export function finishRun(id, { status = 'done', summary = '' } = {}) {
  const db = getDb();
  return db
    .prepare('UPDATE runs SET finished_at = ?, status = ?, summary = ? WHERE id = ?')
    .run(new Date().toISOString(), status, summary, id).changes;
}

export function listRuns({ limit = 20 } = {}) {
  return getDb().prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit);
}
