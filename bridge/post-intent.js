/**
 * Assisted-posting fulfiller (Pro): open an opportunity in the DEDICATED Chrome
 * profile over CDP and pre-fill the reply box with the drafted reply.
 *
 * Submitting is opt-in per request ({ submit: true }): by default the user
 * reviews the pre-filled reply and clicks submit themselves; when they ask
 * Claude to submit, this module clicks the platform's submit control after
 * pre-filling. Either way a post only ever fires from an explicit user action
 * on an approved reply — nothing here runs unattended.
 *
 * patchright is loaded lazily (dynamic import) so the bridge itself stays a
 * zero-dependency loopback server until a post intent actually fires.
 */
import {
  DEFAULT_CDP_URL,
  DEFAULT_PROFILE_DIR,
  probeCdp,
  launchDedicatedChrome,
  withRetry,
  fillNative,
} from '../lib/browser-core.js';

// Serialize intents: two rapid dashboard clicks must not race two CDP connects.
let queue = Promise.resolve();

/** Timestamped log line into bridge.log (the bridge's stdout when detached). */
function log(...args) {
  console.log(new Date().toISOString(), '[post-intent]', ...args);
}

/**
 * @param {{platformUrl: string, suggestedReply: string}} opp
 * @param {object} config parsed .socialdiscovery/config.json
 * @param {{submit?: boolean}} [opts] submit: also click the platform's submit
 *   control after pre-filling (explicit user opt-in, per request)
 * @returns {Promise<{opened: boolean, prefilled: boolean, submitted: boolean, method: string|null, message: string}>}
 * Throws only on connection-level failures (no Chrome, CDP unreachable) —
 * prefill/submit failures resolve with the corresponding flag false.
 */
export function executePostIntent(opp, config, opts = {}) {
  const run = () => doPostIntent(opp, config, opts);
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

async function doPostIntent({ platformUrl, suggestedReply }, config, { submit = false } = {}) {
  const cdpUrl = config.browser?.cdpUrl || DEFAULT_CDP_URL;
  log(`intent start url=${platformUrl} submit=${submit} draftChars=${suggestedReply?.length ?? 0}`);

  let launched = false;
  if (!(await probeCdp(cdpUrl))) {
    log(`no Chrome at ${cdpUrl} — launching dedicated profile`);
    await launchDedicatedChrome({
      cdpUrl,
      profileDir: config.browser?.profilePath || DEFAULT_PROFILE_DIR,
      startUrl: platformUrl,
    });
    launched = true;
  }

  const { chromium } = await import('patchright');
  const browser = await withRetry(
    () => chromium.connectOverCDP(cdpUrl, { timeout: 10000 }),
    { tries: 4, baseMs: 250 }
  );

  try {
    const context = browser.contexts()[0] ?? await browser.newContext();

    // If we just launched Chrome with the target as startUrl, adopt that tab
    // instead of opening a duplicate.
    let page = null;
    if (launched) {
      const norm = u => u.replace(/\/$/, '');
      page = context.pages().find(pg => norm(pg.url()) === norm(platformUrl)) ?? null;
      if (page) await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    }
    if (!page) {
      page = await context.newPage();
      await page.goto(platformUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await page.bringToFront().catch(() => {});
    log(`page open (${launched && page ? 'adopted launch tab' : 'new tab'}) url=${page.url()}`);

    // opened = true from here on; prefill/submit failures degrade, never throw.
    let method = null;
    let submitted = false;
    let message;
    if (!suggestedReply) {
      message = 'Opened the page — this opportunity has no drafted reply.';
    } else {
      try {
        method = await prefillReply(page, suggestedReply);
        log(`prefill ${method ? `ok method=${method}` : 'skipped (unsupported platform)'}`);
        message = method
          ? 'Opened and pre-filled — review it in the browser window and click submit.'
          : 'Opened the page — no pre-fill support for this platform yet. Your draft is on the clipboard: paste it.';
      } catch (err) {
        log('prefill FAILED:', err?.stack ?? err);
        message = `Opened the page but couldn't pre-fill the reply box (${trimErr(err)}). Your draft is on the clipboard: paste it.`;
      }
      if (method && submit) {
        try {
          await submitReply(page);
          submitted = true;
          log('submit clicked ok');
          message = 'Opened, pre-filled, and clicked submit — the reply is posted.';
        } catch (err) {
          log('submit FAILED:', err?.stack ?? err);
          message = `Pre-filled, but couldn't click submit (${trimErr(err)}). Review the window and submit yourself.`;
        }
      }
    }
    log(`intent done opened=true prefilled=${!!method} submitted=${submitted}`);
    return { opened: true, prefilled: !!method, submitted, method, message };
  } finally {
    // connectOverCDP: close() only disconnects — the user's window and the
    // pre-filled tab stay open.
    await browser.close().catch(() => {});
  }
}

function trimErr(err) {
  return String(err?.message ?? err).split('\n')[0].slice(0, 200);
}

/**
 * Find and fill the reply/comment box. Returns the fill method used, or null
 * when the platform has no pre-fill support. Throws when a supported
 * platform's selectors fail (caller degrades gracefully).
 */
async function prefillReply(page, reply) {
  const host = new URL(page.url()).hostname.replace(/^www\./, '');

  if (host === 'news.ycombinator.com') {
    // Present on both item pages (add comment) and reply?id= pages.
    return fillTextarea(page, page.locator('textarea[name="text"]').first(), reply);
  }

  if (host === 'old.reddit.com') {
    return fillTextarea(page, page.locator('.commentarea textarea[name="text"]').first(), reply);
  }

  if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    // New Reddit (shreddit): open shadow roots — Playwright locators pierce
    // them. The composer is a Lexical contenteditable; keyboard.insertText is
    // the input path that reliably sticks (same finding as the MCP type_text tool).
    let box = page.locator('div[contenteditable="true"][role="textbox"]').first();
    if (!(await box.isVisible().catch(() => false))) {
      const trigger = page.locator('comment-composer-host').first();
      if (await trigger.count()) {
        await trigger.click({ timeout: 3000 }).catch(() => {});
      } else {
        await page.getByText(/join the conversation|add a comment/i).first()
          .click({ timeout: 3000 }).catch(() => {});
      }
      await box.waitFor({ state: 'visible', timeout: 5000 });
    }
    return fillContentEditable(page, box, reply);
  }

  if (host === 'twitter.com' || host === 'x.com') {
    // Tweet permalink pages render an inline "Post your reply" composer once
    // the SPA hydrates — that takes well past domcontentloaded, so wait for it
    // properly. Deliberately NO reply-icon click: that summons the modal
    // composer, which is the flaky path (and racing the click while the page
    // is still hydrating is how we ended up in it by accident).
    // X has shipped both casings of the composer testid (tweetTextArea_0 and
    // tweetTextarea_0) — match either.
    const box = page.locator('[data-testid="tweetTextarea_0"], [data-testid="tweetTextArea_0"]').first();
    await box.waitFor({ state: 'visible', timeout: 20000 });
    return fillContentEditable(page, box, reply);
  }

  if (host === 'indiehackers.com') {
    // IH post pages use a rich-text contenteditable reply editor; some older
    // thread/group UIs still render a plain textarea.
    const box = page.locator('[contenteditable="true"]').first();
    if (await box.isVisible().catch(() => false)) return fillContentEditable(page, box, reply);
    return fillTextarea(page, page.locator('textarea').first(), reply);
  }

  if (host === 'producthunt.com') {
    // Launch/discussion pages: the "What do you think…" composer is a rich-text
    // contenteditable that may be collapsed until clicked.
    let box = page.locator('[contenteditable="true"]').first();
    if (!(await box.isVisible().catch(() => false))) {
      await page.getByText(/what do you think/i).first().click({ timeout: 3000 }).catch(() => {});
      box = page.locator('[contenteditable="true"]').first();
      await box.waitFor({ state: 'visible', timeout: 5000 });
    }
    return fillContentEditable(page, box, reply);
  }

  return null; // unknown platform — open only
}

/**
 * Click the platform's submit control for the reply composer that prefillReply
 * just filled. Only called on explicit user opt-in ({ submit: true }). Throws
 * when no submit control is found (caller degrades to review-and-submit).
 */
async function submitReply(page) {
  const host = new URL(page.url()).hostname.replace(/^www\./, '');

  // Candidates are [label, locator] so the log shows what was tried and why a
  // candidate was skipped (not visible) or failed (e.g. click timeout because
  // the platform kept the button disabled).
  const clickFirstVisible = async (candidates) => {
    for (const [label, loc] of candidates) {
      const el = loc.first();
      if (!(await el.isVisible().catch(() => false))) {
        log(`submit: candidate ${label} not visible, skipping`);
        continue;
      }
      // A disabled button usually means the pre-filled text never registered
      // with the composer's state — the click below would just time out.
      const disabled = await el
        .evaluate(n => n.disabled || n.getAttribute('aria-disabled') === 'true')
        .catch(() => 'unknown');
      log(`submit: clicking ${label} (disabled=${disabled})`);
      await el.click({ timeout: 5000 });
      return true;
    }
    return false;
  };

  let clicked = false;
  if (host === 'news.ycombinator.com') {
    clicked = await clickFirstVisible([
      ['hn-submit', page.locator('form:has(textarea[name="text"]) input[type="submit"]')],
    ]);
  } else if (host === 'old.reddit.com') {
    clicked = await clickFirstVisible([
      ['save-btn', page.locator('.commentarea .usertext-buttons button.save')],
      ['form-submit', page.locator('.commentarea form:has(textarea[name="text"]) button[type="submit"]')],
    ]);
  } else if (host === 'reddit.com' || host.endsWith('.reddit.com')) {
    clicked = await clickFirstVisible([
      ['slot-submit', page.locator('button[slot="submit-button"]')],
      ['composer-submit', page.locator('shreddit-comment-composer button[type="submit"]')],
      ['comment-role', page.getByRole('button', { name: /^comment$/i })],
    ]);
  } else if (host === 'twitter.com' || host === 'x.com') {
    clicked = await clickFirstVisible([
      ['tweetButton', page.locator('[data-testid="tweetButton"]')],
      ['tweetButtonInline', page.locator('[data-testid="tweetButtonInline"]')],
    ]);
  } else {
    // Indie Hackers, Product Hunt, and anything else with a conventional
    // composer: a visible submit button labeled like a reply action.
    clicked = await clickFirstVisible([
      ['reply-role', page.getByRole('button', { name: /^(reply|comment|post|add comment|submit)$/i })],
      ['form-submit', page.locator('form button[type="submit"]')],
    ]);
  }
  if (!clicked) throw new Error('no submit control found');

  // Give the platform a beat to accept the post (full-page platforms navigate,
  // SPAs swap the composer out). Best-effort — we don't verify the comment.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
}

async function fillContentEditable(page, box, reply) {
  await box.click({ timeout: 3000 });
  try {
    await page.keyboard.insertText(reply);
    return 'insertText';
  } catch {
    await fillNative(box, reply);
    return 'native';
  }
}

async function fillTextarea(page, locator, reply) {
  await locator.waitFor({ state: 'visible', timeout: 5000 });
  try {
    await locator.fill(reply);
    return 'fill';
  } catch {
    await fillNative(locator, reply);
    return 'native';
  }
}
