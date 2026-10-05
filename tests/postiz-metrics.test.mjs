// Postiz analytics arrive as [{label, data:[{total:"4"}]}]; the store keeps a
// flat record with a normalized `views`, and published items keep refreshing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { flattenPostAnalytics } from '../lib/postiz-client.js';

process.env.SOCIALCUE_DIR = path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-test-')), '.socialdiscovery');
const db = await import('../lib/db.js');

test('flattenPostAnalytics turns the Postiz array into numbers + views', () => {
  const raw = [
    { label: 'Impressions', percentageChange: 0, data: [{ total: '3', date: '2026-09-19' }, { total: '4', date: '2026-09-20' }] },
    { label: 'Likes', percentageChange: 0, data: [{ total: '2', date: '2026-09-20' }] },
  ];
  assert.deepEqual(flattenPostAnalytics(raw), { Impressions: 4, Likes: 2, views: 4 });
  assert.deepEqual(flattenPostAnalytics([{ label: 'Views', data: [{ total: '154' }] }]), { Views: 154, views: 154 });
});

test('flattenPostAnalytics returns {} for empty or malformed payloads', () => {
  assert.deepEqual(flattenPostAnalytics([]), {});
  assert.deepEqual(flattenPostAnalytics(null), {});
  assert.deepEqual(flattenPostAnalytics([{ label: 'Likes', data: [] }]), {});
});

test('listContentForMetricsRefresh picks recent published items not synced lately', () => {
  const now = Date.now();
  const iso = ms => new Date(now - ms).toISOString();
  const mk = (title, published, synced) => {
    const id = db.addContentItem({ title, body: 'x', brandId: null });
    db.getDb().prepare('UPDATE content_items SET postiz_post_id = ?, status = ?, published_at = ?, last_synced_at = ? WHERE id = ?')
      .run('p-' + title, 'published', published, synced, id);
    return id;
  };
  const stale = mk('stale', iso(2 * 24 * 3600e3), iso(3 * 3600e3));
  mk('fresh', iso(2 * 24 * 3600e3), iso(5 * 60e3));
  mk('old', iso(30 * 24 * 3600e3), null);
  const never = mk('never', iso(3600e3), null);
  const ids = db.listContentForMetricsRefresh({ limit: 10 }).map(r => r.id);
  assert.deepEqual(new Set(ids), new Set([stale, never]));
});
