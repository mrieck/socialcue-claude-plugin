import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'patchright';
import { installDialogPolicy, pendingDialog, handleDialog } from '../../mcp/browser-server/dialog-policy.js';

let browser, context;
before(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext();
  installDialogPolicy(context);
});
after(async () => { await browser?.close(); });

const settle = () => new Promise(r => setTimeout(r, 200));

test('a confirm stays open, is reported as pending, and accept answers it', async () => {
  const page = await context.newPage();
  const answer = page.evaluate(() => window.confirm('Delete this post?'));
  await settle();
  assert.deepEqual(
    (({ type, message }) => ({ type, message }))(pendingDialog(page)),
    { type: 'confirm', message: 'Delete this post?' },
  );
  await handleDialog(page, 'accept');
  assert.equal(await answer, true);
  assert.equal(pendingDialog(page), null);
  await page.close();
});

test('a prompt takes text on accept; dismiss returns null', async () => {
  const page = await context.newPage();
  const first = page.evaluate(() => window.prompt('Name?'));
  await settle();
  await handleDialog(page, 'accept', 'everydaylentils');
  assert.equal(await first, 'everydaylentils');
  const second = page.evaluate(() => window.prompt('Name?'));
  await settle();
  await handleDialog(page, 'dismiss');
  assert.equal(await second, null);
  await page.close();
});

test('handling with nothing open is an error', async () => {
  const page = await context.newPage();
  await assert.rejects(handleDialog(page, 'accept'), /No dialog is open/);
  await page.close();
});
