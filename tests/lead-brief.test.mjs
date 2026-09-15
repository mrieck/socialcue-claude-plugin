import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutonomousDiscoveryPrompt, buildInvitationsSection } from '../vendor/shared/prompts.js';
import { BrandSchema, ConfigSchema } from '../vendor/shared/schema.js';
import { validateRule, describeRule, RULE_TYPES } from '../lib/goals.js';

const brand = {
  name: 'Social Cue', url: 'https://trysocialcue.com', tagline: 't', shortDescription: 'd', tags: [],
  idealCustomer: 'solo founder with a released SaaS', requirements: 'a Claude Code subscription', disqualifiers: 'agencies',
};
const platform = { name: 'Reddit', homeUrl: 'https://www.reddit.com', hints: [], algorithmTips: [], isKnown: true };

test('the invitations section renders the rubric, the cap, the skip list and the collect_lead contract', () => {
  const s = buildInvitationsSection({ brands: [brand], maxLeadsPerRun: 2, seenHandles: ['reddit: u/already'] });
  assert.match(s, /## FOUNDER INVITATIONS \(Pro\)/);
  assert.match(s, /up to 2 people/);
  assert.match(s, /Ideal customer: solo founder with a released SaaS/);
  assert.match(s, /Requirements they must meet: a Claude Code subscription/);
  assert.match(s, /Disqualifiers: agencies/);
  assert.match(s, /skip these people[\s\S]*- reddit: u\/already/);
  assert.match(s, /collect_lead fields/);
  assert.match(s, /Collect the public reply first/);
});

test('the section is empty when disabled, and the brief only carries it when passed', () => {
  assert.equal(buildInvitationsSection({ brands: [brand], maxLeadsPerRun: 0 }), '');
  assert.equal(buildInvitationsSection({ brands: [], maxLeadsPerRun: 3 }), '');
  const off = buildAutonomousDiscoveryPrompt([brand], [platform], false, 50, 0.8, { search: 34, feed: 33, trending: 33 }, false, [], '', 6, '');
  assert.doesNotMatch(off, /FOUNDER INVITATIONS/);
  const on = buildAutonomousDiscoveryPrompt([brand], [platform], false, 50, 0.8, { search: 34, feed: 33, trending: 33 }, false, [], '', 6,
    buildInvitationsSection({ brands: [brand], maxLeadsPerRun: 3 }));
  assert.match(on, /FOUNDER INVITATIONS/);
  // The brand block itself now shows the ideal customer + requirements.
  assert.match(on, /- Ideal customer: solo founder with a released SaaS/);
  assert.match(on, /- Requirements to use it: a Claude Code subscription/);
});

test('schema: brand ICP fields default to empty; maxLeadsPerRun defaults to 3 within 0-10', () => {
  const b = BrandSchema.parse({ id: 'x', name: 'n' });
  assert.deepEqual([b.idealCustomer, b.requirements, b.disqualifiers], ['', '', '']);
  assert.equal(ConfigSchema.parse({}).maxLeadsPerRun, 3);
  assert.equal(ConfigSchema.parse({ maxLeadsPerRun: 0 }).maxLeadsPerRun, 0);
  assert.throws(() => ConfigSchema.parse({ maxLeadsPerRun: 11 }));
  assert.throws(() => ConfigSchema.parse({ maxLeadsPerRun: 1.5 }));
});

test('goals: the invitation rule validates, describes, and is in RULE_TYPES', () => {
  assert.ok(RULE_TYPES.includes('invitation'));
  assert.deepEqual(validateRule({ type: 'invitation', platform: 'Threads' }), { type: 'invitation', platform: 'threads' });
  assert.deepEqual(validateRule({ type: 'invitation' }), { type: 'invitation', platform: null });
  assert.equal(describeRule({ type: 'invitation', platform: 'reddit' }), 'invitations · reddit');
  assert.equal(describeRule({ type: 'invitation' }), 'invitations');
});
