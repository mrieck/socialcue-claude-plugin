// Weekly goals (Analytics tab): week math, platform normalisation, the three
// auto-rules against a throwaway store, posted_at stamping, and the CLI.
// lib/db.js is a per-process singleton, so every store gets its own child
// process (same pattern as product-posts.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'lib', 'cli.js');

function makeStore() {
  return path.join(mkdtempSync(path.join(tmpdir(), 'socialcue-goals-')), '.socialdiscovery');
}

function run(store, body, { data = {}, env = {} } = {}) {
  const script = `const db = await import(${JSON.stringify(path.join(ROOT, 'lib', 'db.js'))});
    const goals = await import(${JSON.stringify(path.join(ROOT, 'lib', 'goals.js'))});
    const data = JSON.parse(process.env.TEST_DATA); const out = await (async () => { ${body} })();
    process.stdout.write(JSON.stringify(out ?? null));`;
  const raw = execFileSync('node', ['--input-type=module', '-e', script], {
    env: { ...process.env, SOCIALCUE_DIR: store, TEST_DATA: JSON.stringify(data), ...env }, encoding: 'utf8',
  });
  return JSON.parse(raw);
}

function cli(store, args, input) {
  return execFileSync('node', [CLI, ...args], {
    env: { ...process.env, SOCIALCUE_DIR: store }, input, encoding: 'utf8',
  }).trim();
}

const CHI = { TZ: 'America/Chicago' };

test('weekBounds: Sunday 00:00 local → next Sunday, in the process timezone', () => {
  const store = makeStore();
  const r = run(store, `
    const wed = goals.weekBounds(new Date(2026, 8, 9));      // Wed Sep 9
    const sun = goals.weekBounds(new Date(2026, 8, 6));      // Sun Sep 6
    const sat = goals.weekBounds(new Date(2026, 8, 12, 23, 59, 59));
    const mon = goals.weekBounds(new Date(2026, 8, 9), 1);   // weekStartsOn = Monday
    const dst = goals.weekBounds(new Date(2026, 2, 10));     // week containing US DST start (Mar 8 2026)
    return { wed, sun, sat, mon, dst, param: goals.parseWeekParam('2026-09-06')?.getDate(), bad: goals.parseWeekParam('nope') };
  `, { env: CHI });
  assert.equal(r.wed.startDate, '2026-09-06');
  assert.equal(r.wed.endDate, '2026-09-12');
  assert.equal(r.wed.label, 'Sep 6 – Sep 12');
  assert.equal(r.wed.start, '2026-09-06T05:00:00.000Z'); // CDT = UTC-5
  assert.equal(r.wed.end, '2026-09-13T05:00:00.000Z');
  assert.equal(r.sun.startDate, '2026-09-06');
  assert.equal(r.sat.startDate, '2026-09-06');
  assert.equal(r.mon.startDate, '2026-09-07');
  // DST week still spans local midnight to local midnight (167 h, not 168).
  assert.equal(r.dst.startDate, '2026-03-08');
  assert.equal((Date.parse(r.dst.end) - Date.parse(r.dst.start)) / 3600000, 167);
  assert.equal(r.param, 6); // parsed as local, not shifted to Sep 5
  assert.equal(r.bad, null);

  const utc = run(store, 'return goals.weekBounds(new Date(2026, 8, 9)).start', { env: { TZ: 'UTC' } });
  assert.equal(utc, '2026-09-06T00:00:00.000Z');
});

test('normalizePlatform folds the free-text spellings discovery writes', () => {
  const store = makeStore();
  const r = run(store, `return ['Twitter/X', 'twitter', 'x', 'Hacker News', 'hackernews', 'Indie Hackers', 'instagram-standalone', 'Threads', 'threads.net', 'Reddit', 'Dev.to', 'something-new'].map(goals.normalizePlatform)`);
  assert.deepEqual(r, ['x', 'x', 'x', 'hackernews', 'hackernews', 'indiehackers', 'instagram', 'threads', 'threads', 'reddit', 'devto', 'somethingnew']);
  const aliases = run(store, `return goals.platformAliases('Twitter')`);
  assert.ok(aliases.includes('twitterx') && aliases.includes('x'));
});

test('validateRule accepts the three rule types and rejects the rest', () => {
  const store = makeStore();
  const r = run(store, `
    const ok = [
      goals.validateRule({ type: 'content', platform: 'TikTok', titlePrefix: 'meme-' }),
      goals.validateRule({ type: 'post', destinationHost: 'https://www.indiehackers.com/post/x', postType: 'article' }),
      goals.validateRule({ type: 'reply', platform: 'Hacker News' }),
      goals.validateRule(null),
      goals.validateRule('{"type":"reply"}'),
    ];
    const bad = [];
    for (const x of [{ type: 'nope' }, { type: 'post', postType: 'video' }, [1], 'not json']) {
      try { goals.validateRule(x); bad.push('accepted'); } catch (e) { bad.push(String(e.message).split(':')[0]); }
    }
    return { ok, bad };
  `);
  assert.equal(r.ok[0].platform, 'tiktok');
  assert.equal(r.ok[1].destinationHost, 'indiehackers.com');
  assert.equal(r.ok[2].platform, 'hackernews');
  assert.equal(r.ok[3], null);
  assert.equal(r.ok[4].type, 'reply');
  assert.deepEqual(r.bad, ['invalid_rule', 'invalid_rule', 'invalid_rule', 'invalid_rule']);
});

test('rules count the right rows in the right week (offset-bearing scheduled_for included)', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = run(store, `
    const d = db.getDb();
    const now = new Date().toISOString();
    const ci = (title, status, extra = {}) => d.prepare(
      'INSERT INTO content_items (id, brand_id, brand_name, title, body, channels, settings, status, scheduled_for, published_at, sent_at, source, variants, format, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), extra.brandId ?? null, '', title, 'b', '[]', extra.settings ?? '{}', status, extra.scheduledFor ?? null, extra.publishedAt ?? null, null, extra.source ?? 'crosspost', extra.variants ?? '{}', 'text', now, now);
    const threads = JSON.stringify({ abc: { content: 'x', settings: { __type: 'threads' } } });
    const tiktok = JSON.stringify({ tt: { content: 'x', settings: { __type: 'tiktok' } } });
    const igStandalone = JSON.stringify({ ig: { settings: { __type: 'instagram-standalone' } } });
    // in-week (Sep 6–12 2026, Chicago): scheduled with a -05:00 offset and no published_at
    ci('meme-one', 'scheduled', { scheduledFor: '2026-09-10T10:40:00-05:00', variants: threads });
    ci('meme-two', 'published', { publishedAt: '2026-09-08T15:00:00.000Z', variants: threads });
    ci('a question for founders', 'published', { publishedAt: '2026-09-09T15:00:00.000Z', variants: threads, brandId: 'brand-a' });
    ci('cut 1', 'scheduled', { scheduledFor: '2026-09-11T10:00:00-05:00', variants: tiktok });
    ci('reel', 'published', { publishedAt: '2026-09-11T10:00:00Z', settings: JSON.stringify({ ig: { __type: 'instagram-standalone' } }) });
    ci('reel-2', 'published', { publishedAt: '2026-09-11T10:00:00Z', variants: igStandalone });
    // boundary rows: exactly at start (in) and exactly at end (out), local midnight Chicago = 05:00Z
    ci('meme-start', 'published', { publishedAt: '2026-09-06T05:00:00.000Z', variants: threads });
    ci('meme-end', 'published', { publishedAt: '2026-09-13T05:00:00.000Z', variants: threads });
    // excluded: idea/draft, previous week
    ci('meme-idea', 'idea', { scheduledFor: '2026-09-10T10:00:00-05:00', variants: threads });
    ci('meme-old', 'published', { publishedAt: '2026-09-01T10:00:00Z', variants: threads });

    const pp = (status, url, extra = {}) => d.prepare(
      'INSERT INTO product_posts (id, subject_kind, subject_key, brand_id, destination_url, post_type, status, created_at, updated_at, submitted_at, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), 'brand', 'brand:x', extra.brandId ?? null, url, extra.postType ?? 'article', status, now, extra.updatedAt ?? now, extra.submittedAt ?? null, extra.verifiedAt ?? null);
    pp('submitted', 'https://www.indiehackers.com/post/1', { submittedAt: '2026-09-09T12:00:00Z' });
    pp('live', 'https://www.indiehackers.com/post/2', { verifiedAt: '2026-09-10T12:00:00Z', updatedAt: '2026-09-10T12:00:00Z' }); // NULL submitted_at
    pp('submitted', 'https://dev.to/new', { submittedAt: '2026-09-09T12:00:00Z', brandId: 'brand-a' });
    pp('skipped', 'https://www.indiehackers.com/post/3', { submittedAt: '2026-09-09T12:00:00Z' });
    pp('submitted', 'https://www.indiehackers.com/post/4', { submittedAt: '2026-08-30T12:00:00Z' });

    const op = (platform, status, extra = {}) => d.prepare(
      'INSERT INTO opportunities (id, brand_id, brand_name, source, platform, platform_url, title, context, opportunity_type, relevance_score, relevance_reason, suggested_reply, suggested_action, status, created_at, kind, posted_at, posted_intent_at, normalized_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), extra.brandId ?? null, '', 'plugin', platform, 'https://e.test/' + Math.random(), 't', 'c', 'general_comment', 7, '', 'r', '', status, extra.createdAt ?? '2026-09-08T12:00:00Z', extra.kind ?? 'reply', extra.postedAt ?? null, extra.intentAt ?? null, 'k' + Math.random());
    op('Twitter', 'posted', { postedAt: '2026-09-09T12:00:00Z' });
    op('twitter', 'posted', { intentAt: '2026-09-09T12:00:00Z' });          // legacy: intent only
    op('Twitter/X', 'posted', { createdAt: '2026-09-09T12:00:00Z' });       // legacy: created_at only
    op('Reddit', 'posted', { postedAt: '2026-09-09T12:00:00Z', brandId: 'brand-a' });
    op('Reddit', 'approved', { postedAt: '2026-09-09T12:00:00Z' });          // not posted
    op('Reddit', 'posted', { postedAt: '2026-09-09T12:00:00Z', kind: 'recommendation' }); // not a reply
    op('Reddit', 'posted', { postedAt: '2026-09-02T12:00:00Z' });            // last week

    const week = goals.weekBounds(new Date(2026, 8, 9));
    const ev = (rule, brandId = null) => goals.evaluateRule(rule, brandId, week);
    return {
      memes: ev({ type: 'content', platform: 'threads', titlePrefix: 'meme-' }),
      nonMeme: ev({ type: 'content', platform: 'threads', excludeTitlePrefix: 'meme-' }),
      nonMemeBrand: ev({ type: 'content', platform: 'threads', excludeTitlePrefix: 'meme-' }, 'brand-a'),
      tiktok: ev({ type: 'content', platform: 'tiktok' }),
      instagram: ev({ type: 'content', platform: 'instagram' }),
      anyContent: ev({ type: 'content' }),
      ih: ev({ type: 'post', destinationHost: 'indiehackers.com' }),
      devto: ev({ type: 'post', destinationHost: 'dev.to' }),
      devtoWrongBrand: ev({ type: 'post', destinationHost: 'dev.to' }, 'brand-b'),
      articles: ev({ type: 'post', postType: 'article' }),
      x: ev({ type: 'reply', platform: 'x' }),
      reddit: ev({ type: 'reply', platform: 'reddit' }),
      redditBrand: ev({ type: 'reply', platform: 'reddit' }, 'brand-a'),
      anyReply: ev({ type: 'reply' }),
      manual: ev(null),
    };
  `, { env: CHI });
  assert.equal(r.memes, 3);        // one, two, start (end + idea + old excluded)
  assert.equal(r.nonMeme, 1);
  assert.equal(r.nonMemeBrand, 1);
  assert.equal(r.tiktok, 1);
  assert.equal(r.instagram, 2);    // settings.__type and variants.__type, prefix match
  assert.equal(r.anyContent, 7);
  assert.equal(r.ih, 2);           // submitted + live-with-null-submitted_at
  assert.equal(r.devto, 1);
  assert.equal(r.devtoWrongBrand, 0);
  assert.equal(r.articles, 3);
  assert.equal(r.x, 3);            // Twitter / twitter / Twitter/X, all three timestamp fallbacks
  assert.equal(r.reddit, 1);
  assert.equal(r.redditBrand, 1);
  assert.equal(r.anyReply, 4);
  assert.equal(r.manual, 0);
});

test('excluding an auto item drops it from the count and the badge, and is reversible', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = run(store, `
    const d = db.getDb();
    const now = new Date().toISOString();
    const threads = JSON.stringify({ abc: { content: 'x', settings: { __type: 'threads' } } });
    const ids = ['m1', 'm2'];
    for (const id of ids) d.prepare(
      'INSERT INTO content_items (id, brand_id, brand_name, title, body, channels, settings, status, scheduled_for, published_at, sent_at, source, variants, format, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)'
    ).run(id, '', 'meme-' + id, 'b', '[]', '{}', 'scheduled', '2026-09-10T10:40:00-05:00', 'crosspost', threads, 'text', now, now);
    const goal = db.createGoal({ title: 'Memes', target: 2, rule: { type: 'content', platform: 'threads', titlePrefix: 'meme-' } });
    const week = goals.weekBounds(new Date(2026, 8, 9));
    const before = goals.goalSummary(goal, week, []);
    const changed = db.setGoalExclusion(goal.id, 'content', 'm1', true);
    const again = db.setGoalExclusion(goal.id, 'content', 'm1', true);
    const after = goals.goalSummary(goal, week, []);
    db.setGoalExclusion(goal.id, 'content', 'm1', false);
    const restored = goals.goalSummary(goal, week, []);
    db.setGoalExclusion(goal.id, 'content', 'm1', true);
    db.deleteGoal(goal.id);
    const leftover = d.prepare('SELECT COUNT(*) n FROM goal_exclusions').get().n;
    return {
      before: { count: before.count, items: before.autoItems.map(i => [i.id, i.excluded]) },
      changed, again,
      after: { count: after.count, excluded: after.excludedCount, items: after.autoItems.map(i => [i.id, i.excluded]) },
      restored: restored.count, leftover,
    };
  `, { env: CHI });
  assert.equal(r.before.count, 2);
  assert.deepEqual(r.before.items, [['m1', false], ['m2', false]]);
  assert.equal(r.changed, true);
  assert.equal(r.again, false);              // idempotent
  assert.equal(r.after.count, 1);
  assert.equal(r.after.excluded, 1);
  assert.deepEqual(r.after.items, [['m1', true], ['m2', false]]);  // still listed, flagged
  assert.equal(r.restored, 2);
  assert.equal(r.leftover, 0);               // deleteGoal cleans up
});

test('weekStartsOn from config drives the board week; CLI exclude/include round-trips', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = run(store, `
    const cfg = await import(${JSON.stringify(path.join(ROOT, 'lib', 'config.js'))});
    const d = db.getDb();
    const now = new Date().toISOString();
    const tiktok = JSON.stringify({ tt: { content: 'x', settings: { __type: 'tiktok' } } });
    // Sunday Sep 13 2026 10:45 Chicago: in a Sun-start week of Sep 13, in a Mon-start week of Sep 7.
    d.prepare(
      'INSERT INTO content_items (id, brand_id, brand_name, title, body, channels, settings, status, scheduled_for, published_at, sent_at, source, variants, format, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?)'
    ).run('sun', '', 'Sunday cut', 'b', '[]', '{}', 'scheduled', '2026-09-13T10:45:00-05:00', 'crosspost', tiktok, 'text', now, now);
    db.createGoal({ title: 'TikTok videos', target: 3, rule: { type: 'content', platform: 'tiktok' } });
    const sunday = goals.weekSummary({ weekParam: '2026-09-14' });
    cfg.saveConfig({ ...cfg.loadConfig(), weekStartsOn: 1 });
    const monday = goals.weekSummary({ weekParam: '2026-09-14' });
    return {
      sundayWeek: [sunday.week.startDate, sunday.week.endDate, sunday.week.weekStartsOn, sunday.week.labelLong, sunday.goals[0].count],
      mondayWeek: [monday.week.startDate, monday.week.endDate, monday.week.weekStartsOn, monday.week.labelLong, monday.goals[0].count],
      endsAt: monday.week.endsAt,
    };
  `, { env: CHI });
  assert.deepEqual(r.sundayWeek, ['2026-09-13', '2026-09-19', 0, 'Sun Sep 13 – Sat Sep 19', 1]);
  assert.deepEqual(r.mondayWeek, ['2026-09-14', '2026-09-20', 1, 'Mon Sep 14 – Sun Sep 20', 0]);
  assert.equal(r.endsAt, '2026-09-21T05:00:00.000Z'); // Mon Sep 21 00:00 CDT

  // CLI: the Sunday cut counts in the Sep 7–13 Monday-start week; exclude it, then include it.
  const items = cli(store, ['goals', 'items', 'TikTok', '--week', '2026-09-13']);
  assert.match(items, /Mon Sep 7 – Sun Sep 13/);
  assert.match(items, /sun\s+.*Sunday cut/);
  assert.match(cli(store, ['goals', 'exclude', 'TikTok', 'sun', '--week', '2026-09-13']), /now 0\/3/);
  assert.match(cli(store, ['goals', 'items', 'TikTok', '--week', '2026-09-13']), /✕ excluded/);
  assert.match(cli(store, ['goals', 'include', 'TikTok', 'sun', '--week', '2026-09-13']), /now 1\/3/);
});

test('setOpportunityStatus stamps posted_at once', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  const r = run(store, `
    const id = db.addOpportunity({ brandId: null, source: 'plugin', platform: 'reddit', platformUrl: 'https://reddit.com/r/x/1', title: 't', context: '', opportunityType: 'general_comment', relevanceScore: 7, relevanceReason: '', suggestedReply: 'r', suggestedAction: '' });
    const before = db.getOpportunityById(id).posted_at;
    db.setOpportunityStatus(id, 'reviewed');
    const afterReviewed = db.getOpportunityById(id).posted_at;
    db.setOpportunityStatus(id, 'posted');
    const first = db.getOpportunityById(id).posted_at;
    await new Promise(r => setTimeout(r, 5));
    db.setOpportunityStatus(id, 'posted');
    const second = db.getOpportunityById(id).posted_at;
    db.setOpportunityStatus(id, 'skipped');
    const afterSkip = db.getOpportunityById(id).posted_at;
    return { before, afterReviewed, first, second, afterSkip };
  `);
  assert.equal(r.before, null);
  assert.equal(r.afterReviewed, null);
  assert.ok(r.first);
  assert.equal(r.second, r.first);
  assert.equal(r.afterSkip, null, 'leaving posted clears the stamp (undo)');
});

test('goals CLI: seed once, log with idempotent ref, list, rm removes entries', () => {
  const store = makeStore();
  cli(store, ['config', 'init']);
  assert.match(cli(store, ['goals', 'seed']), /Added 9 starter goals/);
  assert.match(cli(store, ['goals', 'seed']), /already exist/);
  assert.match(cli(store, ['goals', 'log', 'tiktok', '--note', 'cut 1', '--ref', 'k1']), /Logged "TikTok videos".*now 1\/3/);
  assert.match(cli(store, ['goals', 'log', 'tiktok', '--ref', 'k1']), /Already logged.*now 1\/3/);
  assert.match(cli(store, ['goals', 'log', 'tiktok']), /now 2\/3/);
  const list = JSON.parse(cli(store, ['goals', 'list', '--json']));
  assert.equal(list.goals.length, 9);
  const tt = list.goals.find(g => g.title === 'TikTok videos');
  assert.equal(tt.manualCount, 2);
  assert.equal(tt.autoCount, 0);
  assert.equal(tt.entries[0].source, 'cli');
  assert.equal(list.totals.target, 28);
  // ambiguous title substring is refused
  assert.throws(() => cli(store, ['goals', 'log', 'articles']), /matches several goals/);
  // entries come out with the goal
  cli(store, ['goals', 'rm', tt.id]);
  const after = JSON.parse(cli(store, ['goals', 'list', '--json']));
  assert.equal(after.goals.length, 8);
  const orphan = run(store, `return db.getDb().prepare('SELECT COUNT(*) n FROM goal_entries').get().n`);
  assert.equal(orphan, 0);
  // add with an explicit rule
  assert.match(cli(store, ['goals', 'add', JSON.stringify({ title: 'HN replies', target: 2, rule: { type: 'reply', platform: 'Hacker News' } })]), /reply · hackernews/);
});
