// /suggest-crosspost plumbing: derivedFrom round-trips through the CLI, and
// the digest reports where each source already went (channels, product
// posts, derived drafts) so the agent proposes only new targets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');
const makeStore = () => path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-suggest-')), '.socialdiscovery');
const cli = (store, args, input) => execFileSync('node', [CLI, ...args], { env: { ...process.env, SOCIALCUE_DIR: store }, input, encoding: 'utf8' }).trim();

function run(store, body, data = {}) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const act = await import(${JSON.stringify(path.join(ROOT, 'lib', 'activity.js'))});
    const data = JSON.parse(process.env.TEST_DATA); const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, SOCIALCUE_DIR: store, TEST_DATA: JSON.stringify(data) }, encoding: 'utf8',
  }));
}

test('content add validates derivedFrom and round-trips it', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const src = cli(store, ['content', 'add', '-'], JSON.stringify({ title: 'Demo video', body: 'watch', status: 'published' }));
  const draft = cli(store, ['content', 'add', '-'], JSON.stringify({
    title: 'X thread: demo', body: '1/ …', status: 'draft', source: 'suggest-crosspost',
    derivedFrom: `content:${src}`, notes: 'for x: hook + 5 beats',
  }));
  const rows = JSON.parse(cli(store, ['content', 'list', '--json']));
  assert.equal(rows.find(r => r.id === draft).derived_from, `content:${src}`);
  assert.equal(rows.find(r => r.id === src).derived_from, null);

  assert.throws(() => cli(store, ['content', 'add', '-'], JSON.stringify({ title: 'bad', body: 'x', derivedFrom: 'video:1' })), /derivedFrom must look like/);
  assert.throws(() => cli(store, ['content', 'add', '-'], JSON.stringify({ title: 'bad', body: 'x', derivedFrom: 'content:nope' })), /no content with id nope/);
});

test('suggest brief marks covered targets from channels, product posts and derived drafts', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const src = cli(store, ['content', 'add', '-'], JSON.stringify({
    title: 'Overboard tour', body: 'a video', status: 'published',
    settings: { yt1: { __type: 'youtube' } }, channels: ['yt1'],
  }));
  cli(store, ['content', 'publish', src, 'https://www.youtube.com/shorts/abc']);
  cli(store, ['content', 'add', '-'], JSON.stringify({
    title: 'Threads post: tour', body: 'short', status: 'draft', derivedFrom: `content:${src}`, notes: 'for threads: casual take',
  }));
  const actId = run(store, `
    const post = db.createPost({ subjectKind: 'content', subjectId: data.src, subjectKey: 'content:' + data.src, subjectName: 'Overboard tour',
      destinationUrl: 'https://www.reddit.com/r/macapps/submit', postType: 'link' });
    db.updatePost(post, { status: 'live', listingUrl: 'https://www.reddit.com/r/macapps/comments/xyz/tour/' });
    const a = act.recordActivity({ platform: 'hackernews', url: 'https://news.ycombinator.com/item?id=5', kind: 'comment', body: 'a sharp comment', score: 12, postedAt: new Date().toISOString() });
    return a.id;
  `, { src });
  const brief = JSON.parse(cli(store, ['suggest', 'brief']));
  const video = brief.sources.find(s => s.key === `content:${src}`);
  assert.ok(video, 'the published item is a source');
  assert.deepEqual(video.covered, ['reddit', 'threads', 'youtube']);
  assert.equal(video.derived.length, 1);
  assert.equal(video.derived[0].target, 'threads');
  assert.ok(!brief.sources.some(s => s.title === 'Threads post: tour'), 'drafts are not sources');
  const comment = brief.sources.find(s => s.key === `activity:${actId}`);
  assert.ok(comment, 'a high-scoring comment is a source');
  assert.deepEqual(comment.covered, ['hackernews']);
  assert.ok(brief.sources.some(s => s.kind === 'product_post' && s.covered.includes('reddit')));
  assert.deepEqual(brief.channels, [], 'Postiz off → no channels, no network');
});
