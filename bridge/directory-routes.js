/**
 * Directory submission API — the Pro "submit anywhere" pillar. Delegated from
 * routes.js after auth, so every handler here is already behind the pairing
 * token.
 *
 * Free/Pro line: viewing the directory registry is free; submission state
 * (list + edits) is Pro like /api/performance — the dashboard swallows the
 * 403 into the upgrade prompt. The dashboard is a state surface only: actual
 * submissions run through /socialcue-submit in Claude Code (agent work needs
 * the agent loop), so there is no "start a submission" endpoint here.
 *
 * The directory-signup email (config.directories) is just an address the user
 * is signed into inside the dedicated Chrome — editable here (setup, free).
 * Directory-account passwords are not reachable here at all — they live
 * outside SQLite (lib/credentials.js).
 */
import * as db from '../lib/db.js';
import * as cfg from '../lib/config.js';
import { bumpWrites } from './changes.js';
import { isPro } from '../lib/license.js';
import { EMAIL_RE, webmailUrlFor } from '../lib/webmail.js';

/** SQLite snake_case row -> API camelCase submission. */
export function rowToSubmission(r) {
  return {
    id: r.id,
    brandId: r.brand_id,
    brandName: r.brand_name ?? '',
    directoryId: r.directory_id ?? null,
    directoryUrl: r.directory_url,
    status: r.status,
    emailUsed: r.email_used ?? '',
    listingUrl: r.listing_url ?? null,
    log: JSON.parse(r.log || '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    submittedAt: r.submitted_at ?? null,
    verifiedAt: r.verified_at ?? null,
  };
}

/** The `directories` blob of GET /api/settings (shared with routes.js). */
export function directorySettings(c) {
  const signupEmail = c.directories?.signupEmail ?? '';
  const webmailUrl = c.directories?.webmailUrl ?? '';
  return { signupEmail, webmailUrl, effectiveWebmailUrl: webmailUrlFor(signupEmail, webmailUrl) };
}

function rowToDirectory(r) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    submitUrl: r.submit_url || null,
    signup: r.signup ?? null,
    oauthProviders: db.directoryProviders(r),
    testStatus: r.test_status ?? null,
    notes: r.notes ?? '',
    source: r.source,
  };
}

/**
 * Handle a directory/submission/signup-settings request. Returns true if the route
 * matched. Shares helpers with routes.js via ctx: { json, readBody }.
 */
export async function handleDirectoryApi(req, res, ctx) {
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

  /* ----- directory registry (free — it's just a catalog) ----- */

  if (p === '/api/directories' && method === 'GET') {
    json(res, 200, { directories: db.listDirectories().map(rowToDirectory) });
    return true;
  }

  /* ----- submissions (Pro) ----- */

  if (p === '/api/submissions' && method === 'GET') {
    if (!isPro(cfg.loadConfig())) {
      json(res, 403, { error: 'pro_required' });
      return true;
    }
    const rows = db.querySubmissions({
      brandId: url.searchParams.get('brand') || null,
      status: url.searchParams.get('status') || null,
      limit: Math.min(Number(url.searchParams.get('limit')) || 100, 500),
      offset: Number(url.searchParams.get('offset')) || 0,
    });
    json(res, 200, { submissions: rows.map(rowToSubmission) });
    return true;
  }

  // Status-level edits only (mark live/skipped, paste the listing URL once a
  // directory publishes). Running a submission is /socialcue-submit's job.
  const subPatch = p.match(/^\/api\/submissions\/([^/]+)$/);
  if (subPatch && method === 'PATCH') {
    if (!isPro(cfg.loadConfig())) {
      json(res, 403, { error: 'pro_required' });
      return true;
    }
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    const id = decodeURIComponent(subPatch[1]);
    if (!db.getSubmissionById(id)) {
      json(res, 404, { error: `no submission ${id}` });
      return true;
    }
    try {
      db.updateSubmission(id, {
        status: body?.status,
        listingUrl: body?.listingUrl,
      });
    } catch (err) {
      json(res, 400, { error: String(err?.message ?? err) });
      return true;
    }
    bumpWrites();
    json(res, 200, { submission: rowToSubmission(db.getSubmissionById(id)) });
    return true;
  }

  /* ----- Directory-signup email (setup; free) ----- */

  if (p === '/api/settings/directories' && method === 'PATCH') {
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    const config = cfg.loadConfig();
    const next = { ...config.directories };
    if (body?.signupEmail !== undefined) {
      const e = String(body.signupEmail).trim();
      if (e && !EMAIL_RE.test(e)) { json(res, 400, { error: 'signupEmail must be an email address' }); return true; }
      next.signupEmail = e;
    }
    if (body?.webmailUrl !== undefined) {
      const w = String(body.webmailUrl).trim();
      if (w && !/^https?:\/\//.test(w)) { json(res, 400, { error: 'webmailUrl must be a full http(s) URL' }); return true; }
      next.webmailUrl = w;
    }
    config.directories = next;
    cfg.saveConfig(config);
    bumpWrites();
    json(res, 200, directorySettings(cfg.loadConfig()));
    return true;
  }

  return false;
}
