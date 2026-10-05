// Activity log (/log-activity): URL dedupe + Content Library promotion, the
// tracked-only perf check-in branch, and the `activity` goal rule. lib/db.js is
// a per-process singleton, so each store runs in a child process.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');
const makeStore = () => path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-activity-')), '.socialdiscovery');

function run(store, body, data = {}) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const act = await import(${JSON.stringify(path.join(ROOT, 'lib', 'activity.js'))});
    const goals = await import(${JSON.stringify(path.join(ROOT, 'lib', 'goals.js'))});
    const data = JSON.parse(process.env.TEST_DATA); const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, SOCIALCUE_DIR: store, TEST_DATA: JSON.stringify(data) }, encoding: 'utf8',
  }));
}
const cli = (store, args, input) => execFileSync('node', [CLI, ...args], { env: { ...process.env, SOCIALCUE_DIR: store }, input, encoding: 'utf8' }).trim();
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();

test('activity dedupes on the normalized URL and files posts (not comments) in the Content Library', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = run(store, `
    const a = act.recordActivity({ platform: 'reddit', url: 'https://old.reddit.com/r/SaaS/comments/abc/my_post/', kind: 'post', title: 'My post', body: 'hello world', postedAt: data.at });
    const dup = act.recordActivity({ platform: 'reddit', url: 'https://www.reddit.com/r/SaaS/comments/abc/my_post/', kind: 'post', body: 'hello world' });
    const c = act.recordActivity({ platform: 'twitter', url: 'https://twitter.com/me/status/1', kind: 'reply', body: 'a reply', parentTitle: '@them: original' });
    const cdup = act.recordActivity({ platform: 'x', url: 'https://x.com/me/status/1', kind: 'reply', body: 'a reply' });
    let refused = null;
    try { act.promoteActivity(c.id); } catch (e) { refused = e.message; }
    const again = act.promoteActivity(a.id);
    const item = db.getContentItemById(a.contentItemId);
    return { a, dup, c, cdup, refused, again, item, platform: db.getActivityById(c.id).platform };
  `, { at: daysAgo(1) });
  assert.equal(r.a.created, true);
  assert.equal(r.dup.created, false);
  assert.equal(r.dup.id, r.a.id, 'old.reddit and www.reddit collapse to one row');
  assert.equal(r.cdup.created, false, 'twitter.com and x.com collapse too');
  assert.equal(r.platform, 'x', 'twitter is stored under the canonical key');
  assert.ok(r.a.contentItemId, 'a post is filed in the Content Library');
  assert.equal(r.c.contentItemId, null, 'a reply is not');
  assert.match(r.refused, /Only posts/);
  assert.equal(r.again.created, false, 'promoting twice is a no-op');
  assert.equal(r.again.contentItemId, r.a.contentItemId);
  assert.equal(r.item.status, 'published');
  assert.equal(r.item.source, 'activity');
  assert.equal(r.item.release_url, 'https://old.reddit.com/r/SaaS/comments/abc/my_post/');
  assert.equal(r.item.title, 'My post');
});

test('only tracked activity joins perf due, and a check-in updates its score', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const ids = run(store, `
    const t = act.recordActivity({ platform: 'reddit', url: 'https://reddit.com/r/a/comments/1/x/c1', kind: 'comment', body: 'tracked', postedAt: data.at }, { promote: false });
    const u = act.recordActivity({ platform: 'reddit', url: 'https://reddit.com/r/a/comments/2/y/c2', kind: 'comment', body: 'untracked', postedAt: data.at }, { promote: false });
    db.setActivityTracked(t.id, true);
    return { t: t.id, u: u.id };
  `, { at: daysAgo(3) });
  const due = run(store, 'return db.listPerformanceDue({ limit: 10 })');
  assert.deepEqual(due.map(r => [r.kind, r.id]), [['activity', ids.t]]);
  assert.equal(due[0].platform_url, 'https://reddit.com/r/a/comments/1/x/c1');
  assert.equal(due[0].title, 'tracked');

  cli(store, ['perf', 'record', ids.t, '--upvotes', '7', '--replies', '2']);
  const after = run(store, 'return { row: db.getActivityById(data.id), due: db.listPerformanceDue({ limit: 10 }), kind: db.resolvePerfKind(data.id) }', { id: ids.t });
  assert.equal(after.row.score, 7);
  assert.equal(after.row.reply_count, 2);
  assert.equal(after.kind, 'activity');
  assert.deepEqual(after.due, [], 'a fresh check silences it');
});

test('goal rule activity counts this week only, by platform and kind', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = run(store, `
    const now = new Date();
    act.recordActivity({ platform: 'reddit', url: 'https://reddit.com/r/a/comments/1/x/c1', kind: 'comment', body: 'this week', postedAt: now.toISOString() }, { promote: false });
    act.recordActivity({ platform: 'reddit', url: 'https://reddit.com/r/a/comments/2/y/c2', kind: 'comment', body: 'this week too', postedAt: now.toISOString() }, { promote: false });
    act.recordActivity({ platform: 'reddit', url: 'https://reddit.com/r/a/comments/3/z/', kind: 'post', body: 'a post', postedAt: now.toISOString() }, { promote: false });
    act.recordActivity({ platform: 'x', url: 'https://x.com/me/status/9', kind: 'reply', body: 'other platform', postedAt: now.toISOString() }, { promote: false });
    act.recordActivity({ platform: 'reddit', url: 'https://reddit.com/r/a/comments/4/old/c4', kind: 'comment', body: 'last month', postedAt: new Date(now - 40 * 86400000).toISOString() }, { promote: false });
    const week = goals.weekBounds(now);
    const rule = goals.validateRule({ type: 'activity', platform: 'reddit', kind: 'comment' });
    let bad = null; try { goals.validateRule({ type: 'activity', kind: 'like' }); } catch (e) { bad = e.message; }
    return { rule, count: goals.evaluateRule(rule, null, week), any: goals.evaluateRule({ type: 'activity' }, null, week), label: goals.describeRule(rule), bad };
  `);
  assert.deepEqual(r.rule, { type: 'activity', platform: 'reddit', kind: 'comment' });
  assert.equal(r.count, 2);
  assert.equal(r.any, 4, 'no filters: everything posted this week');
  assert.equal(r.label, 'activity · reddit · comment');
  assert.match(r.bad, /kind must be one of/);
});
