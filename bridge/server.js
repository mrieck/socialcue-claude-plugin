/**
 * The Social Cue localhost bridge (Pro plumbing).
 *
 * A loopback-only HTTP server hosted by the plugin:
 *   - serves the dashboard UI (dashboard/dist) at /
 *   - serves the unified opportunities API under /api/* (Bearer pairing token)
 *   - receives opportunity pushes from the Chrome extension (POST /api/sync)
 *
 * Guardrails: binds 127.0.0.1 only, rejects foreign Host headers (DNS
 * rebinding), no CORS allow headers, token never logged. The queue is served
 * on loopback only — this replaces any cloud sync, it does not call out anywhere.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as cfg from '../lib/config.js';
import { checkHost } from './auth.js';
import { handleApi } from './routes.js';
import { serveStatic } from './static.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', 'dashboard', 'dist');

export function pluginVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')).version;
  } catch {
    return '0.0.0';
  }
}

/** Ensure config.bridge.token exists; generate + persist on first use. */
export function ensureToken({ rotate = false } = {}) {
  const config = cfg.loadConfig();
  if (!config.bridge.token || rotate) {
    config.bridge.token = randomBytes(32).toString('base64url');
    cfg.saveConfig(config);
  }
  return config.bridge;
}

export function createBridgeServer({ port, token, syncHandler = null }) {
  const ctx = { token, version: pluginVersion(), syncHandler };
  return http.createServer(async (req, res) => {
    try {
      if (!checkHost(req, port)) {
        res.writeHead(403, { 'content-type': 'text/plain' });
        res.end('forbidden\n');
        return;
      }
      const urlPath = new URL(req.url, 'http://127.0.0.1').pathname;
      if (await handleApi(req, res, ctx)) return;
      serveStatic(req, res, urlPath, DIST_DIR);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'internal error' }));
      }
      // Never log tokens; err messages here are our own.
      console.error(`[bridge] ${req.method} ${req.url}: ${err?.message ?? err}`);
    }
  });
}

/**
 * Probe whether something answering on `port` is a socialcue bridge.
 * Returns the /api/health body (truthy) if so, false otherwise.
 */
export async function probeBridge(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await r.json();
    return body?.app === 'socialcue-bridge' ? body : false;
  } catch {
    return false;
  }
}

/**
 * Start the bridge: ensure token, bind 127.0.0.1:<port>, print the dashboard
 * URL (token in the #fragment — never in a query string that could be logged).
 */
export async function startBridge({ port: portFlag = null, syncHandler = null } = {}) {
  const bridge = ensureToken();
  const port = portFlag ?? bridge.port;

  const server = createBridgeServer({ port, token: bridge.token, syncHandler });

  await new Promise((resolve, reject) => {
    server.once('error', async err => {
      if (err.code === 'EADDRINUSE') {
        const isBridge = await probeBridge(port);
        reject(new Error(
          isBridge
            ? `A Social Cue bridge is already running on port ${port}.`
            : `Port ${port} is in use by another program. Pick another with --port or config.json bridge.port.`
        ));
      } else {
        reject(err);
      }
    });
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    server,
    port,
    token: bridge.token,
    url: `http://127.0.0.1:${port}/`,
    dashboardUrl: `http://127.0.0.1:${port}/#token=${bridge.token}`,
  };
}
