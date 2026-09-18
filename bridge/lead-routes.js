/**
 * Founder invitations (Pro) — the Invitations tab's API.
 *
 *   GET   /api/leads[?status=&brand=&platform=]   list (free tier: { leads: [], pro: false })
 *   PATCH /api/leads/:id                          { status?, userDm?, objection?, note? }
 *   POST  /api/leads/:id/open                     open the person's profile in the dedicated Chrome
 *
 * Nothing here sends a message. "open" only brings the profile up in the
 * user's own browser; the dashboard puts the DM on the clipboard and the user
 * pastes it into the platform's composer themselves.
 */
import * as db from '../lib/db.js';
import * as cfg from '../lib/config.js';
import { bumpWrites } from './changes.js';
import { isPro } from '../lib/license.js';

export async function handleLeadApi(req, res, ctx) {
  const { json, readBody } = ctx;
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;
  const method = req.method;
  if (!p.startsWith('/api/leads')) return false;

  const badBody = err =>
    json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });

  if (p === '/api/leads' && method === 'GET') {
    if (!isPro(cfg.loadConfig())) {
      json(res, 200, { leads: [], pro: false });
      return true;
    }
    const q = url.searchParams;
    const rows = db.queryLeads({
      status: q.get('status') || null,
      brandId: q.get('brand') || null,
      platform: q.get('platform') || null,
      limit: Math.min(Number(q.get('limit')) || 200, 500),
    });
    json(res, 200, { leads: rows, pro: true, statuses: db.LEAD_STATUSES });
    return true;
  }

  const m = p.match(/^\/api\/leads\/([^/]+)(\/open)?$/);
  if (!m) return false;
  const id = decodeURIComponent(m[1]);

  if (!isPro(cfg.loadConfig())) {
    json(res, 403, { error: 'pro_required' });
    return true;
  }

  if (!m[2] && method === 'PATCH') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch (err) { badBody(err); return true; }
    const patch = {};
    if (body?.status !== undefined) {
      if (!db.LEAD_STATUSES.includes(body.status)) {
        json(res, 400, { error: `status must be one of ${db.LEAD_STATUSES.join('|')}` });
        return true;
      }
      patch.status = body.status;
    }
    for (const k of ['userDm', 'objection', 'note']) {
      if (body?.[k] === undefined) continue;
      if (body[k] !== null && typeof body[k] !== 'string') { json(res, 400, { error: `${k} must be a string` }); return true; }
      patch[k] = body[k] === null ? '' : body[k].slice(0, 4000);
    }
    if (!Object.keys(patch).length) {
      json(res, 400, { error: 'nothing to update — pass status, userDm, objection and/or note' });
      return true;
    }
    let lead;
    try { lead = db.updateLead(id, patch); } catch (err) { json(res, 400, { error: String(err?.message ?? err) }); return true; }
    if (!lead) { json(res, 404, { error: `no lead ${id}` }); return true; }
    bumpWrites();
    json(res, 200, { lead });
    return true;
  }

  if (m[2] && method === 'POST') {
    const lead = db.getLeadById(id);
    if (!lead) { json(res, 404, { error: `no lead ${id}` }); return true; }
    try {
      const { openUrlIntent } = await import('./post-intent.js');
      const r = await openUrlIntent(lead.profileUrl, cfg.loadConfig());
      json(res, 200, { ...r, profileUrl: lead.profileUrl });
    } catch (err) {
      json(res, 502, { error: `couldn't open the browser: ${String(err?.message ?? err).split('\n')[0].slice(0, 200)}` });
    }
    return true;
  }

  return false;
}
