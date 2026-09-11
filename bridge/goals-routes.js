/**
 * Weekly goals API (Analytics tab). Delegated from routes.js after auth, so
 * every handler here is already behind the pairing token. Free tier: the
 * board is a review/routine surface like the queue, never gated.
 *
 *   GET    /api/goals?week=YYYY-MM-DD&archived=1   the board for that week
 *   POST   /api/goals                              { title, target, brandId?, rule? }
 *   POST   /api/goals/seed                         starter set (no-op when goals exist)
 *   PATCH  /api/goals/:id                          { title?, target?, brandId?, rule?, sortOrder?, archived? }
 *   DELETE /api/goals/:id
 *   POST   /api/goals/:id/entries                  { at?, note?, source?, ref? }  "Log one"
 *   DELETE /api/goals/:id/entries/:entryId
 */
import * as db from '../lib/db.js';
import * as cfg from '../lib/config.js';
import { bumpWrites } from './changes.js';
import { goalSummary, seedStarterGoals, validateRule, weekBounds, weekSummary, parseWeekParam } from '../lib/goals.js';

const MAX_TITLE = 120;
const MAX_TARGET = 999;

function checkBrand(brandId) {
  if (brandId === undefined) return undefined;
  if (brandId === null || brandId === '') return null;
  const brands = cfg.loadConfig().brands ?? [];
  if (!brands.some(b => b.id === brandId)) throw new Error(`unknown brand ${brandId}`);
  return brandId;
}

function checkTitle(title) {
  if (title === undefined) return undefined;
  const t = String(title ?? '').trim();
  if (!t) throw new Error('title required');
  if (t.length > MAX_TITLE) throw new Error(`title too long (max ${MAX_TITLE})`);
  return t;
}

function checkTarget(target) {
  if (target === undefined) return undefined;
  const n = Number(target);
  if (!Number.isInteger(n) || n < 1 || n > MAX_TARGET) throw new Error(`target must be an integer 1–${MAX_TARGET}`);
  return n;
}

function currentGoal(id, weekParam) {
  const row = db.getGoalById(id);
  if (!row) return null;
  const week = weekBounds(parseWeekParam(weekParam) ?? new Date());
  let brands = [];
  try { brands = cfg.loadConfig().brands ?? []; } catch { /* no config */ }
  return goalSummary(row, week, brands);
}

export async function handleGoalsApi(req, res, { json, readBody }) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;
  if (!p.startsWith('/api/goals')) return false;

  const parseBody = async () => {
    const raw = await readBody(req);
    return raw ? JSON.parse(raw) : {};
  };
  const badBody = err => {
    json(res, err.statusCode ?? 400, { error: err.statusCode === 413 ? 'body too large' : 'invalid JSON' });
  };

  if (p === '/api/goals' && method === 'GET') {
    json(res, 200, weekSummary({
      weekParam: url.searchParams.get('week'),
      includeArchived: url.searchParams.get('archived') === '1',
    }));
    return true;
  }

  if (p === '/api/goals' && method === 'POST') {
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    try {
      const row = db.createGoal({
        title: checkTitle(body?.title ?? ''),
        target: checkTarget(body?.target ?? 1),
        brandId: checkBrand(body?.brandId) ?? null,
        rule: validateRule(body?.rule),
      });
      bumpWrites();
      json(res, 200, { goal: currentGoal(row.id, body?.week) });
    } catch (err) {
      json(res, 400, { error: String(err?.message ?? err) });
    }
    return true;
  }

  if (p === '/api/goals/seed' && method === 'POST') {
    const r = seedStarterGoals();
    if (r.added) bumpWrites();
    json(res, 200, r);
    return true;
  }

  const entryDel = p.match(/^\/api\/goals\/([^/]+)\/entries\/([^/]+)$/);
  if (entryDel && method === 'DELETE') {
    const id = decodeURIComponent(entryDel[1]);
    const entryId = decodeURIComponent(entryDel[2]);
    if (!db.getGoalById(id)) { json(res, 404, { error: `no goal ${id}` }); return true; }
    const n = db.deleteGoalEntry(id, entryId);
    if (!n) { json(res, 404, { error: `no entry ${entryId}` }); return true; }
    bumpWrites();
    json(res, 200, { id: entryId, deleted: true, goal: currentGoal(id, url.searchParams.get('week')) });
    return true;
  }

  const entryAdd = p.match(/^\/api\/goals\/([^/]+)\/entries$/);
  if (entryAdd && method === 'POST') {
    const id = decodeURIComponent(entryAdd[1]);
    if (!db.getGoalById(id)) { json(res, 404, { error: `no goal ${id}` }); return true; }
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    try {
      const { entry, created } = db.addGoalEntry(id, {
        at: body?.at ?? null,
        note: typeof body?.note === 'string' ? body.note.slice(0, 500) : '',
        source: typeof body?.source === 'string' && body.source.trim() ? body.source.trim().slice(0, 40) : 'manual',
        ref: typeof body?.ref === 'string' && body.ref.trim() ? body.ref.trim().slice(0, 200) : null,
      });
      if (created) bumpWrites();
      json(res, 200, {
        entry: { id: entry.id, goalId: entry.goal_id, at: entry.at, note: entry.note ?? '', source: entry.source, ref: entry.ref ?? null, createdAt: entry.created_at },
        created,
        goal: currentGoal(id, body?.week ?? url.searchParams.get('week')),
      });
    } catch (err) {
      json(res, 400, { error: String(err?.message ?? err) });
    }
    return true;
  }

  const one = p.match(/^\/api\/goals\/([^/]+)$/);
  if (one && (method === 'PATCH' || method === 'DELETE')) {
    const id = decodeURIComponent(one[1]);
    if (!db.getGoalById(id)) { json(res, 404, { error: `no goal ${id}` }); return true; }
    if (method === 'DELETE') {
      db.deleteGoal(id);
      bumpWrites();
      json(res, 200, { id, deleted: true });
      return true;
    }
    let body;
    try { body = await parseBody(); } catch (err) { badBody(err); return true; }
    try {
      db.updateGoal(id, {
        title: checkTitle(body?.title),
        target: checkTarget(body?.target),
        brandId: checkBrand(body?.brandId),
        rule: body?.rule === undefined ? undefined : validateRule(body.rule),
        sortOrder: body?.sortOrder === undefined ? undefined : Number(body.sortOrder),
        archived: body?.archived === undefined ? undefined : !!body.archived,
      });
      bumpWrites();
      json(res, 200, { goal: currentGoal(id, body?.week ?? url.searchParams.get('week')) });
    } catch (err) {
      json(res, 400, { error: String(err?.message ?? err) });
    }
    return true;
  }

  return false;
}
