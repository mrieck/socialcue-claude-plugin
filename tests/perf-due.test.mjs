// Performance check-in cadence: replies are due daily-ish; product posts (memes,
// listings, Show HNs) stay up for weeks, so they join the queue on a slow
// cadence — first after a few days, then every couple of weeks, never once old.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');

const makeStore = () => path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-test-')), '.socialdiscovery');

/** Run `body` against lib/db.js in a fresh process bound to `store` (db.js is a per-process singleton). */
function withDb(store, body, data = {}) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const data = JSON.parse(process.env.TEST_DATA); const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, SOCIALCUE_DIR: store, TEST_DATA: JSON.stringify(data) }, encoding: 'utf8',
  }));
}
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString();

test('product posts enter perf due on the slow cadence; replies keep the daily one', () => {
  const store = makeStore();
  execFileSync('node', [CLI, 'config', 'init'], { env: { ...process.env, SOCIALCUE_DIR: store } });

  const ids = withDb(store, `
    const post = db.createPost({ subjectKind: 'content', subjectId: 'c1', subjectKey: 'content:c1', subjectName: 'meme',
      destinationUrl: 'https://www.reddit.com/r/AIDankmemes/submit', postType: 'link' });
    db.updatePost(post, { status: 'live', listingUrl: 'https://www.reddit.com/r/AIDankmemes/comments/abc/meme/' });
    const pending = db.createPost({ subjectKind: 'content', subjectId: 'c2', subjectKey: 'content:c2', subjectName: 'no url',
      destinationUrl: 'https://example.com/submit', postType: 'link' });
    db.updatePost(pending, { status: 'live' }); // live but no listing_url → never due
    const opp = db.addOpportunity({ platform: 'reddit', platformUrl: 'https://www.reddit.com/r/x/comments/1/t/', title: 't',
      opportunityType: 'general_comment', context: '', draftReply: 'hi', kind: 'reply' });
    db.setOpportunityStatus(opp, 'posted');
    return { post, pending, opp };
  `);

  // Fresh post (0 days old): only the reply is due.
  let due = withDb(store, 'return db.listPerformanceDue({ limit: 10 })');
  assert.deepEqual(due.map(r => [r.kind, r.id]), [['reply', ids.opp]]);

  // Backdate the post to 4 days live → due, with the live URL and a subject→destination title.
  withDb(store, `db.getDb().prepare('UPDATE product_posts SET verified_at = ? WHERE id = ?').run(data.at, data.id)`, { at: daysAgo(4), id: ids.post });
  due = withDb(store, 'return db.listPerformanceDue({ limit: 10 })');
  const row = due.find(r => r.kind === 'product_post');
  assert.ok(row, 'product post is due after 4 days');
  assert.equal(row.id, ids.post);
  assert.equal(row.platform_url, 'https://www.reddit.com/r/AIDankmemes/comments/abc/meme/');
  assert.match(row.title, /^meme → /);
  assert.equal(due[0].kind, 'reply', 'replies are listed first');
  assert.ok(!due.some(r => r.id === ids.pending), 'a live post without a listing_url is never due');

  // A check today silences it; a check 15 days ago does not.
  withDb(store, `db.recordReplyCheck(data.id, { upvotes: 3, replyCount: 1, note: 'still up' })`, { id: ids.post });
  due = withDb(store, 'return db.listPerformanceDue({ limit: 10 })');
  assert.ok(!due.some(r => r.id === ids.post), 'not due right after a check');
  withDb(store, `db.getDb().prepare('UPDATE reply_checks SET checked_at = ? WHERE opp_id = ?').run(data.at, data.id)`, { at: daysAgo(15), id: ids.post });
  due = withDb(store, 'return db.listPerformanceDue({ limit: 10 })');
  assert.ok(due.some(r => r.id === ids.post), 'due again 15 days after the last check');

  // Old posts (> 90 days live) have settled and drop out.
  withDb(store, `db.getDb().prepare('UPDATE product_posts SET verified_at = ? WHERE id = ?').run(data.at, data.id)`, { at: daysAgo(100), id: ids.post });
  due = withDb(store, 'return db.listPerformanceDue({ limit: 10 })');
  assert.ok(!due.some(r => r.id === ids.post), 'settled posts are not re-checked');

  // The limit caps the combined list and replies win the slots.
  withDb(store, `db.getDb().prepare('UPDATE product_posts SET verified_at = ? WHERE id = ?').run(data.at, data.id)`, { at: daysAgo(30), id: ids.post });
  due = withDb(store, 'return db.listPerformanceDue({ limit: 1 })');
  assert.deepEqual(due.map(r => r.kind), ['reply']);

  // perf record + post list surface the latest check for a product post id.
  const env = { ...process.env, SOCIALCUE_DIR: store };
  execFileSync('node', [CLI, 'perf', 'record', ids.post, '--upvotes', '7', '--replies', '2', '--note', 'top of sub'], { env });
  const listed = execFileSync('node', [CLI, 'post', 'list', '--subject', 'content:c1'], { env, encoding: 'utf8' });
  assert.match(listed, /checked \d{4}-\d{2}-\d{2}: 7 pts, 2 comments — top of sub/);
  const latest = withDb(store, 'return db.latestCheck(data.id)', { id: ids.post });
  assert.equal(latest.upvotes, 7);
});
