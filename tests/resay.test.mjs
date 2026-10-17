// Drafts in the owner's voice + resay: the brief carries the owner's real
// writing, the critic never touches a user rewrite, and resay runs list the
// answer bank.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');
const makeStore = () => path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-resay-')), '.socialdiscovery');
const cli = (store, args, input) => execFileSync('node', [CLI, ...args], { env: { ...process.env, SOCIALCUE_DIR: store }, input, encoding: 'utf8' }).trim();

function run(store, body) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const out = await (async () => { ${body} })(); process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], { env: { ...process.env, SOCIALCUE_DIR: store }, encoding: 'utf8' }));
}

function setup() {
  const store = makeStore();
  cli(store, ['config', 'init']);
  cli(store, ['brand', 'add', '--name', 'Acme', '--url', 'https://acme.dev', '--tags', 'ci']);
  return store;
}

test('the brief carries the owner\'s own comments and rewrites, not placeholders', () => {
  const store = setup();
  const now = new Date().toISOString();
  run(store, `
    db.addActivity({ platform: 'reddit', url: 'https://reddit.com/r/a/comments/1/x/c1', kind: 'comment', body: 'Umm, Claude can browse reddit just fine using normal Chrome. Thats how I found this thread.', score: 12, postedAt: '${now}' });
    db.addActivity({ platform: 'indiehackers', url: 'https://indiehackers.com/post/2', kind: 'comment', body: "(Comment on this thread; IH's activity page doesn't show the comment text.)", postedAt: '${now}' });
    db.addOpportunity({ platform: 'Reddit', platformUrl: 'https://reddit.com/r/b/comments/3/y', suggestedReply: 'The scary part is the access.' });
    const id = db.getDb().prepare('SELECT id FROM opportunities').get().id;
    db.updateOpportunityReview(id, { userReply: 'only worried once it can reach prod tbh' });`);
  const brief = cli(store, ['brief']);
  assert.match(brief, /## YOUR OWN WRITING/);
  assert.match(brief, /Umm, Claude can browse reddit just fine/);
  assert.match(brief, /Theirs: "only worried once it can reach prod tbh"/);
  assert.doesNotMatch(brief, /activity page doesn't show the comment text/);
  assert.doesNotMatch(brief, /## RESAY/);
});

test('the critic revises machine drafts only and keeps the first draft once', () => {
  const store = setup();
  const ids = run(store, `
    const a = db.addOpportunity({ platform: 'Reddit', platformUrl: 'https://reddit.com/r/a/comments/1/x', suggestedReply: 'Disclosure: I built a tool for this.', runId: 'r1' });
    const b = db.addOpportunity({ platform: 'Reddit', platformUrl: 'https://reddit.com/r/a/comments/2/y', suggestedReply: 'Curious which worked better?', runId: 'r1' });
    db.updateOpportunityReview(b, { userReply: 'mine, obviously' });
    return { a, b };`);
  assert.deepEqual(JSON.parse(cli(store, ['opp', 'critic', '--run', 'r1'])).map(r => r.id), [ids.a]);
  assert.match(cli(store, ['opp', 'update', ids.a, '-'], JSON.stringify({ revisedReply: 'I made a tool for this, Acme.' })), /Revised/);
  cli(store, ['opp', 'update', ids.a, '-'], JSON.stringify({ revisedReply: 'second pass' }));
  assert.match(cli(store, ['opp', 'update', ids.b, '-'], JSON.stringify({ revisedReply: 'nope' })), /Not revised/);
  const rows = run(store, `return db.getDb().prepare('SELECT id, suggested_reply, first_draft, user_reply FROM opportunities').all();`);
  const a = rows.find(r => r.id === ids.a), b = rows.find(r => r.id === ids.b);
  assert.equal(a.first_draft, 'Disclosure: I built a tool for this.');
  assert.equal(a.suggested_reply, 'second pass');
  assert.equal(b.suggested_reply, 'Curious which worked better?');
  assert.equal(b.user_reply, 'mine, obviously');
  assert.equal(JSON.parse(cli(store, ['opp', 'critic', '--run', 'r1'])).length, 0);
});

test('resay runs list the answer bank, and the draft rules carry no dashes', () => {
  const store = setup();
  const src = cli(store, ['content', 'add', '-'], JSON.stringify({ title: 'DemoDay demo', body: 'Claude records and narrates your app.', status: 'published' }));
  assert.match(cli(store, ['resay', 'pending']), new RegExp(`content:${src}`));
  cli(store, ['resay', 'set', `content:${src}`, '-'], JSON.stringify({ question: 'how do I make a demo video without recording myself', points: ['Claude drives the app and records it'] }));
  assert.match(cli(store, ['resay', 'pending']), /Every resay source has an answer-bank entry/);
  const brief = cli(store, ['brief', '--mode', 'resay']);
  assert.match(brief, /## RESAY: THINGS YOU ALREADY SAID/);
  assert.match(brief, new RegExp(`\\[content:${src}\\] answers: how do I make a demo video without recording myself`));
  assert.match(brief, /This run is resay only/);

  const skill = readFileSync(path.join(ROOT, 'skills', 'scoring-brain', 'SKILL.md'), 'utf8');
  const rules = skill.slice(skill.indexOf('## Draft Reply Rules'), skill.indexOf('### Platform norms'));
  assert.ok(rules.length > 500);
  assert.doesNotMatch(rules, /[—–]/);
});
