// Drafts keep "\n" between lines and "\n\n" between paragraphs. These helpers
// are the seam that turns those into real line breaks in each composer type —
// a regression here posts a Reddit comment as one glued-together block.
import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownParagraphs, splitLines, insertLines } from '../lib/browser-core.js';

const DRAFT = 'Intro line. \n\nDemoDay - videos\nSocialCue - replies\nSEO - posts\n\nhttps://example.com';

test('markdownParagraphs: every newline run becomes exactly one blank line', () => {
  assert.equal(
    markdownParagraphs(DRAFT),
    'Intro line.\n\nDemoDay - videos\n\nSocialCue - replies\n\nSEO - posts\n\nhttps://example.com'
  );
  assert.equal(markdownParagraphs('a\r\nb\r\n\r\nc'), 'a\n\nb\n\nc');
  assert.equal(markdownParagraphs('a\n\n\n\nb'), 'a\n\nb');
  assert.equal(markdownParagraphs(null), '');
});

test('splitLines paragraph mode collapses runs; literal mode keeps blank lines', () => {
  assert.deepEqual(splitLines(DRAFT), ['Intro line.', 'DemoDay - videos', 'SocialCue - replies', 'SEO - posts', 'https://example.com']);
  assert.deepEqual(splitLines('a\n\nb', 'literal'), ['a', '', 'b']);
  assert.deepEqual(splitLines('a\r\nb', 'literal'), ['a', 'b']);
  assert.deepEqual(splitLines('single'), ['single']);
});

test('insertLines presses Enter between chunks and never inserts a "\\n"', async () => {
  const events = [];
  const page = {
    keyboard: {
      press: async k => events.push(`press:${k}`),
      insertText: async t => events.push(`text:${t}`),
    },
    waitForTimeout: async () => {},
  };
  await insertLines(page, 'a\n\nb\nc', 'paragraph');
  assert.deepEqual(events, ['text:a', 'press:Enter', 'text:b', 'press:Enter', 'text:c']);

  events.length = 0;
  await insertLines(page, 'a\n\nb', 'literal');
  assert.deepEqual(events, ['text:a', 'press:Enter', 'press:Enter', 'text:b']);
  assert.ok(events.every(e => !e.includes('\n')));
});
