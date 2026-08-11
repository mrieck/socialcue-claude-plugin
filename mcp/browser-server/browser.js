/**
 * Browser driver — connects to the user's DEDICATED Chrome profile over CDP
 * (Patchright). The user launches Chrome themselves with a debug port and is
 * already logged in; we attach, we never upload a session or launch a profile.
 *
 *   google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.socialcue-chrome"
 *
 * Ported from apify-social-media-sdk/src/browser.js, keeping the accessibility-tree
 * + stable-ref system intact. Dropped vs the original: session/cookie injection,
 * stealth init-scripts, residential proxy, video, and the sharp red-dot overlay
 * (a real signed-in browser needs none of that).
 */
import { chromium } from 'patchright';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_CDP_URL,
  DEFAULT_PROFILE_DIR,
  probeCdp,
  launchDedicatedChrome,
  withRetry,
  fillNative,
} from '../../lib/browser-core.js';

// Stateless helpers live in lib/browser-core.js (shared with the bridge's
// post-intent fulfiller); re-export the ones this server's tools use.
export { probeCdp, launchDedicatedChrome, fillNative };

let browser = null;
let context = null;
let page = null;

let lastMouseX = null;
let lastMouseY = null;

// Landing page for our automation tab so it never sits on a bare about:blank —
// a blank tab reads as "nothing is happening / it's broken". This is only ever
// visible in the gap between opening the tab and the first navigate().
const HOLDING_PAGE =
  'data:text/html,' +
  encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>Social Cue — discovery</title>
<style>
  html,body{height:100%;margin:0}
  body{display:flex;align-items:center;justify-content:center;
    font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    color:#e6edf3;background:#0d1117}
  .card{text-align:center;max-width:30rem;padding:2rem}
  .dot{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;
    background:#3fb950;margin-right:.5rem;animation:pulse 1.4s ease-in-out infinite}
  h1{font-size:1.25rem;margin:.25rem 0 .5rem;font-weight:600}
  p{margin:.25rem 0;color:#8b949e}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
</style></head>
<body><div class="card">
  <h1><span class="dot"></span>Social Cue is driving this tab</h1>
  <p>Discovery is running here — you don't need to do anything.</p>
  <p>Sign in on the other tab if a platform asks you to. Nothing is posted.</p>
</div></body></html>`
  );

// ============================================================================
// ROLE CLASSIFICATION
// ============================================================================
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'listbox',
  'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'searchbox',
  'slider', 'spinbutton', 'switch', 'tab', 'treeitem',
]);
const CONTENT_ROLES = new Set([
  'heading', 'cell', 'gridcell', 'columnheader', 'rowheader',
  'listitem', 'article', 'region', 'main', 'navigation',
]);
const STRUCTURAL_ROLES = new Set([
  'generic', 'group', 'list', 'table', 'row', 'rowgroup', 'grid',
  'treegrid', 'menu', 'menubar', 'toolbar', 'tablist', 'tree',
  'directory', 'document', 'application', 'presentation', 'none',
]);

function shouldHaveRef(node) {
  if (INTERACTIVE_ROLES.has(node.role)) return true;
  if (CONTENT_ROLES.has(node.role) && node.name) return true;
  return false;
}

// ============================================================================
// STABLE REF SYSTEM (role+name+nth based refs)
// ============================================================================
let refMap = new Map();

function clearRefs() {
  refMap.clear();
}

function buildRefMap(nodes) {
  const newRefMap = new Map();
  const roleCounts = new Map();
  for (const node of nodes) {
    if (!shouldHaveRef(node)) continue;
    const key = `${node.role}:${node.name || ''}`;
    const count = roleCounts.get(key) || 0;
    roleCounts.set(key, count + 1);
    const refId = `e${newRefMap.size + 1}`;
    newRefMap.set(refId, {
      role: node.role,
      name: node.name || '',
      nth: count > 0 ? count : undefined,
      backendNodeId: node.backendNodeId,
    });
    node.ref = refId;
  }
  return newRefMap;
}

export async function resolveRef(ref) {
  const p = getPage();
  const info = refMap.get(ref);
  if (!info) {
    throw new Error(`Unknown ref: ${ref}. Call read_page first to get available refs.`);
  }
  let locator = info.name
    ? p.getByRole(info.role, { name: info.name, exact: true })
    : p.getByRole(info.role);
  // .first() (not bare) even when nth is unset: compact mode dedupes nodes with
  // identical role+name (e.g. Reddit's title link + full-card overlay link), so
  // a ref without nth can still match several DOM elements — strict mode would throw.
  locator = info.nth !== undefined ? locator.nth(info.nth) : locator.first();
  return locator;
}

/**
 * Click a locator, with a fallback for overlay interception. Reddit (and other
 * card-based feeds) cover each post with an invisible full-card link that
 * intercepts pointer events, so Playwright's actionability check on the inner
 * title link retries until timeout. If the normal click fails and the target
 * is (or is inside) a link, follow its href; otherwise retry with force.
 */
export async function clickLocator(locator) {
  const p = getPage();
  await locator.scrollIntoViewIfNeeded();
  await moveMouseToLocator(locator);
  await p.waitForTimeout(randomDelay(50, 150));
  try {
    await locator.click({ timeout: 5000 });
  } catch (clickErr) {
    const href = await locator
      .evaluate((el) => el.closest('a')?.href || null)
      .catch(() => null);
    if (href && /^https?:\/\//.test(href)) {
      await p.goto(href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    } else {
      await locator.click({ timeout: 5000, force: true });
    }
  }
  await p.waitForTimeout(randomDelay(150, 350));
}

export async function clickRef(ref) {
  const locator = await resolveRef(ref);
  await clickLocator(locator);
  return `Clicked ref ${ref}`;
}

export async function typeRef(ref, text) {
  const p = getPage();
  const locator = await resolveRef(ref);
  await locator.scrollIntoViewIfNeeded();
  await moveMouseToLocator(locator);
  await p.waitForTimeout(randomDelay(50, 150));
  try {
    await locator.fill(text);
  } catch {
    try {
      await locator.click();
      await p.waitForTimeout(100);
      await p.keyboard.insertText(text);
    } catch {
      await fillNative(locator, text);
    }
  }
  return `Typed into ref ${ref}`;
}

export function isRef(target) {
  return /^e\d+$/.test(target);
}

// ============================================================================
// CONNECTION (connect to the user's already-running Chrome over CDP)
// ============================================================================
// The launch/probe/fill helpers were extracted to lib/browser-core.js.
// Launching stays reachable from THIS server (not lib/cli.js) on purpose: in
// Claude Cowork, Bash runs in a sandboxed VM but plugin MCP servers run
// natively on the host, so this is the only layer that can open a real window.

let connectedCdpUrl = null;

/**
 * Attach to the dedicated Chrome profile. Idempotent. Throws a clear,
 * actionable error if Chrome isn't reachable on the debug port.
 */
export async function connect(cdpUrl = DEFAULT_CDP_URL) {
  if (browser && browser.isConnected() && page && !page.isClosed()) {
    return page;
  }
  connectedCdpUrl = cdpUrl;
  try {
    browser = await withRetry(
      () => chromium.connectOverCDP(cdpUrl, { timeout: 10000 }),
      { tries: 4, baseMs: 250 }
    );
  } catch (e) {
    throw new Error(
      `Could not connect to Chrome at ${cdpUrl}. Use the launch_browser tool to start the ` +
      `dedicated profile (or launch it manually:\n` +
      `  google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.socialcue-chrome"\n` +
      `and make sure browser.cdpUrl in config matches). (${e.message})`
    );
  }

  browser.on('disconnected', () => {
    browser = null; context = null; page = null; clearRefs();
  });

  // Reuse the user's existing (logged-in) context; open our own tab in it so we
  // don't hijack a tab the user is looking at.
  const contexts = browser.contexts();
  context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  page = await context.newPage();

  // Never leave the automation tab on a bare about:blank — show a holding page so
  // the user can see the tab is ours and working, until the first navigate() lands.
  try {
    await page.goto(HOLDING_PAGE, { waitUntil: 'domcontentloaded', timeout: 5000 });
  } catch { /* non-fatal — the first real navigate() will replace it anyway */ }

  page.on('framenavigated', (frame) => {
    if (page && frame === page.mainFrame()) clearRefs();
  });

  return page;
}

/** Ensure we're connected (lazy — first browser tool triggers it). */
export async function ensureConnected() {
  return connect(connectedCdpUrl || DEFAULT_CDP_URL);
}

export function getPage() {
  if (!page) {
    throw new Error('Browser not connected. A browser tool will connect automatically; if this persists, check that Chrome is running with the debug port.');
  }
  return page;
}

export function getContext() {
  if (!context) {
    throw new Error('Browser not connected.');
  }
  return context;
}

/**
 * Read the live profile's cookies as a Playwright-style storage state, for
 * platform detection (detectLoggedInPlatforms). No upload — read from the
 * attached profile.
 */
export async function getStorageState() {
  const ctx = getContext();
  return { cookies: await ctx.cookies(), origins: [] };
}

// ============================================================================
// HUMAN-LIKE INTERACTION HELPERS
// ============================================================================
function randomDelay(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

async function smoothMouseMove(toX, toY, steps = 10) {
  const p = getPage();
  const fromX = lastMouseX ?? (toX + (Math.random() * 200 - 100));
  const fromY = lastMouseY ?? (toY + (Math.random() * 100 - 50));
  for (let i = 1; i <= steps; i++) {
    const progress = i / steps;
    const eased = 1 - Math.pow(1 - progress, 2);
    const x = fromX + (toX - fromX) * eased;
    const y = fromY + (toY - fromY) * eased;
    await p.mouse.move(Math.round(x), Math.round(y));
    await p.waitForTimeout(8 + Math.floor(Math.random() * 8));
  }
  lastMouseX = toX;
  lastMouseY = toY;
}

export async function moveMouseToLocator(locator) {
  try {
    const box = await locator.boundingBox({ timeout: 3000 });
    if (box) {
      const targetX = box.x + box.width / 2 + (Math.random() * 6 - 3);
      const targetY = box.y + box.height / 2 + (Math.random() * 4 - 2);
      await smoothMouseMove(targetX, targetY);
      return true;
    }
  } catch {
    // Element not visible, skip
  }
  return false;
}

// ============================================================================
// NAVIGATION + PAGE INFO
// ============================================================================
export async function navigate(url) {
  const p = getPage();
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(randomDelay(300, 600));
  return `Navigated to ${url}`;
}

export async function getPageInfo() {
  const p = getPage();
  return { url: p.url(), title: await p.title() };
}

// ============================================================================
// SCREENSHOTS
// ============================================================================
export async function screenshot(options = {}) {
  const p = getPage();
  const { format = 'jpeg', quality = 80 } = options;
  const buffer = await p.screenshot({
    type: format,
    quality: format === 'jpeg' ? quality : undefined,
    animations: 'disabled',
    caret: 'hide',
    timeout: 15000,
  });
  const viewport = p.viewportSize();
  return {
    data: buffer.toString('base64'),
    width: viewport?.width || 1366,
    height: viewport?.height || 768,
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
  };
}

export async function screenshotPng() {
  const p = getPage();
  // `animations: 'disabled'` finalizes infinite CSS animations/transitions so the
  // screenshot doesn't wait for a "stable" frame that never arrives — pages like
  // Reddit otherwise hang the default call to its 30s timeout. Keep a bounded
  // timeout as a backstop; the caller treats a throw as "no screenshot".
  return p.screenshot({ type: 'png', animations: 'disabled', caret: 'hide', timeout: 15000 });
}

/** Screenshot with ref badges overlaid via in-page DOM (no native deps). */
export async function screenshotWithLabels(options = {}) {
  const p = getPage();
  const { format = 'jpeg', quality = 80, maxLabels = 100 } = options;

  if (refMap.size === 0) {
    const buffer = await p.screenshot({ type: format, quality: format === 'jpeg' ? quality : undefined, animations: 'disabled', caret: 'hide', timeout: 15000 });
    const viewport = p.viewportSize();
    return {
      data: buffer.toString('base64'),
      width: viewport?.width || 1366,
      height: viewport?.height || 768,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      labelCount: 0,
      skipped: 0,
      warning: 'No refs available - call read_page first to get labels',
    };
  }

  const labels = [];
  let skipped = 0;
  for (const [ref] of refMap.entries()) {
    if (labels.length >= maxLabels) { skipped++; continue; }
    try {
      const locator = await resolveRef(ref);
      const box = await locator.boundingBox({ timeout: 500 });
      if (box && box.width > 0 && box.height > 0) {
        labels.push({ ref, x: Math.round(box.x), y: Math.round(box.y) });
      }
    } catch {
      // not visible
    }
  }

  try {
    await p.evaluate((labelData) => {
      const existing = document.getElementById('__ref_labels__');
      if (existing) existing.remove();
      const overlay = document.createElement('div');
      overlay.id = '__ref_labels__';
      overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647';
      labelData.forEach(({ ref, x, y }) => {
        const badge = document.createElement('span');
        badge.textContent = ref;
        badge.style.cssText = `position:absolute;left:${x}px;top:${y}px;background:#ff0000;color:#fff;font:bold 10px monospace;padding:1px 3px;border-radius:2px;transform:translate(-50%,-100%);white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.5)`;
        overlay.appendChild(badge);
      });
      document.body.appendChild(overlay);
    }, labels);
  } catch {
    // overlay injection failed; screenshot anyway
  }

  const buffer = await p.screenshot({ type: format, quality: format === 'jpeg' ? quality : undefined, animations: 'disabled', caret: 'hide', timeout: 15000 });
  try {
    await p.evaluate(() => { const el = document.getElementById('__ref_labels__'); if (el) el.remove(); });
  } catch {
    // ignore
  }
  const viewport = p.viewportSize();
  return {
    data: buffer.toString('base64'),
    width: viewport?.width || 1366,
    height: viewport?.height || 768,
    mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
    labelCount: labels.length,
    skipped,
  };
}

// ============================================================================
// ACCESSIBILITY TREE (CDP) — the cheap primary read path
// ============================================================================
/**
 * Landmark subtrees that are never discovery content: page header (banner),
 * footer (contentinfo), sidebars/ad rails (complementary), nav rails
 * (navigation). Skipped wholesale in compact mode so the maxNodes budget goes
 * to the main content (e.g. Reddit's shreddit-post + comment tree, which the
 * AX tree exposes across shadow DOM boundaries).
 */
const NOISE_LANDMARK_ROLES = new Set(['banner', 'contentinfo', 'complementary', 'navigation']);

/**
 * Chrome emits LayoutTable* roles for tables used purely for layout (e.g. all
 * of Hacker News). Their computed names duplicate their descendants' text
 * wholesale, so in compact mode the node itself is skipped (children are kept).
 */
const LAYOUT_ROLES = new Set(['LayoutTable', 'LayoutTableRow', 'LayoutTableCell']);

export async function getAccessibilityTree(options = {}) {
  const p = getPage();
  const { maxNodes = 500, interactive = false, compact = false, maxDepth = 40, timeout = 10000 } = options;

  const client = await withRetry(
    () => Promise.race([
      p.context().newCDPSession(p),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('CDP session creation timeout')), 5000)
      ),
    ]),
    { tries: 3, baseMs: 150 }
  );

  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('CDP accessibility timeout')), timeout)
    );
    const { nodes: axNodes } = await Promise.race([
      client.send('Accessibility.getFullAXTree'),
      timeoutPromise,
    ]);

    const getProperty = (node, propName) => node.properties?.find(pr => pr.name === propName)?.value?.value;

    // Walk the real hierarchy (getFullAXTree returns a flat list with
    // parentId/childIds) so whole noise subtrees can be pruned before they eat
    // the maxNodes budget.
    const byId = new Map(axNodes.map((n) => [n.nodeId, n]));
    const roots = axNodes.filter((n) => !n.parentId || !byId.has(n.parentId));

    const results = [];
    const seenText = new Set();   // emitted names — kills StaticText echoes of named nodes
    const seenExact = new Set();  // role:name:url — kills exact duplicate nodes (compact)
    const stack = [];
    for (let i = roots.length - 1; i >= 0; i--) stack.push({ node: roots[i], depth: 0 });

    while (stack.length > 0 && results.length < maxNodes) {
      const { node, depth } = stack.pop();
      const role = node.role?.value || 'generic';

      // Prune noise landmark subtrees entirely in compact mode.
      if (compact && NOISE_LANDMARK_ROLES.has(role)) continue;

      const children = node.childIds || [];
      for (let i = children.length - 1; i >= 0; i--) {
        const child = byId.get(children[i]);
        if (child) stack.push({ node: child, depth: depth + 1 });
      }

      if (node.ignored || depth > maxDepth) continue;
      // InlineTextBox is a text-run duplicate of its parent's text — pure noise.
      if (role === 'InlineTextBox') continue;
      if (compact && LAYOUT_ROLES.has(role)) continue;

      // AX values aren't always strings (sliders/spinbuttons report numbers).
      const name = String(node.name?.value ?? '');
      const value = node.value?.value == null ? '' : String(node.value.value);

      if (interactive && !INTERACTIVE_ROLES.has(role)) continue;
      if (compact && STRUCTURAL_ROLES.has(role) && !name) continue;
      const isInteractiveRole = INTERACTIVE_ROLES.has(role);
      if (!name && !value && !isInteractiveRole) continue;
      // A11y trees repeat a named node's text as StaticText children; drop echoes.
      if (compact && role === 'StaticText' && seenText.has(name)) continue;

      const nodeData = {
        role,
        name: name.substring(0, 200),
        value: value.substring(0, 200),
        backendNodeId: node.backendDOMNodeId,
      };
      if (role === 'link') {
        const url = getProperty(node, 'url');
        if (url) nodeData.url = String(url).substring(0, 200);
      }

      if (compact && name) {
        const exactKey = `${role}:${name}:${nodeData.url || ''}`;
        if (seenExact.has(exactKey)) continue;
        seenExact.add(exactKey);
      }
      if (name) seenText.add(name);

      const checked = getProperty(node, 'checked');
      if (checked !== undefined) nodeData.checked = checked;
      const disabled = getProperty(node, 'disabled');
      if (disabled) nodeData.disabled = true;
      const expanded = getProperty(node, 'expanded');
      if (expanded !== undefined) nodeData.expanded = expanded;
      if (role === 'heading') {
        const level = getProperty(node, 'level');
        if (level !== undefined) nodeData.level = level;
      }
      results.push(nodeData);
    }

    // Enhance inputs with placeholder text from DOM
    const placeholders = await p.evaluate(() => {
      const inputs = document.querySelectorAll('input, textarea');
      const map = {};
      inputs.forEach((input, idx) => { if (input.placeholder) map[idx] = input.placeholder; });
      return map;
    });
    let inputIdx = 0;
    for (const node of results) {
      if (['textbox', 'searchbox', 'combobox'].includes(node.role)) {
        if (placeholders[inputIdx]) node.placeholder = placeholders[inputIdx];
        inputIdx++;
      }
    }

    refMap = buildRefMap(results);
    return results;
  } finally {
    await client.detach().catch(() => {});
  }
}

export function formatTreeAsText(nodes) {
  const lines = [];
  for (const node of nodes) {
    let line = '';
    if (node.ref) line += `[${node.ref}] `;
    line += node.role;
    if (node.name) line += ` "${node.name}"`;
    const attrs = [];
    if (node.level !== undefined) attrs.push(`level=${node.level}`);
    if (node.placeholder) attrs.push(`placeholder="${node.placeholder}"`);
    if (node.value) attrs.push(`value="${node.value}"`);
    if (node.checked !== undefined) attrs.push(`checked=${node.checked}`);
    if (node.disabled) attrs.push('disabled');
    if (node.expanded !== undefined) attrs.push(`expanded=${node.expanded}`);
    if (node.url) attrs.push(`href="${node.url}"`);
    if (attrs.length > 0) line += ` [${attrs.join(', ')}]`;
    lines.push(line);
  }
  return lines.join('\n');
}

// ============================================================================
// INTERACTION (ref-first, text fallback)
// ============================================================================
export async function click(target) {
  const p = getPage();
  if (isRef(target)) return clickRef(target);

  const strategies = [
    () => p.getByRole('button', { name: target }),
    () => p.getByRole('link', { name: target }),
    () => p.getByRole('textbox', { name: target }),
    () => p.getByRole('searchbox', { name: target }),
    () => p.getByRole('combobox', { name: target }),
    () => p.getByText(target, { exact: true }),
    () => p.getByLabel(target),
    () => p.locator(`[aria-label="${target}"]`),
    () => p.locator(`text="${target}"`),
  ];
  for (const getLocator of strategies) {
    try {
      const locator = getLocator();
      if (await locator.count() > 0) {
        await clickLocator(locator.first());
        return `Clicked on "${target}"`;
      }
    } catch {
      // next strategy
    }
  }
  throw new Error(`Could not find element: ${target}. Try read_page first to get refs like e1, e2.`);
}

export async function clickAt(x, y) {
  const p = getPage();
  await smoothMouseMove(x, y);
  await p.waitForTimeout(randomDelay(50, 150));
  await p.mouse.click(x, y);
  await p.waitForTimeout(randomDelay(150, 350));
  return `Clicked at (${x}, ${y})`;
}

export async function type(target, text) {
  const p = getPage();
  if (isRef(target)) {
    await typeRef(target, text);
    return `Typed into ref ${target}`;
  }
  const strategies = [
    () => p.getByRole('textbox', { name: target }),
    () => p.getByLabel(target),
    () => p.getByPlaceholder(target),
    () => p.locator(`[aria-label="${target}"]`),
    () => p.locator(`[placeholder="${target}"]`),
  ];
  for (const getLocator of strategies) {
    try {
      const locator = getLocator();
      if (await locator.count() > 0) {
        await locator.first().scrollIntoViewIfNeeded();
        await moveMouseToLocator(locator.first());
        await p.waitForTimeout(randomDelay(50, 150));
        try {
          await locator.first().fill(text);
        } catch {
          try {
            await locator.first().click();
            await p.waitForTimeout(100);
            await p.keyboard.insertText(text);
          } catch {
            await fillNative(locator.first(), text);
          }
        }
        return `Typed into "${target}"`;
      }
    } catch {
      // next strategy
    }
  }
  throw new Error(`Could not find input: ${target}. Try read_page first to get refs like e1, e2.`);
}

export async function scroll(direction, amount = 300) {
  const p = getPage();
  const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
  const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
  await p.evaluate(({ dx, dy }) => window.scrollBy(dx, dy), { dx: deltaX, dy: deltaY });
  await p.waitForTimeout(randomDelay(150, 300));
  return `Scrolled ${direction} by ${amount}px`;
}

export async function pressKey(key) {
  const p = getPage();
  await p.keyboard.press(key);
  return `Pressed key: ${key}`;
}

export async function wait(ms) {
  const p = getPage();
  await p.waitForTimeout(ms);
  return `Waited ${ms}ms`;
}

// ============================================================================
// FILE UPLOAD (for the posting flow — images/video)
// ============================================================================
/**
 * Upload local file(s) to a file input. `target` is a ref (from read_page) or a
 * CSS selector for the <input type=file>. Paths must be absolute and exist.
 */
export async function uploadFile(target, files) {
  const list = Array.isArray(files) ? files : [files];
  if (list.length === 0) throw new Error('No files provided to upload.');
  for (const f of list) {
    if (!path.isAbsolute(f)) throw new Error(`Upload path must be absolute: ${f}`);
    if (!fs.existsSync(f)) throw new Error(`File not found: ${f}`);
  }
  const locator = isRef(target) ? await resolveRef(target) : getPage().locator(target);
  await locator.setInputFiles(list);
  return `Uploaded ${list.length} file(s) to ${target}`;
}

// ============================================================================
// RAW CDP PASSTHROUGH (escape hatch — any DevTools Protocol command)
// ============================================================================
export async function rawCdp(method, params = {}) {
  const p = getPage();
  const client = await p.context().newCDPSession(p);
  try {
    return await client.send(method, params);
  } finally {
    await client.detach().catch(() => {});
  }
}

/** Disconnect from the user's browser WITHOUT closing it (it's theirs). */
export async function closeBrowser() {
  try {
    if (page && !page.isClosed()) await page.close(); // close only our tab
  } catch {
    // ignore
  }
  try {
    if (browser && browser.isConnected()) await browser.close(); // disconnect CDP
  } catch {
    // ignore
  }
  browser = null; context = null; page = null; clearRefs();
}
