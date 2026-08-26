/**
 * Detached bridge lifecycle — lets `/socialdiscovery` (and the user) start the
 * bridge without holding a terminal open. Same spawn+probe pattern as
 * launchDedicatedChrome in mcp/browser-server/browser.js.
 *
 * State written under the data dir: bridge.pid (detached child) + bridge.log
 * (the child's stdout/stderr — startup errors like EADDRINUSE land there).
 *
 * Cowork caveat: this runs via Bash, which Cowork sandboxes into a VM — there
 * the bridge would be unreachable from the host browser. Future fix is an
 * MCP-side ensure/open tool (MCP servers run on the host), not a different opener.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cfg from './config.js';
import * as paths from './paths.js';
import { probeBridge, pluginVersion } from '../bridge/server.js';
import { refreshLicenseInBackground } from './license-refresh.js';
import { syncVenuesInBackground } from './venues-sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function pidPath() { return path.join(paths.baseDir(), 'bridge.pid'); }
export function logPath() { return path.join(paths.baseDir(), 'bridge.log'); }

function dashboardUrl(port, token) {
  return `http://127.0.0.1:${port}/#token=${token}`;
}

/**
 * Make sure a bridge is up on the configured port; spawn one detached if not.
 * Never generates a token itself — the bridge process does that at startup, so
 * a parent-side write can't race the child and desync the running server's token.
 */
export async function ensureBridge({ port: portFlag = null } = {}) {
  const port = portFlag ?? cfg.loadConfig().bridge.port;
  const localVersion = pluginVersion();

  // Opportunistically pull a fresh Pro key (no-op without an account token, and
  // non-blocking so it never delays the dashboard). Assisted posting comes later
  // in the flow, by which point the refreshed key is in config.
  refreshLicenseInBackground();
  // Same for the Pro venue playbook (no-op on free / without a token, throttled otherwise).
  syncVenuesInBackground();

  const running = await probeBridge(port);
  if (running) {
    const token = cfg.loadConfig().bridge.token;
    return {
      alreadyRunning: true,
      port,
      token,
      dashboardUrl: token ? dashboardUrl(port, token) : `http://127.0.0.1:${port}/`,
      localVersion,
      staleVersion: running.version !== localVersion ? running.version : null,
    };
  }

  paths.ensureBaseDir();
  const out = fs.openSync(logPath(), 'a');
  const child = spawn(
    process.execPath,
    [path.join(__dirname, 'cli.js'), 'bridge', 'start', '--port', String(port)],
    // cwd + env inherited on purpose: paths.baseDir() resolves from cwd / SOCIALCUE_DIR.
    { detached: true, stdio: ['ignore', out, out], cwd: process.cwd(), env: process.env }
  );
  child.unref();
  fs.closeSync(out);
  fs.writeFileSync(pidPath(), String(child.pid));

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await probeBridge(port)) {
      // The child persisted the token before listening — reload to pick it up.
      const token = cfg.loadConfig().bridge.token;
      return {
        alreadyRunning: false,
        port,
        token,
        dashboardUrl: dashboardUrl(port, token),
        logPath: logPath(),
        localVersion,
        staleVersion: null,
      };
    }
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Bridge did not come up on 127.0.0.1:${port} within 8s — check ${logPath()}`);
}

/** Stop a bridge previously started detached (via the pid file). */
export async function stopBridge({ port: portFlag = null } = {}) {
  const port = portFlag ?? cfg.loadConfig().bridge.port;
  const pf = pidPath();
  const up = await probeBridge(port);

  if (!fs.existsSync(pf)) {
    if (up) {
      return {
        stopped: false,
        message: `A bridge is running on port ${port} but wasn't started detached (no pid file) — stop it where it's running (Ctrl-C) or kill the process listening on that port.`,
      };
    }
    return { stopped: false, message: 'Bridge is not running.' };
  }

  const pid = Number(fs.readFileSync(pf, 'utf8').trim());
  try {
    process.kill(pid);
  } catch (err) {
    if (err.code !== 'ESRCH') throw err;
    fs.rmSync(pf, { force: true });
    return { stopped: false, message: up
      ? `Stale pid file removed, but something else answers on port ${port} — kill that process manually.`
      : 'Bridge was not running (stale pid file removed).' };
  }
  fs.rmSync(pf, { force: true });

  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!(await probeBridge(port))) return { stopped: true, message: `Bridge stopped (pid ${pid}).` };
    await new Promise(r => setTimeout(r, 200));
  }
  return { stopped: true, message: `Sent stop signal to pid ${pid}, but port ${port} still answers — check manually.` };
}

/** Open a URL in the user's default browser. Resolves false if it can't. */
export function openInDefaultBrowser(url) {
  return new Promise(resolve => {
    let cmd, args;
    if (os.platform() === 'darwin') { cmd = 'open'; args = [url]; }
    else if (os.platform() === 'win32') { cmd = 'cmd'; args = ['/c', 'start', '', url]; }
    else { cmd = 'xdg-open'; args = [url]; }
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    } catch {
      return resolve(false);
    }
    child.once('error', () => resolve(false));
    child.unref();
    setTimeout(() => resolve(true), 250);
  });
}
