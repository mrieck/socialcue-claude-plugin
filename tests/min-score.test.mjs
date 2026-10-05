import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAutonomousDiscoveryPrompt } from '../vendor/shared/prompts.js';
import { ConfigSchema } from '../vendor/shared/schema.js';

const brand = { name: 'B', url: 'https://b.example', tagline: 't', shortDescription: 'd', tags: [] };
const platform = { name: 'Reddit', homeUrl: 'https://www.reddit.com', hints: [], algorithmTips: [], isKnown: true };

test('the brief states the configured minimum score and the honest-scoring rule', () => {
  const brief = buildAutonomousDiscoveryPrompt([brand], [platform], false, 50, 0.8, { search: 34, feed: 33, trending: 33 }, false, [], '', 4);
  assert.match(brief, /average 4\+ \(the user's minimum score for this run\)/);
  assert.match(brief, /set the bar at 4 on purpose/);
  assert.match(brief, /Never round up to clear the bar/);
  assert.doesNotMatch(brief, /score 6\+ average/);
});

test('the minimum score defaults to 6 and rejects garbage', () => {
  for (const bad of [undefined, 0, 11, 6.5, 'seven', NaN]) {
    const brief = buildAutonomousDiscoveryPrompt([brand], [platform], false, 50, 0.8, { search: 34, feed: 33, trending: 33 }, false, [], '', bad);
    assert.match(brief, /average 6\+/, `minScore=${String(bad)} should fall back to 6`);
  }
});

test('config schema carries minScore with a default of 6 and a 1-10 range', () => {
  assert.equal(ConfigSchema.parse({}).minScore, 6);
  assert.equal(ConfigSchema.parse({ minScore: 4 }).minScore, 4);
  assert.throws(() => ConfigSchema.parse({ minScore: 0 }));
  assert.throws(() => ConfigSchema.parse({ minScore: 11 }));
  assert.throws(() => ConfigSchema.parse({ minScore: 5.5 }));
});
