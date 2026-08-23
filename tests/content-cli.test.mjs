// Round-trips the crosspost data path through the real CLI against a throwaway
// store: variants must survive add → list → update, and the migration must add
// the column to a pre-variants database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');

function makeStore() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-test-')), '.socialdiscovery');
}

function cli(store, args, input) {
  return execFileSync('node', [CLI, ...args], {
    env: { ...process.env, SOCIALCUE_DIR: store },
    input,
    encoding: 'utf8',
  }).trim();
}

test('content add/list/update round-trip variants', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);

  const video = path.join(path.dirname(store), 'video.mp4');
  writeFileSync(video, 'not a real mp4, media ingest only checks existence');

  const variants = {
    'yt-1': {
      content: 'youtube description',
      settings: { __type: 'youtube', title: 'A real title', type: 'public' },
    },
    'tt-1': { content: 'tiktok caption' },
  };
  const id = cli(store, ['content', 'add', '-'], JSON.stringify({
    title: 'Crosspost test',
    body: 'fallback caption',
    channels: ['yt-1', 'tt-1'],
    media: [video],
    source: 'crosspost',
    status: 'draft',
    variants,
  }));
  assert.ok(id, 'content add prints the new id');

  const rows = JSON.parse(cli(store, ['content', 'list', '--json']));
  const row = rows.find(r => r.id === id);
  assert.ok(row, 'row is listed');
  assert.deepEqual(JSON.parse(row.variants), variants, 'variants survive the round-trip');
  assert.deepEqual(JSON.parse(row.media), [`${id}/video.mp4`], 'media ingested into the store');

  const patched = { 'yt-1': { content: 'edited description' } };
  cli(store, ['content', 'update', id, '-'], JSON.stringify({ variants: patched }));
  const after = JSON.parse(cli(store, ['content', 'list', '--json'])).find(r => r.id === id);
  assert.deepEqual(JSON.parse(after.variants), patched, 'update patches variants');
  assert.equal(after.body, 'fallback caption', 'update leaves untouched fields alone');

  cli(store, ['content', 'rm', id]);
  const gone = JSON.parse(cli(store, ['content', 'list', '--json']));
  assert.ok(!gone.some(r => r.id === id), 'rm removes the row');
});

test('migration adds variants to a pre-existing content_items table', async () => {
  const store = makeStore();
  cli(store, ['config', 'init']);

  // Recreate the pre-variants table shape, then let getDb()'s migration run.
  const { default: Database } = await import('better-sqlite3');
  const dbPath = path.join(store, 'socialcue.db');
  const raw = new Database(dbPath);
  const hasTable = raw.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='content_items'"
  ).get();
  if (hasTable) raw.exec('DROP TABLE content_items');
  raw.exec(`CREATE TABLE content_items (
    id TEXT PRIMARY KEY, brand_id TEXT, brand_name TEXT DEFAULT '',
    title TEXT DEFAULT '', body TEXT DEFAULT '', channels TEXT DEFAULT '[]',
    settings TEXT DEFAULT '{}', status TEXT NOT NULL DEFAULT 'idea',
    scheduled_for TEXT, postiz_post_id TEXT, release_url TEXT, venue_id TEXT,
    metrics TEXT DEFAULT '{}', media TEXT DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    sent_at TEXT, published_at TEXT, last_synced_at TEXT
  )`);
  raw.close();

  // Any CLI touch runs the schema block, which must add the column.
  cli(store, ['content', 'list', '--json']);
  const check = new Database(dbPath);
  const cols = check.prepare('PRAGMA table_info(content_items)').all().map(c => c.name);
  check.close();
  assert.ok(cols.includes('variants'), 'migration added the variants column');
});
