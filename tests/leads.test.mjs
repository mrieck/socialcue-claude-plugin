// Founder invitations (Pro leads): the leads table, pipeline stamps, person
// dedupe across platform aliases, the weekly invited count, and the CLI.
// lib/db.js is a per-process singleton, so each store gets its own child
// process (same pattern as perf-due.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');

const makeStore = () => path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-leads-')), '.socialdiscovery');

function withDb(store, body, data = {}) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const data = JSON.parse(process.env.TEST_DATA); const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out ?? null));`;
  return JSON.parse(execFileSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, SOCIALCUE_DIR: store, TEST_DATA: JSON.stringify(data) }, encoding: 'utf8',
  }));
}
const cli = (store, args) => execFileSync('node', [CLI, ...args], { env: { ...process.env, SOCIALCUE_DIR: store }, encoding: 'utf8' });

const lead = (over = {}) => ({
  platform: 'reddit', handle: 'u/founder', profileUrl: 'https://www.reddit.com/user/founder/',
  postUrl: 'https://www.reddit.com/r/SaaS/comments/1/launched/', brandId: 'b1', brandName: 'Social Cue',
  ask: 'launched two weeks ago, zero users', fitScore: 8, fitSummary: 'solo founder, released product',
  evidence: ['bio: solo dev', 'launched Aug 2026'], draftDm: 'Saw your post…', ...over,
});

test('leads link to the collected reply, stamp pipeline dates once, and round-trip evidence', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = withDb(store, `
    const oppId = db.addOpportunity({ platform: 'reddit', platformUrl: data.lead.postUrl, title: 't',
      opportunityType: 'product_reply', context: '', suggestedReply: 'hi', kind: 'reply' });
    const id = db.addLead({ ...data.lead, oppId });
    const fresh = db.getLeadById(id);
    const invited = db.updateLead(id, { status: 'invited' });
    const back = db.updateLead(id, { status: 'candidate' });
    const again = db.updateLead(id, { status: 'invited' });
    const withDm = db.updateLead(id, { userDm: 'my own words', note: 'met at a meetup' });
    db.setOpportunityStatus(oppId, 'posted');
    return { fresh, invited, back, again, withDm, counts: db.leadCounts(), list: db.queryLeads({ status: 'invited' }).length,
      afterPost: db.getLeadById(id).oppStatus };
  `, { lead: lead() });
  assert.equal(r.afterPost, 'posted', 'the joined reply status follows the opportunity');
  assert.equal(r.fresh.status, 'candidate');
  assert.deepEqual(r.fresh.evidence, ['bio: solo dev', 'launched Aug 2026']);
  assert.equal(r.fresh.oppTitle, 't');
  assert.equal(r.fresh.oppStatus, 'new');
  assert.ok(r.invited.invitedAt, 'invited_at stamped on first transition');
  assert.equal(r.back.invitedAt, r.invited.invitedAt, 'moving back keeps the stamp');
  assert.equal(r.again.invitedAt, r.invited.invitedAt, 'stamps only once');
  assert.equal(r.withDm.userDm, 'my own words');
  assert.equal(r.withDm.note, 'met at a meetup');
  assert.equal(r.counts.invitations, 0, 'invited leads leave the badge');
  assert.equal(r.list, 1);
});

test('person dedupe: 90-day window, keyed by normalized profile URL across x.com/twitter.com', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = withDb(store, `
    db.addLead({ ...data.lead, platform: 'x', handle: '@maker', profileUrl: 'https://x.com/maker' });
    db.addLead({ ...data.lead, platform: 'reddit', handle: 'u/old', profileUrl: 'https://www.reddit.com/user/old/',
      createdAt: new Date(Date.now() - 120 * 86400000).toISOString() });
    return {
      twitterAlias: db.isPersonSeen('https://twitter.com/maker'),
      xTrailing: db.isPersonSeen('https://x.com/maker/'),
      other: db.isPersonSeen('https://x.com/someone_else'),
      old: db.isPersonSeen('https://reddit.com/user/old'),
      recent: db.recentLeadProfiles({ days: 90 }).map(p => p.handle),
    };
  `, { lead: lead() });
  assert.equal(r.twitterAlias, true);
  assert.equal(r.xTrailing, true);
  assert.equal(r.other, false);
  assert.equal(r.old, false, 'older than the window is fair game again');
  assert.deepEqual(r.recent, ['@maker']);
});

test('countInvitedInWeek counts invited_at inside the window, per brand and platform', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = withDb(store, `
    const a = db.addLead({ ...data.lead, brandId: 'b1', platform: 'reddit', profileUrl: 'https://reddit.com/user/a' });
    const b = db.addLead({ ...data.lead, brandId: 'b2', platform: 'threads', profileUrl: 'https://threads.com/@b' });
    const c = db.addLead({ ...data.lead, brandId: 'b1', platform: 'reddit', profileUrl: 'https://reddit.com/user/c' });
    db.updateLead(a, { status: 'invited' });
    db.updateLead(b, { status: 'invited' });
    // c never invited
    const start = new Date(Date.now() - 86400000).toISOString();
    const end = new Date(Date.now() + 86400000).toISOString();
    return {
      all: db.countInvitedInWeek({ start, end }),
      b1: db.countInvitedInWeek({ start, end, brandId: 'b1' }),
      threads: db.countInvitedInWeek({ start, end, platformKeys: ['threads'] }),
      none: db.countInvitedInWeek({ start: '2020-01-01', end: '2020-01-08' }),
    };
  `, { lead: lead() });
  assert.deepEqual(r, { all: 2, b1: 1, threads: 1, none: 0 });
});

test('CLI: lead list/show/status/update, and lead brief is Pro-gated', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const id = withDb(store, `return db.addLead(data.lead);`, { lead: lead() });
  assert.match(cli(store, ['lead', 'list']), /\[candidate\] 8\/10 {2}reddit {2}u\/founder/);
  assert.equal(JSON.parse(cli(store, ['lead', 'show', id])).handle, 'u/founder');
  assert.match(cli(store, ['lead', 'status', id, 'invited']), /status invited/);
  assert.match(cli(store, ['lead', 'update', id, '{"objection":"not now"}']), /objection/);
  assert.equal(JSON.parse(cli(store, ['lead', 'list', '--json']))[0].objection, 'not now');
  assert.match(cli(store, ['lead', 'brief']), /pro_required/);
  assert.throws(() => cli(store, ['lead', 'status', id, 'bogus']), /invalid lead status/);
});
