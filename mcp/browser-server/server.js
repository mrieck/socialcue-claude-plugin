/**
 * Social Cue browser MCP server (stdio).
 *
 * Exposes the browser tool surface (navigate / read_page / click / type / scroll /
 * screenshot / …) plus local discovery tools:
 *   - launch_browser : start the dedicated Chrome profile (detached, host-side)
 *   - collect_opportunity : screenshot + write to local SQLite (no Apify/KV)
 *   - get_logged_in_platforms : detect logins from the attached profile's cookies
 *   - like_content : available, but discovery stays read-only by policy
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

// ---- response helpers ----
const ok = (obj) => ({ content: [{ type: 'text', text: JSON.stringify({ success: true, ...obj }) }] });
const err = (e) => ({ content: [{ type: 'text', text: JSON.stringify({ success: false, error: e.message || String(e) }) }], isError: true });

async function startMcpServer() {
  log(`[MCP] starting; CDP=${CDP_URL}`);

  const server = new McpServer({
    name: 'socialcue-browser',
    version: '0.1.0',
    capabilities: { tools: {} },
  });

  // ============================== CORE BROWSER TOOLS ==============================

  server.tool('navigate', 'Navigate the browser to a URL.',
    { url: z.string().describe('The URL to navigate to') },
    async ({ url }) => {
      try { await ensure(); const msg = await browser.navigate(url); const info = await browser.getPageInfo();
        return ok({ message: msg, title: info.title, url: info.url }); }
      catch (e) { return err(e); }
    });

  server.tool('read_page',
    `Get the accessibility tree of the current page as text with refs (e1, e2…) for interactive elements. MUCH cheaper than screenshots — use this as your primary way to understand a page.
Use the refs with click("e3") / type("e3", text). Refs are stable until you navigate.
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

  server.tool('click',
    'Click an element. Prefer a ref from read_page (e.g. "e3") — far more reliable than text matching.',
    { target: z.string().describe('The ref (e.g. e1) or visible text/label to click') },
    async ({ target }) => { try { await ensure(); return ok({ message: await browser.click(target) }); } catch (e) { return err(e); } });

  server.tool('click_at', 'Click at specific x,y coordinates.',
    { x: z.number(), y: z.number() },
    async ({ x, y }) => { try { await ensure(); return ok({ message: await browser.clickAt(x, y) }); } catch (e) { return err(e); } });

  server.tool('type',
    'Type text into an input. Prefer a ref from read_page (e.g. "e3"). Handles standard and contenteditable inputs.',
    { target: z.string().describe('The ref or label/placeholder of the input'), text: z.string() },
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
    'Perform an action on an element by ref. actions: click, fill, check, uncheck, select, hover. Most reliable interaction path.',
    { ref: z.string(), action: z.enum(['click', 'fill', 'check', 'uncheck', 'select', 'hover']), value: z.string().optional() },
    async ({ ref, action, value }) => {
      try {
        await ensure();
        const locator = await browser.resolveRef(ref);
        const page = browser.getPage();
        switch (action) {
          case 'click':
            await browser.clickLocator(locator); return ok({ message: `Clicked ${ref}` });
          case 'fill':
            if (!value) throw new Error('value required for fill');
            await locator.scrollIntoViewIfNeeded(); await browser.moveMouseToLocator(locator);
            try { await locator.fill(value); }
            catch {
              try { await locator.click(); await page.waitForTimeout(100); await page.keyboard.insertText(value); }
              catch { await browser.fillNative(locator, value); }
            }
            return ok({ message: `Filled ${ref}` });
          case 'check': await locator.scrollIntoViewIfNeeded(); await locator.check(); return ok({ message: `Checked ${ref}` });
          case 'uncheck': await locator.scrollIntoViewIfNeeded(); await locator.uncheck(); return ok({ message: `Unchecked ${ref}` });
          case 'select': if (!value) throw new Error('value required for select'); await locator.selectOption(value); return ok({ message: `Selected in ${ref}` });
          case 'hover': await browser.moveMouseToLocator(locator); await locator.hover(); return ok({ message: `Hovered ${ref}` });
          default: throw new Error(`Unknown action: ${action}`);
        }
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

  server.tool('upload',
    'Upload local file(s) to a file input (for the posting flow — images/video). target is a ref from read_page (e.g. "e3") or a CSS selector for the <input type=file>. Paths must be absolute.',
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
      type: z.string().describe('product_reply | category_insight | general_comment | original_post | meme_post | your own'),
      title: z.string().describe('Title or first line of the post/comment'),
      context: z.string().describe('Why it is worth engaging + your angle. Include your relevance score, e.g. "Score: 8/10 — …"'),
      platform: z.string().describe('Platform (Reddit, Twitter, …)'),
      draftReply: z.string().describe('The actual reply text, in the brand voice'),
      url: z.string().describe('DIRECT post/comment URL (not the feed/search URL)'),
      relevanceScore: z.number().optional().describe('Your 1-10 average relevance score'),
      relevanceReason: z.string().optional(),
      suggestedAction: z.string().optional(),
      publishedAt: z.string().optional().describe("When the post was published on the platform, as an ISO 8601 timestamp (e.g. from the thread's timestamp/'x hours ago'). Omit if not visible."),
      runId: z.string().optional().describe('The current run id (from /socialdiscovery)'),
      brandId: z.string().optional().describe('The brand this applies to, if specific'),
    },
    async ({ type, title, context, platform, draftReply, url, relevanceScore, relevanceReason, suggestedAction, publishedAt, runId, brandId }) => {
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
