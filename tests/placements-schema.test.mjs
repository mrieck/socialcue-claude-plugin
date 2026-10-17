// Placement venues + approved pieces: the new destination kinds, post types and
// columns round-trip through the CLI on a fresh store and on a pre-existing one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');
const makeStore = () => path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-placements-')), '.socialdiscovery');
const cli = (store, args, input) => execFileSync('node', [CLI, ...args], { env: { ...process.env, SOCIALCUE_DIR: store }, input, encoding: 'utf8' }).trim();

function run(store, body, data = {}) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const data = JSON.parse(process.env.TEST_DATA); const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, SOCIALCUE_DIR: store, TEST_DATA: JSON.stringify(data) }, encoding: 'utf8',
  }));
}

test('a video host and a recurring thread are valid destinations', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  cli(store, ['dest', 'add', 'https://vimeo.com', '--name', 'Vimeo', '--kind', 'video', '--post-types', 'video', '--category', 'video']);
  cli(store, ['dest', 'add', 'https://dev.to/t/memes', '--id', 'devto-meme-monday', '--name', 'dev.to Meme Monday',
    '--kind', 'community', '--post-types', 'image', '--cadence', 'weekly:mon', '--auto-approve', '--weekly-cap', '1']);
  const rows = run(store, `return db.listDestinations().map(r => ({ id: r.id, kind: r.kind, types: db.destinationPostTypes(r),
    cadence: r.cadence, auto: r.auto_approve, cap: r.weekly_cap }));`);
  assert.deepEqual(rows.find(r => r.kind === 'video'), { id: 'vimeo-com', kind: 'video', types: ['video'], cadence: null, auto: 0, cap: null });
  assert.deepEqual(rows.find(r => r.id === 'devto-meme-monday'),
    { id: 'devto-meme-monday', kind: 'community', types: ['image'], cadence: 'weekly:mon', auto: 1, cap: 1 });
  assert.throws(() => cli(store, ['dest', 'add', 'https://example.com/x', '--kind', 'video', '--cadence', 'fortnightly']), /invalid cadence/);
});

test('dest update records the current instance of a recurring thread', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  cli(store, ['dest', 'add', 'https://dev.to/t/memes', '--id', 'devto-meme-monday', '--kind', 'community', '--post-types', 'image', '--cadence', 'weekly:mon']);
  cli(store, ['dest', 'update', 'devto-meme-monday', JSON.stringify({ currentUrl: 'https://dev.to/x/meme-monday-42', weeklyCap: 2 })]);
  const row = run(store, `const r = db.getDestinationById('devto-meme-monday');
    return { url: r.current_url, checked: !!r.current_url_checked_at, cap: r.weekly_cap };`);
  assert.deepEqual(row, { url: 'https://dev.to/x/meme-monday-42', checked: true, cap: 2 });
});

test('a content item can be approved for placement once', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const id = cli(store, ['content', 'add', '-'], JSON.stringify({ title: 'Meme: queue is the pricing page', body: 'img', status: 'published' })).split(/\s+/).pop();
  cli(store, ['content', 'update', id, JSON.stringify({ placementApprovedAt: true })]);
  const items = JSON.parse(cli(store, ['content', 'list', '--json']));
  const item = items.find(i => i.id === id);
  assert.match(item.placement_approved_at, /^\d{4}-\d{2}-\d{2}T/);
  cli(store, ['content', 'update', id, JSON.stringify({ placementApprovedAt: null })]);
  assert.equal(JSON.parse(cli(store, ['content', 'list', '--json'])).find(i => i.id === id).placement_approved_at, null);
});
