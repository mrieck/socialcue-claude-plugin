// markdown-lite feeds insert_html: every block must become a real element and
// blank lines must never turn into empty paragraphs (rich editors double them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHtml, inlineToHtml } from '../lib/markdown-lite.js';

test('headings, paragraphs and blank lines', () => {
  const html = markdownToHtml('# Title\n\n## Section\n\nOne two.\nStill one.\n\n\n\nTwo.');
  assert.equal(html, '<h1>Title</h1><h2>Section</h2><p>One two. Still one.</p><p>Two.</p>');
});

test('headings: bold renders a strong paragraph for editors without heading styles', () => {
  assert.equal(markdownToHtml('## KPIs are Outside of your Control', { headings: 'bold' }),
    '<p><strong>KPIs are Outside of your Control</strong></p>');
});

test('inline: bold, italic, strike, code, links, images, escaping', () => {
  assert.equal(inlineToHtml('a **b** *c* ~~d~~ `x<y` [t](https://e.com) ![alt](https://i.png) 1 < 2'),
    'a <strong>b</strong> <em>c</em> <s>d</s> <code>x&lt;y</code> <a href="https://e.com">t</a> <img src="https://i.png" alt="alt"> 1 &lt; 2');
  assert.equal(inlineToHtml('snake_case_name stays'), 'snake_case_name stays');
});

test('lists, blockquote, fence, hr', () => {
  const html = markdownToHtml('- one\n- two\n  cont\n\n1. a\n2. b\n\n> quoted\n> more\n\n```\nif (a<b) {}\n```\n\n---\n\nend');
  assert.equal(html,
    '<ul><li>one</li><li>two cont</li></ul><ol><li>a</li><li>b</li></ol><blockquote><p>quoted more</p></blockquote><pre><code>if (a&lt;b) {}</code></pre><hr><p>end</p>');
});

test('content-library artifacts are cleaned (CRLF, &#x20;)', () => {
  assert.equal(markdownToHtml('a\r\n\r\nb &#x20;'), '<p>a</p><p>b</p>');
});
