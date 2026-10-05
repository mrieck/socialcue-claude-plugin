/**
 * Who is attached to the dedicated Chrome's debug port, and how to detach them.
 * Browser MCP servers that can detach on SIGUSR2 without exiting drop a marker
 * file here; older ones (and non-Social-Cue clients) can only be terminated.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MARKER_DIR = path.join(os.tmpdir(), 'socialcue-browser-mcp');

export function writeClientMarker(pid = process.pid) {
  try {
    fs.mkdirSync(MARKER_DIR, { recursive: true });
    fs.writeFileSync(path.join(MARKER_DIR, String(pid)), new Date().toISOString());
  } catch { /* best effort */ }
}

export function removeClientMarker(pid = process.pid) {
  try { fs.unlinkSync(path.join(MARKER_DIR, String(pid))); } catch { /* ignore */ }
}

function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return e.stdout ?? ''; }
}

/** Processes holding an established connection TO the CDP port (never Chrome itself). */
export function listCdpClients(cdpUrl = 'http://127.0.0.1:9222') {
  const port = new URL(cdpUrl).port || '9222';
  const rows = sh('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:ESTABLISHED', '-Fpn']).split('\n');
  const counts = new Map();
  let pid = null;
  for (const line of rows) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid && line.endsWith(`:${port}`)) counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  return [...counts].filter(([p]) => p !== process.pid).map(([p, connections]) => {
    const [ppid, etime, ...cmd] = sh('ps', ['-o', 'ppid=,etime=,command=', '-p', String(p)]).trim().split(/\s+/);
    return {
      pid: p,
      connections,
      age: etime ?? '?',
      command: cmd.join(' '),
      orphan: Number(ppid) === 1,
      soft: fs.existsSync(path.join(MARKER_DIR, String(p))),
    };
  });
}

/**
 * Detach every client. soft → SIGUSR2 (server stays up, re-attaches on its
 * next tool call); orphans → SIGTERM (no session owns them); the rest only
 * with force, since their Claude session then needs /mcp to get tools back.
 */
export function disconnectCdpClients(cdpUrl, { force = false } = {}) {
  return listCdpClients(cdpUrl).map(c => {
    const signal = c.soft ? 'SIGUSR2' : (c.orphan || force) ? 'SIGTERM' : null;
    let error;
    if (signal) { try { process.kill(c.pid, signal); } catch (e) { error = e.message; } }
    return { ...c, action: error ? `failed: ${error}` : signal === 'SIGUSR2' ? 'detached' : signal ? 'terminated' : 'left attached' };
  });
}
