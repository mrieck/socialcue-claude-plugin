/**
 * Activity log (/log-activity) — the Analytics tab's "Activity log" section.
 *
 *   GET   /api/activity[?platform=&kind=&days=30&limit=]   list (free)
 *   PATCH /api/activity/:id                               { tracked?, note?, brandId? }
 *   POST  /api/activity/:id/promote                       file a logged post in the Content Library
 */
import * as db from '../lib/db.js';
import * as cfg from '../lib/config.js';
import { bumpWrites } from './changes.js';
import { promoteActivity } from '../lib/activity.js';

function rowToActivity(r) {
  return {
    id: r.id,
    platform: r.platform,
    url: r.url,
    kind: r.kind,
    title: r.title ?? '',
    body: r.body ?? '',
    parentUrl: r.parent_url ?? null,
    parentTitle: r.parent_title ?? '',
    community: r.community ?? '',
    handle: r.handle ?? '',
    brandId: r.brand_id ?? null,
    brandName: r.brand_name ?? '',
    postedAt: r.posted_at ?? null,
    collectedAt: r.collected_at,
    runId: r.run_id ?? null,
    contentItemId: r.content_item_id ?? null,
    tracked: r.tracked === 1,
    score: r.score ?? null,
    replyCount: r.reply_count ?? null,
    note: r.note ?? '',
  };
}

export async function handleActivityApi(req, res, ctx) {
  const { json, readBody } = ctx;
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const method = req.method;
  if (!p.startsWith('/api/activity')) return false;

  if (p === '/api/activity' && method === 'GET') {
    const q = url.searchParams;
    const days = Number(q.get('days')) || 30;
    const rows = db.listActivity({
      platform: q.get('platform') || null,
      kind: q.get('kind') || null,
      since: new Date(Date.now() - days * 86400000).toISOString(),
      limit: Math.min(Number(q.get('limit')) || 200, 500),
    });
    json(res, 200, { items: rows.map(rowToActivity) });
    return true;
  }

  const m = p.match(/^\/api\/activity\/([^/]+)(\/promote)?$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);
  if (!db.getActivityById(id)) { json(res, 404, { error: `no activity ${id}` }); return true; }

  if (m[2] && method === 'POST') {
    let r;
    try { r = promoteActivity(id); } catch (err) { json(res, 400, { error: String(err?.message ?? err) }); return true; }
    bumpWrites();
    json(res, 200, { ...rowToActivity(db.getActivityById(id)), created: r.created });
    return true;
  }

  if (!m[2] && method === 'PATCH') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (err) {
      json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
      return true;
    }
    const patch = {};
    if (body?.tracked !== undefined) {
      if (typeof body.tracked !== 'boolean') { json(res, 400, { error: 'tracked must be a boolean' }); return true; }
      db.setActivityTracked(id, body.tracked);
    }
    if (body?.note !== undefined) {
      if (body.note !== null && typeof body.note !== 'string') { json(res, 400, { error: 'note must be a string' }); return true; }
      patch.note = body.note === null ? '' : body.note.slice(0, 2000);
    }
    if (body?.brandId !== undefined) {
      if (body.brandId === null || body.brandId === '') { patch.brandId = null; patch.brandName = ''; }
      else {
        const brand = cfg.resolveBrand(String(body.brandId));
        if (!brand) { json(res, 400, { error: `no brand ${body.brandId}` }); return true; }
        patch.brandId = brand.id; patch.brandName = brand.name;
      }
    }
    if (Object.keys(patch).length) db.updateActivity(id, patch);
    else if (body?.tracked === undefined) { json(res, 400, { error: 'nothing to update — pass tracked, note and/or brandId' }); return true; }
    bumpWrites();
    json(res, 200, rowToActivity(db.getActivityById(id)));
    return true;
  }

  return false;
}
