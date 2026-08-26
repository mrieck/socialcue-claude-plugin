// Product Posts data path through the real CLI against a throwaway store:
// the server venue playbook must apply idempotently and never clobber the
// user's own learnings (local_notes), the
// directories→destinations / submissions→product_posts migration must keep
// rows, subjects must resolve for brand/content/adhoc, and the asset cache
// must round-trip and refuse path escapes. `post start` is Pro-gated by a
// real Ed25519 key, so it is exercised manually, not here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');

function makeStore() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-test-')), '.socialdiscovery');
}

/** Run `fn(db)` against lib/db.js in a fresh process bound to `store` (db.js
 * is a per-process singleton, so in-process imports would leak across stores). */
function withDb(store, body, data = {}) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const data = JSON.parse(process.env.TEST_DATA); const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out ?? null));`;
  const raw = execFileSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, SOCIALCUE_DIR: store, TEST_DATA: JSON.stringify(data) }, encoding: 'utf8',
  });
  return JSON.parse(raw);
}
const rowsOf = (store) => withDb(store, 'return db.listDestinations().map(r => ({ ...r, providers: db.destinationProviders(r), fitsArr: db.destinationFits(r), brief: db.destinationNotesForBrief(r) }))');

function cli(store, args, input) {
  return execFileSync('node', [CLI, ...args], {
    env: { ...process.env, SOCIALCUE_DIR: store },
    input,
    encoding: 'utf8',
  }).trim();
}

const FIXTURE = [
  { id: 'producthunt', name: 'Product Hunt', url: 'https://www.producthunt.com', submitUrl: 'https://www.producthunt.com/posts/new', signup: 'oauth', oauthProviders: ['google'], notes: 'SERVER: launch at 00:01 PT', kind: 'launch', postTypes: ['listing'], category: 'launch', fits: ['saas', 'ai'], cost: 'free' },
  { id: 'hackernews-show', name: 'Show HN', url: 'https://news.ycombinator.com/submit', notes: '', kind: 'community', postTypes: ['link'], category: 'community', fits: [], cost: 'free' },
  { id: 'g2', name: 'G2', url: 'https://www.g2.com', notes: 'vendor portal', kind: 'directory', postTypes: ['listing'], category: 'review', fits: ['saas'], cost: 'free' },
  { id: 'reddit-sideproject', name: 'r/SideProject', url: 'https://www.reddit.com/r/SideProject', notes: 'no links in first comment', kind: 'community', postTypes: ['thread', 'link'], category: 'community', fits: [], cost: 'free' },
  { id: 'mcp-so', name: 'mcp.so', url: 'https://mcp.so', kind: 'directory', postTypes: ['listing'], category: 'mcp', fits: ['mcp'], cost: 'free' },
];

test('applyServerVenues is idempotent, owns notes, preserves local_notes, retires unlisted rows', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  // Simulate a pre-upgrade install: an old seed row with locally learned notes,
  // plus a user-added row.
  withDb(store, `
    db.addDestination({ id: 'producthunt', name: 'Product Hunt', url: 'https://www.producthunt.com', notes: 'LEARNED: my quirk', source: 'seed', kind: 'launch' });
    db.addDestination({ id: 'betapage', name: 'BetaPage', url: 'https://betapage.co', source: 'seed' });
    db.addDestination({ id: 'my-own', name: 'My Own', url: 'https://mine.test', source: 'user', notes: 'mine' });`);

  const first = withDb(store, 'return db.applyServerVenues(data.list)', { list: FIXTURE });
  assert.deepEqual(first, { added: 4, updated: 1, removed: 1 });
  let rows = rowsOf(store);
  const ph = rows.find(r => r.id === 'producthunt');
  assert.equal(ph.source, 'server');
  assert.equal(ph.notes, 'SERVER: launch at 00:01 PT', 'server notes win');
  assert.equal(ph.local_notes, 'LEARNED: my quirk', 'old learned notes moved to local_notes');
  assert.equal(ph.signup, 'oauth');
  assert.deepEqual(ph.providers, ['google']);
  assert.equal(ph.category, 'launch');
  assert.ok(!rows.find(r => r.id === 'betapage'), 'unlisted seed row retired');
  assert.equal(rows.find(r => r.id === 'my-own').notes, 'mine', 'user rows untouched');
  assert.match(ph.brief, /SERVER: launch at 00:01 PT\n\nYour own learnings:\nLEARNED: my quirk/);

  // Second apply: nothing added, local_notes untouched even when server notes change.
  const changed = FIXTURE.map(v => v.id === 'producthunt' ? { ...v, notes: 'SERVER v2' } : v);
  const second = withDb(store, 'return db.applyServerVenues(data.list)', { list: changed });
  assert.deepEqual(second, { added: 0, updated: 5, removed: 0 });
  rows = rowsOf(store);
  assert.equal(rows.find(r => r.id === 'producthunt').notes, 'SERVER v2');
  assert.equal(rows.find(r => r.id === 'producthunt').local_notes, 'LEARNED: my quirk');

  // A server row referenced by a post survives even when the server drops it.
  const third = withDb(store, `
    db.createPost({ subjectKind: 'brand', subjectId: 'b', subjectKey: 'brand:b', subjectName: 'B', subjectUrl: '', subjectPath: null, brandId: 'b', destinationId: 'g2', destinationUrl: 'https://www.g2.com', postType: 'listing' });
    return db.applyServerVenues(data.list);`, { list: FIXTURE.filter(v => v.id !== 'g2' && v.id !== 'mcp-so') });
  assert.equal(third.removed, 1, 'only the unreferenced row goes');
  rows = rowsOf(store);
  assert.ok(rows.find(r => r.id === 'g2'));
  assert.ok(!rows.find(r => r.id === 'mcp-so'));

  // kv round-trip
  assert.deepEqual(withDb(store, "db.setKv('venues_version', 'v1'); return [db.getKv('venues_version'), db.getKv('nope')]"), ['v1', null]);
});

test('dest list/update: free is gated; notes without an admin key become local learnings', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  assert.throws(() => cli(store, ['dest', 'list']), /pro_required/);
  assert.throws(() => cli(store, ['dest', 'seed']), /dest sync/);
  assert.match(cli(store, ['dest', 'admin-key']), /No admin key/);

  withDb(store, 'db.applyServerVenues(data.list)', { list: FIXTURE });
  const outp = cli(store, ['dest', 'update', 'producthunt', JSON.stringify({ notes: 'my learning', signup: 'mixed' })]);
  assert.match(outp, /local learnings/);
  const ph = rowsOf(store).find(r => r.id === 'producthunt');
  assert.equal(ph.notes, 'SERVER: launch at 00:01 PT', 'shared notes untouched');
  assert.equal(ph.local_notes, 'my learning');
  assert.equal(ph.signup, 'mixed');

  // dest add round-trips the catalog fields and stays a user row.
  const id = cli(store, ['dest', 'add', 'https://example-dir.test/submit', '--category', 'ai-tools', '--fits', 'ai,mcp', '--cost', 'paid']);
  const added = rowsOf(store).find(r => r.id === id);
  assert.equal(added.category, 'ai-tools');
  assert.deepEqual(added.fitsArr, ['ai', 'mcp']);
  assert.equal(added.cost, 'paid');
  assert.equal(added.source, 'user');
});

test('venues-sync handles 304, 403 and network failure without throwing', async () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  process.env.SOCIALCUE_DIR = store;
  const cfg = await import('../lib/config.js');
  const { syncVenues, pushVenue } = await import('../lib/venues-sync.js');

  // No token → no call at all.
  assert.deepEqual(await syncVenues({ force: true }), { synced: false, reason: 'no account token' });
  const config = cfg.loadConfig();
  config.licenseAccountToken = 'scacct_test';
  cfg.saveConfig(config);
  // Token but free key → pro_required, still no call.
  assert.equal((await syncVenues({ force: true })).reason, 'pro_required');

  // Stub isPro by giving the module a fake fetch and a fake license check path:
  // pushVenue does not need Pro, only the admin key.
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response('{}', { status: 200 }); };
  try {
    assert.equal((await pushVenue('producthunt', { notes: 'x' })).reason, 'no admin key');
    const c2 = cfg.loadConfig(); c2.venues = { adminKey: 'k' }; cfg.saveConfig(c2);
    const r = await pushVenue('producthunt', { notes: 'x', localNotes: 'never', testStatus: 'works' });
    assert.equal(r.pushed, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/api\/venues\/producthunt$/);
    assert.equal(calls[0].init.headers['x-api-key'], 'k');
    assert.deepEqual(JSON.parse(calls[0].init.body), { notes: 'x' }, 'localNotes/testStatus never leave the machine');

    globalThis.fetch = async () => new Response('Not found', { status: 404 });
    assert.match((await pushVenue('producthunt', { notes: 'y' })).reason, /server 404/);
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    assert.match((await pushVenue('producthunt', { notes: 'y' })).reason, /ECONNREFUSED/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(rowsOf(store).length, 0, 'pushes never touch the local table');
});

test('legacy directories/submissions tables migrate into destinations/product_posts', async () => {
  const store = makeStore();
  mkdirSync(store, { recursive: true });
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(path.join(store, 'socialcue.db'));
  db.exec(`
    CREATE TABLE directories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, submit_url TEXT DEFAULT '',
      signup TEXT, oauth_providers TEXT DEFAULT '[]', test_status TEXT, notes TEXT DEFAULT '',
      source TEXT NOT NULL DEFAULT 'seed', created_at TEXT NOT NULL
    );
    INSERT INTO directories VALUES ('oldsite','Old Site','https://old.example','','email','[]','works','keep me','user','2026-01-01T00:00:00Z');
    CREATE TABLE submissions (
      id TEXT PRIMARY KEY, brand_id TEXT NOT NULL, brand_name TEXT DEFAULT '', directory_id TEXT,
      directory_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', email_used TEXT DEFAULT '',
      listing_url TEXT, log TEXT DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      submitted_at TEXT, verified_at TEXT
    );
    CREATE INDEX idx_submissions_brand ON submissions(brand_id);
    INSERT INTO submissions (id, brand_id, brand_name, directory_id, directory_url, status, created_at, updated_at)
      VALUES ('s1','b1','Brand One','oldsite','https://old.example','submitted','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z');
  `);
  db.close();
  cli(store, ['config', 'init']);

  const rows = rowsOf(store);
  const old = rows.find(r => r.id === 'oldsite');
  assert.ok(old, 'user row survived the rename');
  assert.equal(old.notes, 'keep me');
  assert.equal(old.kind, 'directory');
  assert.equal(old.category, null);
  assert.deepEqual(old.fitsArr, []);
  assert.equal(old.cost, null);

  const posts = JSON.parse(cli(store, ['post', 'list', '--json']));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].subject_kind, 'brand');
  assert.equal(posts[0].subject_key, 'brand:b1');
  assert.equal(posts[0].subject_name, 'Brand One');
  assert.equal(posts[0].destination_id, 'oldsite');
  assert.equal(posts[0].status, 'submitted');
  // Alias shape still lists it.
  assert.match(cli(store, ['submission', 'list']), /Brand One/);
});

test('resolveSubject handles brand, content, and adhoc subjects', async () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  cli(store, ['brand', 'add', '--name', 'Acme', '--url', 'https://acme.dev', '--tagline', 'tag']);
  const config = JSON.parse(readFileSync(path.join(store, 'config.json'), 'utf8'));
  const brand = config.brands[0];

  const itemJson = cli(store, ['content', 'add', JSON.stringify({ title: 'Why I built Acme', body: 'story', brandName: 'Acme' })]);
  const itemId = /([0-9a-f-]{36})/.exec(itemJson)[1];

  process.env.SOCIALCUE_DIR = store;
  const { resolveSubject, buildSearchHints } = await import('../lib/post-subject.js');

  const b = resolveSubject({ subject: 'brand:Acme' }, config);
  assert.equal(b.subject.kind, 'brand');
  assert.equal(b.subject.key, `brand:${brand.id}`);
  assert.equal(b.subject.tagline, 'tag');
  assert.equal(b.brand.id, brand.id);
  // Bare brand name and legacy --brand both resolve to the brand.
  assert.equal(resolveSubject({ subject: 'Acme' }, config).subject.key, `brand:${brand.id}`);
  assert.equal(resolveSubject({ brand: 'Acme' }, config).subject.key, `brand:${brand.id}`);

  const c = resolveSubject({ subject: `content:${itemId}` }, config);
  assert.equal(c.subject.kind, 'content');
  assert.equal(c.subject.name, 'Why I built Acme');
  assert.equal(c.subject.body, 'story');
  assert.equal(c.brand.id, brand.id);

  const folder = path.dirname(store);
  const a = resolveSubject({ subject: 'adhoc', name: 'My Repo', url: 'https://github.com/x/my-repo', path: folder, brand: 'Acme' }, config);
  assert.equal(a.subject.kind, 'adhoc');
  assert.equal(a.subject.key, 'adhoc:my-repo');
  assert.equal(a.subject.path, folder);
  assert.equal(a.brand.id, brand.id);
  const hints = buildSearchHints(a.subject);
  assert.ok(hints.some(h => h.includes(folder)));
  assert.ok(hints.some(h => /GitHub/.test(h)));

  assert.throws(() => resolveSubject({ subject: 'adhoc' }, config), /--name/);
  assert.throws(() => resolveSubject({ subject: 'content:nope' }, config), /No content item/);
  assert.throws(() => resolveSubject({ subject: 'brand:Nope' }, config), /No brand/);
});

test('asset cache round-trips and refuses path escapes', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const src = path.join(path.dirname(store), 'logo.png');
  writeFileSync(src, 'not really a png');

  const added = JSON.parse(cli(store, ['post', 'asset', 'add', 'brand:abc', 'Logo Square 400', src]));
  assert.equal(added.role, 'logo-square-400');
  assert.equal(added.file, 'logo-square-400.png');
  assert.ok(existsSync(path.join(store, 'assets', 'brand_abc', 'logo-square-400.png')));

  const listed = JSON.parse(cli(store, ['post', 'assets', 'brand:abc', '--json']));
  assert.equal(listed.assets.length, 1);
  assert.equal(listed.assets[0].role, 'logo-square-400');

  // Re-adding the same role with another extension replaces the old file.
  const src2 = path.join(path.dirname(store), 'logo.jpg');
  writeFileSync(src2, 'jpg');
  cli(store, ['post', 'asset', 'add', 'brand:abc', 'logo-square-400', src2]);
  const again = JSON.parse(cli(store, ['post', 'assets', 'brand:abc', '--json']));
  assert.deepEqual(again.assets.map(a => a.file), ['logo-square-400.jpg']);

  assert.throws(() => cli(store, ['post', 'assets', '../etc']), /bad subject key/);
  assert.match(cli(store, ['post', 'asset', 'rm', 'brand:abc', '../config.json']), /No such asset/);
  assert.ok(existsSync(path.join(store, 'config.json')));
});
