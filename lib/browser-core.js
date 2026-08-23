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
