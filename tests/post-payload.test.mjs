// buildPostPayload is the seam that turns one content item into a Postiz
// create-post payload. These tests pin the per-channel variant merge and the
// platform-required setting defaults — a regression here 400s real schedules
// (or silently posts the wrong caption to the wrong platform).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPostPayload } from '../lib/postiz-client.js';

const IDS = { yt: 'yt-1', tt: 'tt-1', ig: 'ig-1', igs: 'igs-1', x: 'x-1', mb: 'mb-1' };
const identifierById = {
  [IDS.yt]: 'youtube',
  [IDS.tt]: 'tiktok',
  [IDS.ig]: 'instagram',
  [IDS.igs]: 'instagram-standalone',
  [IDS.x]: 'x',
  [IDS.mb]: 'mastodon',
};

const postFor = (payload, id) => payload.posts.find(p => p.integration.id === id);

test('variant content overrides body; channels without a variant fall back', () => {
  const payload = buildPostPayload(
    {
      title: 'My video', body: 'shared caption',
      channels: [IDS.yt, IDS.tt],
      variants: { [IDS.yt]: { content: 'youtube description' } },
    },
    { identifierById }
  );
  assert.equal(postFor(payload, IDS.yt).value[0].content, 'youtube description');
  assert.equal(postFor(payload, IDS.tt).value[0].content, 'shared caption');
});

test('settings precedence: defaults < settings[id] < variants[id].settings', () => {
  const payload = buildPostPayload(
    {
      title: 'Fallback title', body: 'b',
      channels: [IDS.yt],
      settings: { [IDS.yt]: { type: 'unlisted', selfDeclaredMadeForKids: 'no' } },
      variants: { [IDS.yt]: { settings: { title: 'Real YT title' } } },
    },
    { identifierById }
  );
  const s = postFor(payload, IDS.yt).settings;
  assert.equal(s.__type, 'youtube');
  assert.equal(s.title, 'Real YT title');          // variant beats default
  assert.equal(s.type, 'unlisted');                // settings[id] beats default
  assert.equal(s.selfDeclaredMadeForKids, 'no');   // settings[id] preserved
});

test('YouTube defaults: required title from item.title, public visibility', () => {
  const payload = buildPostPayload(
    { title: 'My working title', body: 'b', channels: [IDS.yt] },
    { identifierById }
  );
  const s = postFor(payload, IDS.yt).settings;
  assert.equal(s.title, 'My working title');
  assert.equal(s.type, 'public');
});

test('YouTube title fallback is clamped to the 2-100 char requirement', () => {
  const long = buildPostPayload(
    { title: 'x'.repeat(150), body: 'b', channels: [IDS.yt] },
    { identifierById }
  );
  assert.equal(postFor(long, IDS.yt).settings.title.length, 100);
  const empty = buildPostPayload(
    { title: '', body: 'b', channels: [IDS.yt] },
    { identifierById }
  );
  assert.equal(postFor(empty, IDS.yt).settings.title, 'Untitled');
});

test('TikTok defaults carry the full validator-required set with DIRECT_POST', () => {
  const s = postFor(
    buildPostPayload({ body: 'b', channels: [IDS.tt] }, { identifierById }),
    IDS.tt
  ).settings;
  assert.deepEqual(s, {
    __type: 'tiktok',
    privacy_level: 'PUBLIC_TO_EVERYONE',
    duet: true, stitch: true, comment: true,
    autoAddMusic: 'no',
    brand_content_toggle: false, brand_organic_toggle: false,
    content_posting_method: 'DIRECT_POST',
  });
});

test('Instagram and instagram-standalone both default post_type with their own __type', () => {
  const payload = buildPostPayload({ body: 'b', channels: [IDS.ig, IDS.igs] }, { identifierById });
  assert.deepEqual(postFor(payload, IDS.ig).settings, { __type: 'instagram', post_type: 'post' });
  assert.deepEqual(postFor(payload, IDS.igs).settings, { __type: 'instagram-standalone', post_type: 'post' });
});

test('X keeps who_can_reply_post; unknown identifiers get bare __type', () => {
  const payload = buildPostPayload({ body: 'b', channels: [IDS.x, IDS.mb] }, { identifierById });
  assert.deepEqual(postFor(payload, IDS.x).settings, { __type: 'x', who_can_reply_post: 'everyone' });
  assert.deepEqual(postFor(payload, IDS.mb).settings, { __type: 'mastodon' });
});

test('images attach to every channel and the envelope keeps shortLink/tags', () => {
  const images = [{ id: 'u1', path: 'https://uploads.postiz.com/v.mp4' }];
  const payload = buildPostPayload(
    { body: 'b', channels: [IDS.yt, IDS.ig] },
    { identifierById, images, type: 'draft', date: '2026-08-25T15:00:00.000Z' }
  );
  assert.equal(payload.type, 'draft');
  assert.equal(payload.date, '2026-08-25T15:00:00.000Z');
  assert.equal(payload.shortLink, false);
  assert.deepEqual(payload.tags, []);
  for (const p of payload.posts) assert.deepEqual(p.value[0].image, images);
});
