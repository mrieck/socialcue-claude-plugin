import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import { openLinkOnPage } from '../../mcp/browser-server/open-link.js';

let browser, page;
const wanted = 'https://socialcue.test/@maker/post/123';
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  await page.route('https://socialcue.test/**', route => route.fulfill({
    contentType: 'text/html', body: '<h1>Conversation</h1>',
  }));
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  await page.goto('https://socialcue.test/feed');
  await page.setContent(`<a href="${wanted}">7 hours ago</a>
    <a href="https://socialcue.test/@other/post/456">7 hours ago</a>
    <button>Like</button><button>Follow</button>`);
  await page.evaluate(() => {
    window.clicks = [];
    document.addEventListener('click', event => {
      const anchor = event.composedPath().find(el => el.tagName === 'A');
      window.clicks.push(anchor?.href || event.target.textContent);
      event.preventDefault();
      if (anchor) history.pushState({}, '', anchor.href);
    });
  });
});

test('activates exactly the requested permalink and preserves SPA routing', async () => {
  const result = await openLinkOnPage(page, wanted);
  assert.equal(result.requestedUrl, wanted);
  assert.equal(result.url, wanted);
  assert.deepEqual(await page.evaluate(() => window.clicks), [wanted]);
});

test('survives replaced anchors and changed timestamp labels', async () => {
  await page.evaluate(() => {
    const original = document.querySelector('a');
    const replacement = original.cloneNode(true);
    replacement.textContent = '8 hours ago';
    original.replaceWith(replacement);
  });
  assert.equal((await openLinkOnPage(page, wanted)).label, '8 hours ago');
  assert.deepEqual(await page.evaluate(() => window.clicks), [wanted]);
});

test('missing or changed href never falls back to the same timestamp or buttons', async () => {
  await page.evaluate(() => document.querySelector('a').remove());
  await assert.rejects(openLinkOnPage(page, wanted), /No visible link/);
  assert.deepEqual(await page.evaluate(() => window.clicks), []);
});

test('finds visible exact link despite hidden duplicate and supports relative hrefs', async () => {
  await page.evaluate(() => {
    const link = document.querySelector('a');
    link.setAttribute('href', '/@maker/post/123');
    const hidden = link.cloneNode(true);
    hidden.hidden = true;
    document.body.prepend(hidden);
  });
  assert.equal((await openLinkOnPage(page, wanted)).url, wanted);
  assert.deepEqual(await page.evaluate(() => window.clicks), [wanted]);
});

test('supports anchors inside open shadow roots', async () => {
  await page.evaluate(() => {
    const link = document.querySelector('a');
    const host = document.createElement('div');
    document.body.append(host);
    host.attachShadow({ mode: 'open' }).append(link);
  });
  assert.equal((await openLinkOnPage(page, wanted)).url, wanted);
});

test('rejects action controls, downloads, disabled and new-window links without clicks', async () => {
  for (const attrs of [{role:'button'}, {download:''}, {'aria-disabled':'true'}, {target:'_blank'}]) {
    await page.evaluate(attrs => {
      const link = document.querySelector('a');
      for (const key of ['role', 'download', 'aria-disabled', 'target']) link.removeAttribute(key);
      for (const [key, value] of Object.entries(attrs)) link.setAttribute(key, value);
    }, attrs);
    await assert.rejects(openLinkOnPage(page, wanted));
  }
  assert.deepEqual(await page.evaluate(() => window.clicks), []);
});

test('rejects script, data, relative, and credential-bearing destinations', async () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hi', '/relative', 'https://user:pass@socialcue.test/']) {
    await assert.rejects(openLinkOnPage(page, url));
  }
  assert.deepEqual(await page.evaluate(() => window.clicks), []);
});

test('ordinary document navigation works as well as SPA handlers', async () => {
  await page.goto('https://socialcue.test/feed'); // Remove the SPA listener.
  await page.setContent(`<a href="${wanted}">Read post</a>`);
  await openLinkOnPage(page, wanted);
  await page.waitForURL(wanted);
  assert.equal(await page.locator('h1').innerText(), 'Conversation');
});
