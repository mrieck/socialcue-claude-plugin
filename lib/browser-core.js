/**
 * Stateless browser helpers shared by the MCP browser server (discovery) and
 * the bridge's post-intent fulfiller (assisted posting). Deliberately free of
 * patchright imports and module state — callers pass their own locators/urls —
 * so the bridge stays dependency-free until a post intent actually fires.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Default CDP endpoint; overridden by config.browser.cdpUrl. */
export const DEFAULT_CDP_URL = process.env.SOCIALCUE_CDP_URL || 'http://127.0.0.1:9222';

/** Default dedicated profile dir; overridden by config.browser.profilePath. */
export const DEFAULT_PROFILE_DIR = path.join(os.homedir(), '.socialcue-chrome');

/** GET <cdpUrl>/json/version. Returns Chrome's version info, or null if unreachable. */
export async function probeCdp(cdpUrl = DEFAULT_CDP_URL, timeoutMs = 2000) {
  try {
    const res = await fetch(new URL('/json/version', cdpUrl), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** Locate a Chrome/Chromium binary for this OS; null if none found. */
export function findChromeBinary() {
  const platform = os.platform();
  let candidates;
  if (platform === 'darwin') {
    candidates = [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  } else if (platform === 'win32') {
    const roots = [
      process.env['PROGRAMFILES'],
      process.env['PROGRAMFILES(X86)'],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    candidates = roots.map((dir) => path.join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else {
    const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
    const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
    candidates = names.flatMap((name) => pathDirs.map((dir) => path.join(dir, name)));
  }
  return candidates.find((c) => fs.existsSync(c)) || null;
}

/**
 * Launch the dedicated Chrome profile with the CDP debug port, detached so it
 * survives this process exiting. No-op if something already answers on the port.
 * Only ever pointed at the dedicated profile dir — never the user's daily
 * profile (Chrome 136+ ignores the debug flag on the default profile anyway).
 */
export async function launchDedicatedChrome({
  cdpUrl = DEFAULT_CDP_URL,
  profileDir = DEFAULT_PROFILE_DIR,
  startUrl = 'https://www.reddit.com/login',
  waitMs = 20000,
} = {}) {
  const running = await probeCdp(cdpUrl);
  if (running) {
    return { alreadyRunning: true, browserVersion: running.Browser, cdpUrl, profileDir };
  }

  const bin = findChromeBinary();
  if (!bin) {
    throw new Error(
      'Could not find a Chrome/Chromium binary on this machine. Install Google Chrome, ' +
      'or launch a browser manually with --remote-debugging-port and set browser.cdpUrl in config to match.'
    );
  }

  const port = Number(new URL(cdpUrl).port) || 9222;
  fs.mkdirSync(profileDir, { recursive: true });
  const child = spawn(bin, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Keep pages full-speed when the screen is locked or the display sleeps:
    // occluded windows otherwise go visibility:hidden and feeds pause loading.
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    startUrl,
  ], { detached: true, stdio: 'ignore' });
  child.unref();

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const info = await probeCdp(cdpUrl, 1000);
    if (info) {
      return { alreadyRunning: false, browserVersion: info.Browser, cdpUrl, profileDir };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Launched ${path.basename(bin)} but the debug port never came up at ${cdpUrl}. ` +
    'Most likely that profile is already open without a debug port — close any existing ' +
    'Social Cue browser windows and try again.'
  );
}

/**
 * Open a URL in the dedicated Social Cue Chrome profile — the one that holds the
 * user's platform logins — rather than the OS default browser. If the profile
 * is already up (debug port answers) this opens a new tab over CDP's HTTP
 * endpoint; otherwise it launches the profile with `url` as the start page.
 * Returns { how: 'tab' | 'launched' }, or null if no Chrome binary exists so the
 * caller can fall back to the default browser.
 */
export async function openInDedicatedChrome(url, {
  cdpUrl = DEFAULT_CDP_URL,
  profileDir = DEFAULT_PROFILE_DIR,
} = {}) {
  if (await probeCdp(cdpUrl)) {
    // Chrome unescapes the query, so the dashboard's `#token=` fragment survives
    // as %23 (a raw `#` would be dropped as the request URL's own fragment).
    const res = await fetch(new URL(`/json/new?${encodeURIComponent(url)}`, cdpUrl), {
      method: 'PUT',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Chrome refused to open a tab (${res.status} ${await res.text()})`);
    const target = await res.json();
    if (target?.id) {
      // Bring the new tab to the front; best-effort.
      await fetch(new URL(`/json/activate/${target.id}`, cdpUrl), {
        signal: AbortSignal.timeout(2000),
      }).catch(() => {});
    }
    return { how: 'tab', cdpUrl, profileDir };
  }
  if (!findChromeBinary()) return null;
  await launchDedicatedChrome({ cdpUrl, profileDir, startUrl: url });
  return { how: 'launched', cdpUrl, profileDir };
}

/**
 * Retry a flaky async op with bounded tries + linear backoff. Concept borrowed
 * from reins' attachWithRetry — CDP attach / session creation occasionally fail
 * transiently on heavy pages or a browser that's mid-startup.
 */
export async function withRetry(fn, { tries = 4, baseMs = 150 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < tries) {
        await new Promise((r) => setTimeout(r, baseMs * attempt));
      }
    }
  }
  throw lastErr;
}

/**
 * Set an input's value via the native prototype setter and dispatch input/change
 * so React/controlled composers observe the change. The final fallback when
 * .fill() and keyboard.insertText don't stick. Borrowed from reins' page-actions.
 */
export async function fillNative(locator, text) {
  await locator.evaluate((el, value) => {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, text);
}

/**
 * Newline handling for reply composers.
 *
 * Drafts keep single "\n" between lines and "\n\n" between paragraphs. Rich-text
 * composers (Reddit's Lexical editor, Product Hunt, Indie Hackers) ignore the
 * newline characters inside one insertText call and glue everything into one
 * block; markdown textareas (Hacker News, old Reddit) render a lone "\n" as a
 * space. Either way the posted comment doesn't match the dashboard textarea.
 * The user's rule: every line break in the draft must become a real break in
 * the posted comment ("double up the newlines").
 */

/** Markdown textareas: any run of newlines becomes exactly one blank line. */
export function markdownParagraphs(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]*\n(?:[ \t]*\n)*/g, '\n\n');
}

/**
 * Split a draft into the chunks to type between Enter presses.
 * mode 'paragraph': runs of newlines collapse to one break (rich-text editors
 *   turn each Enter into a paragraph with its own spacing, so an empty
 *   paragraph would double the gap and can leak a zero-width space on Reddit).
 * mode 'literal': one break per "\n" (plain-text composers like X and Threads,
 *   where a blank line is a real blank line).
 */
export function splitLines(text, mode = 'paragraph') {
  const norm = String(text ?? '').replace(/\r\n?/g, '\n');
  return mode === 'literal'
    ? norm.split('\n')
    : norm.split(/[ \t]*\n(?:[ \t]*\n)*/);
}

/**
 * Type a multi-line draft into the focused contenteditable composer: insertText
 * per chunk with an Enter keypress between chunks, so the editor creates real
 * paragraphs/line breaks instead of swallowing the "\n" characters.
 */
export async function insertLines(page, text, mode = 'paragraph') {
  const lines = splitLines(text, mode);
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(40);
    }
    if (lines[i]) await page.keyboard.insertText(lines[i]);
  }
}
