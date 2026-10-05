import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagLinks, ownHostsFromBrands, utmSourceFor } from '../lib/utm.js';
import { buildPostPayload } from '../lib/postiz-client.js';

const own = ownHostsFromBrands([
  { url: 'https://www.trysocialcue.com', pricingUrl: 'https://trysocialcue.com/pricing/' },
  { url: 'https://tryoverboard.com' },
  { url: '' },
]);
const opts = { source: 'threads', campaign: 'socialcue', content: 'item-1', ownHosts: own };
const TAGS = 'utm_source=threads&utm_medium=social&utm_campaign=socialcue&utm_content=item-1';

test('own hosts come from brand urls; utm_source is the normalized platform', () => {
  assert.deepEqual([...own].sort(), ['tryoverboard.com', 'trysocialcue.com']);
  assert.equal(utmSourceFor('instagram-standalone'), 'instagram');
  assert.equal(utmSourceFor('twitter'), 'x');
  assert.equal(utmSourceFor(undefined), 'postiz');
});

test('tagLinks tags only own-site links and leaves punctuation, fragments and manual tags alone', () => {
  assert.equal(
    tagLinks('See [docs](https://trysocialcue.com/docs/#activate). Then https://tryoverboard.com/plugin! Not https://example.com/x', opts),
    `See [docs](https://trysocialcue.com/docs/?${TAGS}#activate). Then https://tryoverboard.com/plugin?${TAGS}! Not https://example.com/x`
  );
  assert.equal(tagLinks('https://trysocialcue.com/pricing/?ref=dashboard', opts), `https://trysocialcue.com/pricing/?ref=dashboard&${TAGS}`);
  const manual = 'https://trysocialcue.com/?utm_source=indiehackers&utm_content=article-01';
  assert.equal(tagLinks(manual, opts), manual);
  assert.equal(tagLinks('https://trysocialcue.com/', { ...opts, ownHosts: new Set() }), 'https://trysocialcue.com/');
});

test('buildPostPayload tags per channel with its own utm_source, and not at all when utm is null', () => {
  const item = {
    channels: ['t1', 'y1'],
    body: 'New post https://trysocialcue.com/',
    variants: { y1: { content: 'YouTube version https://trysocialcue.com/docs/' } },
  };
  const ids = { t1: 'threads', y1: 'youtube' };
  const tagged = buildPostPayload(item, { date: 'd', identifierById: ids, utm: { campaign: 'socialcue', content: 'item-9', ownHosts: own } });
  assert.equal(tagged.posts[0].value[0].content, 'New post https://trysocialcue.com/?utm_source=threads&utm_medium=social&utm_campaign=socialcue&utm_content=item-9');
  assert.equal(tagged.posts[1].value[0].content, 'YouTube version https://trysocialcue.com/docs/?utm_source=youtube&utm_medium=social&utm_campaign=socialcue&utm_content=item-9');
  const off = buildPostPayload(item, { date: 'd', identifierById: ids });
  assert.equal(off.posts[0].value[0].content, 'New post https://trysocialcue.com/');
});
