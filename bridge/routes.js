/**
 * Bridge API routes. All /api/* endpoints except /api/health require the
 * pairing token (Authorization: Bearer). JSON in/out, camelCase keys.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../lib/db.js';
import * as cfg from '../lib/config.js';
import { runsDir } from '../lib/paths.js';
import { checkToken } from './auth.js';
import { CANONICAL_STATUSES } from './status-map.js';
import { bumpWrites, changeToken } from './changes.js';
import { parseLicense, licenseInfo, isPro } from '../lib/license.js';
import { refreshLicense } from '../lib/license-refresh.js';
import { appendExample } from '../lib/guidance.js';
import { handleContentApi } from './content-routes.js';
import { handlePostApi, directorySettings } from './post-routes.js';
import { postizEnabled } from '../lib/postiz-client.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** SQLite snake_case row -> API camelCase opportunity. */
export function rowToOpportunity(r) {
  return {
    id: r.id,
    brandId: r.brand_id,
    brandName: r.brand_name ?? '',
    runId: r.run_id,
    source: r.source,
    platform: r.platform,
    platformUrl: r.platform_url,
    title: r.title,
    context: r.context,
    opportunityType: r.opportunity_type,
    relevanceScore: r.relevance_score,
    relevanceReason: r.relevance_reason,
    suggestedReply: r.suggested_reply,
    suggestedAction: r.suggested_action,
    userReply: r.user_reply ?? null,
    replyNote: r.reply_note ?? '',
    exampleSavedAt: r.example_saved_at ?? null,
    status: r.status,
    screenshotPath: r.screenshot_path,
    createdAt: r.created_at,
    publishedAt: r.published_at ?? null,
    postedIntentAt: r.posted_intent_at ?? null,
    kind: r.kind ?? 'reply',
    venueId: r.venue_id ?? null,
    ocrText: r.ocr_text ?? null,
  };
}

function rowToRun(r) {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    platforms: r.platforms ? JSON.parse(r.platforms) : [],
    status: r.status,
    summary: r.summary,
  };
}

/**
 * Handle an /api/* request. Returns true if the route matched.
 * ctx: { token, version, syncHandler? }
 */
export async function handleApi(req, res, ctx) {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const method = req.method ?? 'GET';

  // Preflight belt-and-braces: MV3 permission-granted fetches shouldn't preflight,
  // but answer harmlessly (no CORS allow headers — loopback same-origin only).
  if (method === 'OPTIONS') {
    res.writeHead(204, { allow: 'GET, PATCH, POST, DELETE, OPTIONS' });
    res.end();
    return true;
  }

  if (p === '/api/health' && method === 'GET') {
    json(res, 200, { ok: true, app: 'socialcue-bridge', version: ctx.version });
    return true;
  }

  if (!p.startsWith('/api/')) return false;

  if (!checkToken(req, ctx.token)) {
    json(res, 401, { error: 'unauthorized' });
    return true;
  }

  if (p === '/api/changes' && method === 'GET') {
    json(res, 200, {
      dataVersion: changeToken(db.getDataVersion()),
      counts: db.opportunityCounts(),
    });
    return true;
  }

  if (p === '/api/opportunities' && method === 'GET') {
    const q = url.searchParams;
    // notStatus: comma-separated statuses to exclude (the dashboard queue asks
    // for everything except skipped/posted). Unknown values are ignored.
    const excludeStatuses = (q.get('notStatus') || '')
      .split(',')
      .map(s => s.trim())
      .filter(s => CANONICAL_STATUSES.includes(s));
    const rows = db.queryOpportunities({
      status: q.get('status') || null,
      excludeStatuses,
      platform: q.get('platform') || null,
      brandId: q.get('brand') || null,
      source: q.get('source') || null,
      kind: q.get('kind') || null,
      limit: Math.min(Number(q.get('limit')) || 100, 500),
      offset: Number(q.get('offset')) || 0,
    });
    json(res, 200, { opportunities: rows.map(rowToOpportunity) });
    return true;
  }

  // Bulk "clear the queue": skip every reply that isn't posted/skipped yet.
  // Posted rows are untouched — they're the Submitted tab's history.
  if (p === '/api/opportunities/clear' && method === 'POST') {
    const skipped = db.skipAllReplies();
    if (skipped) bumpWrites();
    json(res, 200, { skipped });
    return true;
  }

  // Stream an opportunity's captured screenshot as an image. Served by
  // opportunity id (not raw path) and hard-guarded to the runs dir so a tampered
  // DB can't turn this into an arbitrary-file read. The dashboard fetches it with
  // the Bearer token in the header (never the URL) and shows it via a blob URL.
  const shotMatch = p.match(/^\/api\/opportunities\/([^/]+)\/screenshot$/);
  if (shotMatch && method === 'GET') {
    const id = decodeURIComponent(shotMatch[1]);
    const row = db.getOpportunityById(id);
    const file = row?.screenshot_path ? path.resolve(row.screenshot_path) : null;
    const root = path.resolve(runsDir());
    const inRoot = file && (file === root || file.startsWith(root + path.sep));
    if (!inRoot || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      json(res, 404, { error: 'no screenshot' });
      return true;
    }
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  // Assisted posting (Pro): open + pre-fill in the dedicated browser. Pass
  // { submit: true } to have the submit control clicked too — per-request
  // opt-in; the default is pre-fill only and the user submits themselves.
  const postMatch = p.match(/^\/api\/opportunities\/([^/]+)\/post$/);
  if (postMatch && method === 'POST') {
    const config = cfg.loadConfig();
    if (!isPro(config)) {
      json(res, 403, { error: 'pro_required' });
      return true;
    }
    const id = decodeURIComponent(postMatch[1]);
    const row = db.getOpportunityById(id);
    if (!row) {
      json(res, 404, { error: `no opportunity ${id}` });
      return true;
    }
    let submit = false;
    try {
      const raw = await readBody(req);
      if (raw) submit = !!JSON.parse(raw)?.submit;
    } catch {
      /* no/invalid body → pre-fill only */
    }
    // Venue recommendations open a full submission form (title/url/…), not a
    // reply box — never auto-click those; they stay pre-fill + manual submit.
    if (row.kind === 'recommendation') submit = false;
    // Dry Run Posts (Settings): never click submit — pre-fill only. A submit
    // request under dry run still counts as "the user is posting this": the row
    // is marked posted below and they click the platform's button themselves.
    const dryRun = config.dryRunPosts === true && submit;
    if (dryRun) submit = false;
    console.log(
      new Date().toISOString(),
      '[post-intent]',
      `request id=${id} platform=${row.platform} kind=${row.kind} submit=${submit} dryRun=${dryRun}`
    );
    let result;
    try {
      // Lazy import: patchright only ever loads when a post intent fires.
      const { executePostIntent } = await import('./post-intent.js');
      result = await executePostIntent(
        // Pre-fill the user's own rewrite when they've made one.
        { platformUrl: row.platform_url, suggestedReply: row.user_reply || row.suggested_reply },
        config,
        { submit }
      );
    } catch (err) {
      console.log(new Date().toISOString(), '[post-intent]', 'connection FAILED:', err?.stack ?? err);
      json(res, 502, { error: 'browser_unreachable', message: String(err?.message ?? err) });
      return true;
    }
    const postedIntentAt = db.markPostIntent(id);
    // A post intent is an explicit approval; never regress user-set end states.
    // Under dry run, a successful pre-fill counts as posted (the user clicks
    // submit themselves in the browser); a failed pre-fill stays approved.
    let status = row.status;
    if (result.submitted || (dryRun && result.prefilled)) {
      db.setOpportunityStatus(id, 'posted');
      status = 'posted';
    } else if (status === 'new' || status === 'reviewed') {
      db.setOpportunityStatus(id, 'approved');
      status = 'approved';
    }
    bumpWrites();
    const message = dryRun && result.prefilled
      ? `${result.message} Dry run: submit was not clicked — marked posted, finish in the browser.`
      : result.message;
    json(res, 200, { id, ...result, message, status, postedIntentAt });
    return true;
  }

  // Review updates: any of { status, userReply, replyNote }. Review fields are
  // free (the queue UI is the free tier); userReply: null reverts to the
  // generated draft. suggested_reply itself is never writable here.
  const patchMatch = p.match(/^\/api\/opportunities\/([^/]+)$/);
  if (patchMatch && method === 'PATCH') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    const id = decodeURIComponent(patchMatch[1]);
    const status = body?.status;
    const hasStatus = status !== undefined;
    const hasReview = body?.userReply !== undefined || body?.replyNote !== undefined;
    if (!hasStatus && !hasReview) {
      json(res, 400, { error: 'nothing to update — pass status, userReply and/or replyNote' });
      return true;
    }
    if (hasStatus && !CANONICAL_STATUSES.includes(status)) {
      json(res, 400, { error: `status must be one of: ${CANONICAL_STATUSES.join(', ')}` });
      return true;
    }
    const row = db.getOpportunityById(id);
    if (!row) {
      json(res, 404, { error: `no opportunity ${id}` });
      return true;
    }
    if (hasReview) {
      db.updateOpportunityReview(id, { userReply: body.userReply, replyNote: body.replyNote });
    }
    if (hasStatus) {
      db.setOpportunityStatus(id, status);
      // Confirming a recommendation as posted stamps the venue cadence so the
      // nudge stays quiet until it's due again.
      if (status === 'posted' && row.kind === 'recommendation' && row.venue_id && row.brand_id) {
        db.recordVenuePost(row.brand_id, row.venue_id);
      }
    }
    bumpWrites();
    json(res, 200, rowToOpportunity(db.getOpportunityById(id)));
    return true;
  }

  // Promote the user's rewrite into a voice-guidance golden example.
  const exampleMatch = p.match(/^\/api\/opportunities\/([^/]+)\/save-example$/);
  if (exampleMatch && method === 'POST') {
    let body = {};
    try {
      const raw = await readBody(req);
      if (raw.trim()) body = JSON.parse(raw);
    } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    const id = decodeURIComponent(exampleMatch[1]);
    const row = db.getOpportunityById(id);
    if (!row) {
      json(res, 404, { error: `no opportunity ${id}` });
      return true;
    }
    const after = (row.user_reply ?? '').trim();
    if (!after || after === (row.suggested_reply ?? '').trim()) {
      json(res, 400, { error: 'nothing_to_save', message: 'edit the draft first — an example is your rewrite vs the original' });
      return true;
    }
    const { examples } = appendExample({
      brandName: row.brand_name ?? '',
      platform: row.platform,
      before: row.suggested_reply ?? '',
      after,
      why: typeof body?.why === 'string' ? body.why : '',
    });
    const exampleSavedAt = db.markExampleSaved(id);
    bumpWrites();
    json(res, 200, { id, exampleSavedAt, examples });
    return true;
  }

  // Reply performance (Pro): every posted reply with first/latest check-in.
  // Checks are recorded during discovery runs (record_performance MCP tool).
  if (p === '/api/performance' && method === 'GET') {
    if (!isPro(cfg.loadConfig())) {
      json(res, 403, { error: 'pro_required' });
      return true;
    }
    const rows = db.performanceSummary().map(r => ({
      id: r.id,
      platform: r.platform,
      platformUrl: r.platform_url,
      title: r.title,
      brandName: r.brand_name ?? '',
      postedAt: r.posted_at,
      firstUpvotes: r.first_upvotes,
      firstReplies: r.first_replies,
      upvotes: r.upvotes,
      replies: r.replies,
      checkedAt: r.checked_at,
      note: r.note ?? '',
      checks: r.checks,
    }));
    json(res, 200, { performance: rows });
    return true;
  }

  if (p === '/api/runs' && method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 20, 100);
    json(res, 200, { runs: db.listRuns({ limit }).map(rowToRun) });
    return true;
  }

  if (p === '/api/brands' && method === 'GET') {
    json(res, 200, { brands: cfg.loadConfig().brands });
    return true;
  }

  // Edit one brand's profile in place (Settings tab): whitelisted fields only,
  // re-validated via BrandSchema in cfg.updateBrand. Add/remove stays with
  // /socialcue-setup and the CLI (new brands get the guided profile draft).
  const brandPatch = p.match(/^\/api\/brands\/([^/]+)$/);
  if (brandPatch && method === 'PATCH') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    const id = decodeURIComponent(brandPatch[1]);
    let brand;
    try {
      brand = cfg.updateBrand(id, body ?? {});
    } catch (err) {
      const detail = Array.isArray(err.issues)
        ? err.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')
        : err.message;
      json(res, 400, { error: `brand rejected: ${detail}` });
      return true;
    }
    if (!brand) {
      json(res, 404, { error: `no brand ${id}` });
      return true;
    }
    bumpWrites();
    json(res, 200, { brand });
    return true;
  }

  // What a discovery run will use — so users can see which brands + platforms
  // are active without opening config.json. Whitelisted fields only: never
  // expose the pairing token, license, or account token. The run knobs are
  // editable via PATCH /api/settings/run; brands via PATCH /api/brands/:id.
  if (p === '/api/settings' && method === 'GET') {
    const c = cfg.loadConfig();
    json(res, 200, {
      brands: (c.brands ?? []).map(b => ({
        id: b.id,
        name: b.name,
        url: b.url ?? '',
        tagline: b.tagline ?? '',
        shortDescription: b.shortDescription ?? '',
        aboutBrand: b.aboutBrand ?? '',
        tags: b.tags ?? [],
        projectPath: b.projectPath ?? '',
        isActive: b.isActive !== false,
      })),
      platforms: c.platforms ?? [],
      strategyWeights: c.strategyWeights ?? {},
      engagementRatio: c.engagementRatio ?? null,
      maxTurnsPerPlatform: c.maxTurnsPerPlatform ?? null,
      dryRunPosts: c.dryRunPosts === true,
      cdpUrl: c.browser?.cdpUrl ?? '',
      // Connection state only — the Postiz API key joins the never-expose list
      // (pairing token, license, account token).
      postiz: {
        connected: postizEnabled(c),
        apiUrl: c.postiz?.apiUrl ?? '',
        channelMap: c.postiz?.channelMap ?? {},
      },
      // Directory-signup email (an address, not a secret) + its webmail URL.
      directories: directorySettings(c),
    });
    return true;
  }

  // Editable run config (Settings tab). Whitelisted discovery knobs only —
  // everything else in config.json (brands, browser, tokens, Postiz key) keeps
  // its existing CLI/endpoint paths. saveConfig re-validates via ConfigSchema.
  // Maintainer-only free-tier preview (see lib/license.js isPreviewingFree).
  if (p === '/api/settings/dev' && method === 'PATCH') {
    const c = cfg.loadConfig();
    if (!c.venues?.adminKey) { json(res, 403, { error: 'maintainer_only' }); return true; }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    if (typeof body?.previewFree !== 'boolean') { json(res, 400, { error: 'previewFree must be a boolean' }); return true; }
    c.devPreviewFree = body.previewFree;
    cfg.saveConfig(c);
    bumpWrites();
    json(res, 200, licenseInfo(c));
    return true;
  }

  if (p === '/api/settings/run' && method === 'PATCH') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    const errors = [];
    const patch = {};
    if (body?.platforms !== undefined) {
      const list = Array.isArray(body.platforms)
        ? [...new Set(body.platforms.map(s => String(s).trim().toLowerCase()).filter(Boolean))]
        : null;
      if (!list || !list.length || list.length > 20) errors.push('platforms must be a non-empty array of platform keys');
      else patch.platforms = list;
    }
    if (body?.strategyWeights !== undefined) {
      const w = body.strategyWeights ?? {};
      const vals = ['search', 'feed', 'trending'].map(k => Number(w[k]));
      if (vals.some(v => !Number.isFinite(v) || v < 0 || v > 100)) {
        errors.push('strategyWeights.search/feed/trending must each be 0-100');
      } else if (Math.round(vals[0] + vals[1] + vals[2]) !== 100) {
        errors.push('strategyWeights must sum to 100');
      } else {
        patch.strategyWeights = { search: Math.round(vals[0]), feed: Math.round(vals[1]), trending: Math.round(vals[2]) };
      }
    }
    if (body?.engagementRatio !== undefined) {
      const r = Number(body.engagementRatio);
      if (!Number.isFinite(r) || r < 0 || r > 1) errors.push('engagementRatio must be between 0 and 1');
      else patch.engagementRatio = Math.round(r * 100) / 100;
    }
    if (body?.maxTurnsPerPlatform !== undefined) {
      const n = Number(body.maxTurnsPerPlatform);
      if (!Number.isInteger(n) || n < 1 || n > 500) errors.push('maxTurnsPerPlatform must be an integer between 1 and 500');
      else patch.maxTurnsPerPlatform = n;
    }
    if (body?.dryRunPosts !== undefined) {
      if (typeof body.dryRunPosts !== 'boolean') errors.push('dryRunPosts must be a boolean');
      else patch.dryRunPosts = body.dryRunPosts;
    }
    if (errors.length) {
      json(res, 400, { error: errors.join('; ') });
      return true;
    }
    if (!Object.keys(patch).length) {
      json(res, 400, { error: 'nothing to update — pass platforms, strategyWeights, engagementRatio, maxTurnsPerPlatform and/or dryRunPosts' });
      return true;
    }
    let saved;
    try {
      saved = cfg.saveConfig({ ...cfg.loadConfig(), ...patch });
    } catch (err) {
      json(res, 400, { error: `config rejected: ${err.message}` });
      return true;
    }
    bumpWrites();
    json(res, 200, {
      platforms: saved.platforms,
      strategyWeights: saved.strategyWeights,
      engagementRatio: saved.engagementRatio,
      maxTurnsPerPlatform: saved.maxTurnsPerPlatform,
      dryRunPosts: saved.dryRunPosts === true,
    });
    return true;
  }

  if (p === '/api/license' && method === 'GET') {
    json(res, 200, licenseInfo(cfg.loadConfig()));
    return true;
  }

  if (p === '/api/license' && method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    const parsed = parseLicense(body?.key ?? '');
    if (!parsed.valid) {
      json(res, 400, { error: `invalid license key: ${parsed.error}` });
      return true;
    }
    const config = cfg.loadConfig();
    config.license = body.key;
    cfg.saveConfig(config);
    bumpWrites();
    json(res, 200, { pro: true, email: parsed.payload.email, issued: parsed.payload.issued });
    return true;
  }

  // Connect a Pro account token (scacct_…) and immediately fetch a fresh key.
  if (p === '/api/license/connect' && method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    const token = String(body?.token ?? '').trim();
    if (!token) {
      json(res, 400, { error: 'account token required' });
      return true;
    }
    const config = cfg.loadConfig();
    config.licenseAccountToken = token;
    if (body?.server) config.licenseServerUrl = String(body.server).replace(/\/+$/, '');
    cfg.saveConfig(config);
    const r = await refreshLicense({ force: true });
    bumpWrites();
    if (!r.refreshed && (r.status === 401 || r.status === 403)) {
      json(res, 402, { error: 'subscription inactive', ...licenseInfo(cfg.loadConfig()) });
      return true;
    }
    if (!r.refreshed && r.reason !== 'already current') {
      json(res, 502, { error: `could not fetch a key: ${r.reason}`, ...licenseInfo(cfg.loadConfig()) });
      return true;
    }
    json(res, 200, licenseInfo(cfg.loadConfig()));
    return true;
  }

  if (p === '/api/sync' && method === 'POST') {
    if (!ctx.syncHandler) {
      json(res, 501, { error: 'sync not available' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    try {
      json(res, 200, ctx.syncHandler(body));
    } catch (err) {
      json(res, 400, { error: String(err?.message ?? err) });
    }
    return true;
  }

  // Content Strategy (original posts via the user's Postiz) — bridge/content-routes.js.
  if (await handleContentApi(req, res, { json, readBody })) return true;

  // Product Posts (Pro "post anywhere") — bridge/post-routes.js.
  if (await handlePostApi(req, res, { json, readBody })) return true;

  json(res, 404, { error: 'not found' });
  return true;
}
