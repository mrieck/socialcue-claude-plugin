/**
 * Social Cue browser MCP server (stdio).
 *
 * Exposes the browser tool surface (navigate / read_page / click / type / scroll /
 * screenshot / …) plus local discovery tools:
 *   - launch_browser : start the dedicated Chrome profile (detached, host-side)
 *   - collect_opportunity : screenshot + write to local SQLite (no Apify/KV)
 *   - get_logged_in_platforms : detect logins from the attached profile's cookies
 *   - like_content : available, but discovery stays read-only by policy
 *   - list_tabs / open_tab / switch_tab / close_tab : side trips in a 2nd tab
 *     (e.g. the user's webmail for a signup verification code)
 *
 * Connects to the user's dedicated Chrome over CDP (see browser.js). The CDP url
 * comes from .socialdiscovery/config.json (browser.cdpUrl). This server does no
 * inference and needs no API key — Claude Code (the user's auth) runs the loop.
 *
 * Ported from apify-social-media-sdk/src/mcp-server.js.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import * as browser from './browser.js';
import * as ocr from './ocr.js'; // safe at top level — its heavy deps import lazily
import * as db from '../../lib/db.js';
import * as paths from '../../lib/paths.js';
import { loadConfig, resolveBrand } from '../../lib/config.js';
import { detectLoggedInPlatforms } from '../../vendor/shared/platforms.js';

// ---- logging (stderr + file) ----
const LOG_FILE = path.join(paths.ensureBaseDir(), 'mcp-server.log');
fs.writeFileSync(LOG_FILE, `[MCP] started ${new Date().toISOString()}\n`);
function log(msg, data = null) {
  let line = `[${new Date().toISOString()}] ${msg}`;
  if (data !== null) line += `\n${typeof data === 'string' ? data : JSON.stringify(data, null, 2)}`;
  console.error(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch { /* ignore */ }
}

// ---- config / connection ----
let CDP_URL = process.env.SOCIALCUE_CDP_URL || 'http://127.0.0.1:9222';
let PROFILE_DIR; // undefined → launcher default (~/.socialcue-chrome)
try {
  const browserConfig = loadConfig().browser;
  CDP_URL = browserConfig.cdpUrl || CDP_URL;
  PROFILE_DIR = browserConfig.profilePath;
} catch (e) {
  log(`[MCP] could not load config, using default CDP ${CDP_URL}: ${e.message}`);
}

async function ensure() {
  await browser.connect(CDP_URL);
}

// ---- keyboard normalization ----
const isMac = os.platform() === 'darwin';
const KEY_MAP = {
  control: 'Control', ctrl: 'Control', alt: 'Alt', shift: 'Shift', meta: 'Meta',
  cmd: 'Meta', command: 'Meta', backspace: 'Backspace', delete: 'Delete',
  enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape',
  space: ' ', arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight', pagedown: 'PageDown', pageup: 'PageUp', home: 'Home', end: 'End',
};
function normalizeKeys(keys) {
  const normalized = keys.split('+').map(p => KEY_MAP[p.toLowerCase()] || p).join('+');
  let result = normalized;
  if (isMac) {
    for (const letter of ['a', 'c', 'v', 'x', 'z']) {
      if (result.toLowerCase() === `control+${letter}`) { result = `Meta+${letter}`; break; }
    }
  }
  return result;
}

// ---- stale-code detection ----
// The MCP server is a long-lived process; editing server.js/browser.js does
// not reload it. Compare source mtimes against process start and say so on
// every response, otherwise a fix on disk looks like a fix that didn't work.
const SERVER_STARTED_AT = Date.now();
const SOURCE_FILES = ['server.js', 'browser.js', 'ocr.js'].map(f => path.join(path.dirname(new URL(import.meta.url).pathname), f));
let staleCheckedAt = 0, staleFiles = [];
function staleSources() {
  const now = Date.now();
  if (now - staleCheckedAt > 5000) {
    staleCheckedAt = now;
    staleFiles = SOURCE_FILES.filter(f => { try { return fs.statSync(f).mtimeMs > SERVER_STARTED_AT; } catch { return false; } }).map(f => path.basename(f));
  }
  return staleFiles;
}
function withStale(obj) {
  const stale = staleSources();
  return stale.length
    ? { ...obj, staleCode: stale, warning: `browser-server source changed after this process started (${stale.join(', ')}) — running old code. Restart the MCP server (/mcp → reconnect, or a new session) to load the fix.` }
    : obj;
}

// ---- response helpers ----
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify(withStale({ success: true, ...obj })) }] });
const err = (e) => ({ content: [{ type: 'text', text: JSON.stringify(withStale({ success: false, error: e.message || String(e) })) }], isError: true });

async function startMcpServer() {
  log(`[MCP] starting; CDP=${CDP_URL}`);

  const server = new McpServer({
    name: 'socialcue-browser',
    version: '0.1.0',
    capabilities: { tools: {} },
  });

  // ============================== CORE BROWSER TOOLS ==============================

  server.tool('navigate', 'Navigate the active tab to a URL (see open_tab / switch_tab for side trips that must not disturb the current page).',
    { url: z.string().describe('The URL to navigate to') },
    async ({ url }) => {
      try { await ensure(); const msg = await browser.navigate(url); const info = await browser.getPageInfo();
        return ok({ message: msg, title: info.title, url: info.url }); }
      catch (e) { return err(e); }
    });

  server.tool('read_page',
    `Get the accessibility tree of the current page as text with refs (e1, e2…) for interactive elements. MUCH cheaper than screenshots — use this as your primary way to understand a page.
Use the refs with click("e3") / type("e3", text) / act. Refs are bound to the element (data-sc-ref), so they survive React re-renders and only reset when the page navigates; a ref that vanished fails fast with a hint. Nodes that belong to the site's global search UI are tagged [site-search] — never type into or click those when filling a form.
Options: interactive (only clickable elements), compact (drop unnamed structure), maxDepth.`,
    {
      interactive: z.boolean().optional().describe('Only return interactive elements'),
      compact: z.boolean().optional().describe('Remove unnamed structural elements'),
      maxDepth: z.number().optional().describe('Maximum tree depth (default 40)'),
    },
    async ({ interactive, compact, maxDepth }) => {
      try {
        await ensure();
        const nodes = await browser.getAccessibilityTree({ interactive: !!interactive, compact: !!compact, maxDepth: maxDepth || 40 });
        const treeText = browser.formatTreeAsText(nodes);
        const info = await browser.getPageInfo();
        const refCount = nodes.filter(n => n.ref).length;
        return { content: [{ type: 'text', text: `Page: ${info.title} (${info.url})\n\nAccessibility Tree (${nodes.length} elements, ${refCount} refs):\n${treeText}\n\nTip: use refs like "e1" with click()/type().` }] };
      } catch (e) { return err(e); }
    });

  server.tool('screenshot',
    'Take a screenshot. Use sparingly — read_page is cheaper. labels=true overlays ref badges (e1, e2…) for debugging.',
    { labels: z.boolean().optional().describe('Overlay ref labels for debugging') },
    async ({ labels }) => {
      try {
        await ensure();
        const data = labels ? await browser.screenshotWithLabels() : await browser.screenshot();
        let text = `Screenshot (${data.width}x${data.height})`;
        if (data.labelCount !== undefined) text += ` — ${data.labelCount} labels${data.skipped ? ` (${data.skipped} skipped)` : ''}`;
        if (data.warning) text += `\n⚠️ ${data.warning}`;
        return { content: [{ type: 'text', text }, { type: 'image', data: data.data, mimeType: data.mimeType }] };
      } catch (e) { return err(e); }
    });

  server.tool('read_image_text',
    `Read the text inside images and video frames on the current page using LOCAL OCR (tesseract on this machine — free, near-instant, zero vision tokens). Use this instead of screenshot when a post's content lives in an image, meme, screenshot, chart, or video: it returns a plain-text transcript of the largest visible media, largest first. Text may be garbled — interpret charitably; null text means nothing readable (e.g. a photo). Pass useful text on to collect_opportunity as ocrText.`,
    { maxImages: z.number().int().min(1).max(6).optional().describe('Max media elements to OCR, largest first (default 3)') },
    async ({ maxImages }) => {
      try {
        await ensure();
        if (!ocr.modelAvailable()) return err(ocr.missingModelError());
        const media = await browser.findVisibleMedia({ max: maxImages || 3 });
        if (!media.length) {
          return ok({ results: [], message: 'No suitable images/videos in view (min 200px). Scroll the media into view and retry.' });
        }
        const results = [];
        try {
          for (const m of media) {
            let text = '';
            try {
              const png = await browser.screenshotMediaElement(m.index);
              text = await ocr.recognize(await ocr.decodePng(png));
            } catch (e) {
              log(`[read_image_text] element ${m.index} (${m.kind}) failed: ${e.message}`);
            }
            results.push({ index: m.index, kind: m.kind, label: m.label || undefined, text: text || null });
          }
        } finally {
          await browser.clearMediaTags();
        }
        return ok({ results, note: 'Local OCR — may be garbled, interpret charitably. null text = nothing readable.' });
      } catch (e) { return err(e); }
    });

  server.tool('click',
    'Click an element. target = a ref from read_page (e.g. "e3"), a CSS selector (#id, [name=x], button.primary), or visible text/label (exact match first, then loose). Fails fast when nothing matches.',
    { target: z.string().describe('Ref (e1), CSS selector, or visible text/label') },
    async ({ target }) => { try { await ensure(); return ok({ message: await browser.click(target) }); } catch (e) { return err(e); } });

  server.tool('click_at', 'Click at specific x,y coordinates.',
    { x: z.number(), y: z.number() },
    async ({ x, y }) => { try { await ensure(); return ok({ message: await browser.clickAt(x, y) }); } catch (e) { return err(e); } });

  server.tool('type',
    'Type text into an input. target = ref (e3), CSS selector (#react-select-tags-input, [name=email]), or label/placeholder (exact, then loose). Handles standard and contenteditable inputs. For React forms that ignore typed input, use set_value.',
    { target: z.string().describe('Ref, CSS selector, or label/placeholder of the input'), text: z.string() },
    async ({ target, text }) => { try { await ensure(); return ok({ message: await browser.type(target, text) }); } catch (e) { return err(e); } });

  server.tool('type_text',
    'Type into the currently focused input (instant paste). Use after clicking an input whose ref goes stale (Reddit/Twitter composers).',
    { text: z.string(), clear: z.boolean().optional().describe('Clear existing content first') },
    async ({ text, clear }) => {
      try {
        await ensure();
        const page = browser.getPage();
        if (clear) { await page.keyboard.press('Control+a'); await page.waitForTimeout(50); }
        await page.keyboard.insertText(text);
        return ok({ message: `Typed "${text.substring(0, 50)}${text.length > 50 ? '…' : ''}"` });
      } catch (e) { return err(e); }
    });

  server.tool('act',
    'Perform an action on an element. ref = a read_page ref (e3), a CSS selector, or a label. actions: click, fill, check, uncheck, select (by option value or visible text), hover. Fails fast when the element is gone.',
    { ref: z.string().describe('Ref, CSS selector, or label'), action: z.enum(['click', 'fill', 'check', 'uncheck', 'select', 'hover']), value: z.string().optional() },
    async ({ ref, action, value }) => {
      try {
        await ensure();
        const locator = await browser.resolveTarget(ref);
        const page = browser.getPage();
        const T = { timeout: 2500 };
        switch (action) {
          case 'click':
            await browser.clickLocator(locator); return ok({ message: `Clicked ${ref}` });
          case 'fill':
            if (value === undefined) throw new Error('value required for fill');
            await locator.scrollIntoViewIfNeeded(T); await browser.moveMouseToLocator(locator);
            try { await locator.fill(value, T); }
            catch {
              try { await locator.click(T); await page.waitForTimeout(100); await page.keyboard.insertText(value); }
              catch { await browser.fillNative(locator, value); }
            }
            return ok({ message: `Filled ${ref}` });
          case 'check': await locator.scrollIntoViewIfNeeded(T); await locator.check(T); return ok({ message: `Checked ${ref}` });
          case 'uncheck': await locator.scrollIntoViewIfNeeded(T); await locator.uncheck(T); return ok({ message: `Unchecked ${ref}` });
          case 'select': {
            if (!value) throw new Error('value required for select');
            try { await locator.selectOption(value, T); }
            catch { try { await locator.selectOption({ label: value.trim() }, T); } catch { await browser.setValue(ref, value.trim()); } }
            return ok({ message: `Selected in ${ref}` });
          }
          case 'hover': await browser.moveMouseToLocator(locator); await locator.hover(); return ok({ message: `Hovered ${ref}` });
          default: throw new Error(`Unknown action: ${action}`);
        }
      } catch (e) { return err(e); }
    });

  server.tool('set_value',
    'Set a form field the way React/Vue expect (native value setter + input/change events). Use when act/type fill an input but the framework ignores it, for fields whose accessible name blocks other locators, or for <select>s by option text. target = ref, CSS selector, or label. Checkboxes: value "true"/"false". Returns the value the DOM holds afterwards.',
    { target: z.string().describe('Ref, CSS selector, or label'), value: z.string() },
    async ({ target, value }) => { try { await ensure(); const r = await browser.setValue(target, value); return ok({ target, ...r }); } catch (e) { return err(e); } });

  server.tool('select_option',
    'Drive a typeahead / autocomplete / tag picker (react-select, MUI, etc.): focuses the input, types the query, waits for suggestions, and clicks the one whose text matches `option` (default: the query) EXACTLY — never by position, so "Windows" cannot pick "Windows Phone". Trailing meta like "Used on 12 apps" is ignored. Returns all suggestions seen, what was picked, and the chips now selected. Pass option "" to only list suggestions.',
    {
      target: z.string().describe('Ref, CSS selector (#react-select-tags-input), or label of the typeahead input'),
      query: z.string().describe('Text to type'),
      option: z.string().optional().describe('Exact suggestion text to pick (default: query). "" = list only, click nothing'),
      exact: z.boolean().optional().describe('false = allow a startsWith match when nothing matches exactly'),
      waitMs: z.number().optional().describe('ms to wait for suggestions (default 1500)'),
    },
    async ({ target, query, option, exact, waitMs }) => {
      try {
        await ensure();
        const r = await browser.selectOption(target, query, { option: option === '' ? null : option, exact: exact !== false, waitMs: waitMs || 1500 });
        return ok(r);
      } catch (e) { return err(e); }
    });

  server.tool('press_key',
    'Press a key or combination. Examples: Enter, Tab, Escape, ArrowDown, Control+a. On Mac, Control+a/c/v/x/z auto-convert to Meta.',
    { key: z.string() },
    async ({ key }) => { try { await ensure(); return ok({ message: await browser.pressKey(normalizeKeys(key)) }); } catch (e) { return err(e); } });

  server.tool('scroll', 'Scroll the page.',
    { direction: z.enum(['up', 'down', 'left', 'right']), amount: z.number().optional().default(300) },
    async ({ direction, amount }) => { try { await ensure(); return ok({ message: await browser.scroll(direction, amount) }); } catch (e) { return err(e); } });

  server.tool('wait', 'Wait for a duration (max 30s) for loads/animations.',
    { seconds: z.number() },
    async ({ seconds }) => { try { await ensure(); await browser.wait(Math.min(seconds, 30) * 1000); return ok({ message: `Waited ${seconds}s` }); } catch (e) { return err(e); } });

  server.tool('get_page_info', 'Get the current page URL and title.', {},
    async () => { try { await ensure(); return ok(await browser.getPageInfo()); } catch (e) { return err(e); } });

  // ============================== TABS ==============================
  // Side trips: e.g. open the user's webmail in a 2nd tab to read a signup
  // verification code, then switch back to the form with its state intact.

  server.tool('list_tabs',
    'List the Social Cue browser tabs (id, index, active, url, title). Ids are small integers that stay stable until the tab is closed. Popups the site opened (OAuth "Continue with Google", target=_blank mail links) appear here too — switch_tab to drive them.',
    {},
    async () => { try { await ensure(); return ok({ tabs: await browser.listTabs() }); } catch (e) { return err(e); } });

  server.tool('open_tab',
    'Open a NEW tab and make it active, leaving the current tab (and any half-filled form) untouched. Use for side trips such as opening the user\'s webmail (e.g. https://mail.google.com) to fetch a signup verification code or link, then switch_tab back. Refs from read_page are invalidated — run read_page again.',
    { url: z.string().optional().describe('URL to open in the new tab. Omit for a blank holding page.') },
    async ({ url }) => { try { await ensure(); const tab = await browser.openTab(url); return ok({ tab, message: `Opened tab ${tab.id}${url ? ` on ${tab.url}` : ''} (now active)` }); } catch (e) { return err(e); } });

  server.tool('switch_tab',
    'Make another open tab the active one; every subsequent tool (navigate, read_page, click, type, screenshot, ...) acts on it. Invalidates refs (e1, e2, ...) — call read_page again. Errors if that tab was closed; use list_tabs.',
    { id: z.number().int().describe('Tab id from list_tabs / open_tab') },
    async ({ id }) => { try { await ensure(); const tab = await browser.switchTab(id); return ok({ tab, message: `Tab ${tab.id} is now active (${tab.url})` }); } catch (e) { return err(e); } });

  server.tool('close_tab',
    'Close a tab (default: the active one), e.g. the webmail tab once the code is read. Refuses to close the last tab — navigate it instead. If the active tab is closed, the previously active tab becomes active; run read_page again.',
    { id: z.number().int().optional().describe('Tab id to close (default: the active tab)') },
    async ({ id }) => { try { await ensure(); const r = await browser.closeTab(id); return ok({ ...r, message: `Closed tab ${r.closed}${r.active ? `; tab ${r.active.id} is active (${r.active.url})` : ''}` }); } catch (e) { return err(e); } });

  server.tool('upload',
    'Upload local file(s) to a file input (for the posting flow — images/video). target is a ref from read_page (e.g. "e3") or a CSS selector for the <input type=file> — make it specific when a page has several (input[name=screenshot]). Paths must be absolute. Use either this OR a site\'s "upload by URL" field for a given image, never both.',
    { target: z.string().describe('Ref (e.g. e3) or CSS selector of the file input'), files: z.array(z.string()).describe('Absolute file paths to upload') },
    async ({ target, files }) => { try { await ensure(); return ok({ message: await browser.uploadFile(target, files) }); } catch (e) { return err(e); } });

  server.tool('cdp',
    'Advanced escape hatch: send a raw Chrome DevTools Protocol command against the current page and return the JSON result (e.g. method="Network.getAllCookies"). Use only when no dedicated tool exists.',
    { method: z.string().describe('CDP method, e.g. Network.getAllCookies'), params: z.record(z.any()).optional().describe('CDP params object') },
    async ({ method, params }) => { try { await ensure(); const result = await browser.rawCdp(method, params || {}); return ok({ method, result }); } catch (e) { return err(e); } });

  // ============================== BROWSER LIFECYCLE ==============================

  server.tool('launch_browser',
    'Start the dedicated Social Cue Chrome profile with its debug port (no-op if already running). Opens a real window on startUrl so the user can sign in. Use whenever Chrome is not reachable — never ask the user to run a terminal command. After launching, tell the user to sign into their platforms in the window that opened, then confirm with get_logged_in_platforms.',
    { startUrl: z.string().optional().describe('URL to open the window on (default: the Reddit login page)') },
    async ({ startUrl }) => {
      try {
        const result = await browser.launchDedicatedChrome({
          cdpUrl: CDP_URL,
          ...(PROFILE_DIR ? { profileDir: PROFILE_DIR } : {}),
          ...(startUrl ? { startUrl } : {}),
        });
        log(`[MCP] launch_browser: ${result.alreadyRunning ? 'already running' : 'launched'} (${result.browserVersion})`);
        return ok({
          ...result,
          message: result.alreadyRunning
            ? 'Dedicated Chrome is already running and reachable.'
            : 'Dedicated Chrome launched. Have the user sign into their platforms in the window that just opened, then verify with get_logged_in_platforms.',
        });
      } catch (e) { return err(e); }
    });

  // ============================== DISCOVERY TOOLS ==============================

  server.tool('get_logged_in_platforms',
    'Detect which social platforms the attached Chrome profile is logged into (from its cookies). Use to confirm you can browse a platform (e.g. Reddit) before starting.',
    {},
    async () => {
      try {
        await ensure();
        const state = await browser.getStorageState();
        const platforms = detectLoggedInPlatforms(state).map(p => ({ name: p.name, domain: p.domain, isKnown: p.isKnown }));
        return ok({ platforms });
      } catch (e) { return err(e); }
    });

  server.tool('collect_opportunity',
    'Record a conversation opportunity found during discovery. Captures a screenshot and writes it to the local store (SQLite). Discovery only collects — posting happens later, after the user approves. ALWAYS include draftReply (the actual text). Pass the post\'s DIRECT url, not a feed/search url.',
    {
      type: z.string().describe('product_reply | product_comment | category_insight | general_comment | original_post | meme_post | launch_comment (rare: a non-promotional comment on a fresh Product Hunt launch) | your own'),
      title: z.string().describe('Title or first line of the post/comment'),
      context: z.string().describe('Why it is worth engaging + your angle. Include your relevance score, e.g. "Score: 8/10 — …"'),
      platform: z.string().describe('Platform (Reddit, Twitter, …)'),
      draftReply: z.string().describe('The actual reply text, in the brand voice'),
      url: z.string().describe('DIRECT post/comment URL (not the feed/search URL)'),
      relevanceScore: z.number().optional().describe('Your 1-10 average relevance score'),
      relevanceReason: z.string().optional(),
      suggestedAction: z.string().optional(),
      publishedAt: z.string().optional().describe("When the post was published on the platform, as an ISO 8601 timestamp (e.g. from the thread's timestamp/'x hours ago'). Omit if not visible."),
      ocrText: z.string().max(2000).optional().describe('Text read from the post image/video by read_image_text (lossy — pass it through as-is)'),
      runId: z.string().optional().describe('The current run id (from /socialdiscovery)'),
      brandId: z.string().optional().describe('The brand this applies to, if specific'),
    },
    async ({ type, title, context, platform, draftReply, url, relevanceScore, relevanceReason, suggestedAction, publishedAt, ocrText, runId, brandId }) => {
      try {
        await ensure();
        const target = url || browser.getPage().url();

        if (db.isUrlSeen(target)) {
          return ok({ skipped: true, message: 'URL already seen in a previous run — skipped.', url: target });
        }

        const oppId = randomUUID();

        // brandId arrives free-form (the subagent may pass a name or an id).
        // Resolve to the canonical brand so the dashboard's brand filter (which
        // queries by id) and the Brand column (brand_name) both work.
        const brand = resolveBrand(brandId);

        // Save screenshot to runs/<runId>/<oppId>.png. Only record the path if the
        // write actually succeeded — otherwise the DB points at a file that never
        // got written and the dashboard renders a broken image / raw path.
        let screenshotPath = null;
        try {
          const dir = path.join(paths.runsDir(), runId || 'adhoc');
          fs.mkdirSync(dir, { recursive: true });
          const shotPath = path.join(dir, `${oppId}.png`);
          fs.writeFileSync(shotPath, await browser.screenshotPng());
          screenshotPath = shotPath;
        } catch (e) {
          log(`[collect_opportunity] screenshot failed: ${e.message}`);
        }

        db.addOpportunity({
          id: oppId,
          runId: runId || null,
          brandId: brand?.id ?? null,
          brandName: brand?.name ?? '',
          source: 'plugin',
          platform,
          platformUrl: target,
          title,
          context,
          opportunityType: type,
          relevanceScore: relevanceScore ?? null,
          relevanceReason: relevanceReason || '',
          suggestedReply: draftReply,
          suggestedAction: suggestedAction || '',
          status: 'new',
          screenshotPath,
          publishedAt: publishedAt || null,
          ocrText: ocrText ? ocrText.slice(0, 1500) : null,
        });

        return ok({ opportunityId: oppId, message: `Collected ${type} on ${platform}`, url: target });
      } catch (e) { return err(e); }
    });

  server.tool('record_performance',
    "Record how a posted reply is being received (the Pro performance check-in). After visiting the thread and finding the user's own comment, pass its current score and direct-reply count. Omit a number if the platform doesn't show it (e.g. someone else's HN comment score).",
    {
      oppId: z.string().describe('The opportunity id (from "perf due")'),
      upvotes: z.number().optional().describe("Current score/upvotes on the user's comment"),
      replyCount: z.number().optional().describe("Direct replies to the user's comment"),
      note: z.string().optional().describe('One-line color, e.g. "top reply, OP thanked them"'),
    },
    async ({ oppId, upvotes, replyCount, note }) => {
      try {
        const opp = db.getOpportunityById(oppId);
        if (!opp) throw new Error(`No opportunity with id ${oppId}`);
        db.recordReplyCheck(oppId, {
          upvotes: upvotes ?? null,
          replyCount: replyCount ?? null,
          note: note || '',
        });
        return ok({ message: `Recorded performance check for ${oppId}`, oppId });
      } catch (e) { return err(e); }
    });

  server.tool('like_content',
    'Like/upvote content on the current page (button text or coordinates). NOTE: discovery is read-only by default; only use if explicitly enabled.',
    {
      target: z.string().optional().describe("Like button text/label (e.g. 'Upvote')"),
      x: z.number().optional(), y: z.number().optional(),
    },
    async ({ target, x, y }) => {
      try {
        await ensure();
        if (target) {
          try { await browser.click(target); return ok({ message: `Liked using: ${target}`, action: 'like' }); }
          catch { /* fall through to coords */ }
        }
        if (x !== undefined && y !== undefined) {
          await browser.clickAt(x, y); return ok({ message: `Liked at (${x}, ${y})`, action: 'like' });
        }
        throw new Error("Provide 'target' text or x,y coordinates");
      } catch (e) { return err(e); }
    });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('[MCP] connected and ready');

  async function shutdown() {
    log('[MCP] shutting down');
    try { await ocr.destroyOCR(); } catch { /* ignore */ }
    try { await browser.closeBrowser(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startMcpServer().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
