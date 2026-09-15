/**
 * Product Posts API — the Pro "post anywhere" pillar: get a subject (a brand,
 * a Content Library item, or an ad-hoc thing) listed on a directory, launched
 * on a launch site, or posted to a community/forum. Delegated from routes.js
 * after auth, so every handler here is already behind the pairing token.
 *
 * Free/Pro line: the venue playbook (GET /api/destinations) is Pro — it is
 * synced from the licensing site with the account token and a free install
 * gets `{destinations: [], pro: false}`; a subject's cached assets stay free;
 * post state (list + edits) is Pro like /api/performance — the dashboard
 * swallows the 403 into the upgrade prompt. The dashboard is a
 * state surface only: actual posts run through /socialcue-post in Claude Code
 * (agent work needs the agent loop), so there is no "start a post" endpoint.
 *
 * The signup email (config.directories) is just an address the user is
 * signed into inside the dedicated Chrome — editable here (setup, free).
 * Account passwords are not reachable here at all (lib/credentials.js).
 *
 * Legacy /api/directories and /api/submissions routes are kept as aliases.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as db from '../lib/db.js';
import * as cfg from '../lib/config.js';
import { bumpWrites } from './changes.js';
import { isPro } from '../lib/license.js';
import { syncVenuesInBackground } from '../lib/venues-sync.js';
import { EMAIL_RE, webmailUrlFor } from '../lib/webmail.js';
import { listAssets, resolveAssetPath } from '../lib/asset-store.js';

/** SQLite snake_case row -> API camelCase product post. */
export function rowToPost(r) {
  return {
    id: r.id,
    subjectKind: r.subject_kind,
    subjectId: r.subject_id ?? null,
    subjectKey: r.subject_key,
    subjectName: r.subject_name ?? '',
    subjectUrl: r.subject_url ?? '',
    subjectPath: r.subject_path ?? null,
    brandId: r.brand_id ?? null,
    destinationId: r.destination_id ?? null,
    destinationUrl: r.destination_url,
    destinationName: r.destination_name ?? null,
    destinationKind: r.destination_kind ?? null,
    postType: r.post_type,
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

/** Legacy submission shape (brand-era field names) for /api/submissions. */
export function rowToSubmission(r) {
  const p = rowToPost(r);
  return { ...p, brandName: p.subjectName, directoryId: p.destinationId, directoryUrl: p.destinationUrl };
}

/** The `directories` blob of GET /api/settings (shared with routes.js). */
export function directorySettings(c) {
  const signupEmail = c.directories?.signupEmail ?? '';
  const webmailUrl = c.directories?.webmailUrl ?? '';
  return { signupEmail, webmailUrl, effectiveWebmailUrl: webmailUrlFor(signupEmail, webmailUrl) };
}

function rowToDestination(r) {
  return {
    id: r.id,
    name: r.name,
    url: r.url,
    submitUrl: r.submit_url || null,
    kind: r.kind ?? 'directory',
    postTypes: db.destinationPostTypes(r),
    signup: r.signup ?? null,
    oauthProviders: db.destinationProviders(r),
    category: r.category ?? null,
    fits: db.destinationFits(r),
    cost: r.cost ?? null,
    notes: r.notes ?? '',
    localNotes: r.local_notes ?? '',
    source: r.source,
  };
}

const IMAGE_TYPES = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.heic': 'image/heic',
};

/**
 * Handle a destination/post/asset/signup-settings request. Returns true if
 * the route matched. Shares helpers with routes.js via ctx: { json, readBody }.
 */
export async function handlePostApi(req, res, ctx) {
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

  /* ----- venue playbook (Pro — synced from the licensing site) ----- */

  if ((p === '/api/destinations' || p === '/api/directories') && method === 'GET') {
    const pro = isPro(cfg.loadConfig());
    if (!pro) {
      json(res, 200, p === '/api/directories' ? { directories: [], pro: false } : { destinations: [], pro: false });
      return true;
    }
    // Throttled inside syncVenues; a real change bumps the write counter so
    // the dashboard's poll picks the new rows up.
    syncVenuesInBackground(() => bumpWrites());
    const kind = url.searchParams.get('kind') || null;
    const rows = db.listDestinations({ kind }).map(rowToDestination);
    const version = db.getKv('venues_version');
    json(res, 200, p === '/api/directories' ? { directories: rows, pro: true, version } : { destinations: rows, pro: true, version });
    return true;
  }

  /* ----- product posts (Pro) ----- */

  if ((p === '/api/posts' || p === '/api/submissions') && method === 'GET') {
    if (!isPro(cfg.loadConfig())) {
      json(res, 403, { error: 'pro_required' });
      return true;
    }
    const rows = db.queryPosts({
      brandId: url.searchParams.get('brand') || null,
      subjectKey: url.searchParams.get('subject') || null,
      subjectKind: url.searchParams.get('subjectKind') || null,
      destinationKind: url.searchParams.get('kind') || null,
      status: url.searchParams.get('status') || null,
      limit: Math.min(Number(url.searchParams.get('limit')) || 100, 500),
      offset: Number(url.searchParams.get('offset')) || 0,
    });
    json(res, 200, p === '/api/submissions'
      ? { submissions: rows.map(rowToSubmission) }
      : { posts: rows.map(rowToPost) });
    return true;
  }

  // Status-level edits only (mark live/skipped, paste the listing URL once a
  // destination publishes). Running a post is /socialcue-post's job.
  const postPatch = p.match(/^\/api\/(posts|submissions)\/([^/]+)$/);
  if (postPatch && method === 'PATCH') {
    if (!isPro(cfg.loadConfig())) {
      json(res, 403, { error: 'pro_required' });
      return true;
    }
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    const id = decodeURIComponent(postPatch[2]);
    if (!db.getPostById(id)) {
      json(res, 404, { error: `no post ${id}` });
      return true;
    }
    try {
      db.updatePost(id, { status: body?.status, listingUrl: body?.listingUrl });
    } catch (err) {
      json(res, 400, { error: String(err?.message ?? err) });
      return true;
    }
    bumpWrites();
    const row = db.queryPosts({ limit: 1000 }).find(r => r.id === id) ?? db.getPostById(id);
    json(res, 200, postPatch[1] === 'submissions'
      ? { submission: rowToSubmission(row) }
      : { post: rowToPost(row) });
    return true;
  }

  /* ----- subject asset cache (free; read-only listing + image bytes) ----- */

  const assetList = p.match(/^\/api\/assets\/([^/]+)$/);
  if (assetList && method === 'GET') {
    const key = decodeURIComponent(assetList[1]);
    try {
      json(res, 200, { assets: listAssets(key).map(a => ({ role: a.role, file: a.file, bytes: a.bytes, width: a.width ?? null, height: a.height ?? null })) });
    } catch (err) {
      json(res, 400, { error: String(err?.message ?? err) });
    }
    return true;
  }

  // Stream one cached asset. Hard-guarded to the subject's asset dir (like the
  // screenshot route); fetched with the Bearer header and shown via blob URL.
  const assetFile = p.match(/^\/api\/assets\/([^/]+)\/([^/]+)$/);
  if (assetFile && method === 'GET') {
    let file;
    try {
      file = resolveAssetPath(decodeURIComponent(assetFile[1]), decodeURIComponent(assetFile[2]));
    } catch {
      json(res, 404, { error: 'no asset' });
      return true;
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      json(res, 404, { error: 'no asset' });
      return true;
    }
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
    return true;
  }

  /* ----- signup email (setup; free) ----- */

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
export const handleDirectoryApi = handlePostApi; // legacy alias
