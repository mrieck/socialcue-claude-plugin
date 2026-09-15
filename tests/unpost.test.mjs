// "Undo posted": a mis-clicked ✓ must be reversible, and the reply must stop
// counting toward the weekly goal once it is undone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');
const makeStore = () => path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-unpost-')), '.socialdiscovery');

function withDb(store, body) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const out = await (async () => { ${body} })(); process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, SOCIALCUE_DIR: store }, encoding: 'utf8',
  }));
}

test('leaving posted clears posted_at; re-posting stamps it fresh', () => {
  const store = makeStore();
  execFileSync('node', [CLI, 'config', 'init'], { env: { ...process.env, SOCIALCUE_DIR: store } });
  const r = withDb(store, `
    const id = db.addOpportunity({ platform: 'reddit', platformUrl: 'https://www.reddit.com/r/x/comments/9/t/', title: 't',
      opportunityType: 'general_comment', context: '', suggestedReply: 'hi', kind: 'reply' });
    const week = { start: new Date(Date.now() - 86400000).toISOString(), end: new Date(Date.now() + 86400000).toISOString() };
    db.setOpportunityStatus(id, 'posted');
    const posted = { at: db.getOpportunityById(id).posted_at, count: db.countRepliesInWeek(week) };
    db.setOpportunityStatus(id, 'reviewed');
    const undone = { at: db.getOpportunityById(id).posted_at, status: db.getOpportunityById(id).status, count: db.countRepliesInWeek(week) };
    await new Promise(r => setTimeout(r, 5));
    db.setOpportunityStatus(id, 'posted');
    const again = { at: db.getOpportunityById(id).posted_at, count: db.countRepliesInWeek(week) };
    return { posted, undone, again };
  `);
  assert.ok(r.posted.at);
  assert.equal(r.posted.count, 1);
  assert.equal(r.undone.at, null);
  assert.equal(r.undone.status, 'reviewed');
  assert.equal(r.undone.count, 0);
  assert.ok(r.again.at && r.again.at > r.posted.at, 'a later real post gets a fresh stamp');
  assert.equal(r.again.count, 1);
});
