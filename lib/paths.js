/**
 * Resolve the local Social Cue data directory.
 *
 * Everything lives under the user's project:
 *   <project>/.socialdiscovery/
 *     config.json        — brands, accounts, browser, strategy (user-editable)
 *     voice-guidance.md  — draft-reply voice rules + golden examples (user-editable)
 *     socialcue.db       — SQLite: seen_urls, opportunities, runs
 *     runs/<id>/         — per-run screenshots + report.md
 *     media/<itemId>/    — content attachments (copied here at ingestion)
 *     assets/<subjectKey>/ — reusable product-post assets (logos, screenshots; lib/asset-store.js)
 *     submission-credentials.json — generated destination-account passwords (0600; lib/credentials.js)
 *
 * Override the base dir with SOCIALCUE_DIR (absolute path).
 */
import path from 'node:path';
import fs from 'node:fs';

export function baseDir() {
  const override = process.env.SOCIALCUE_DIR;
  if (override) {
    return path.resolve(override);
  }
  // Walk up from cwd so the CLI works from a subdirectory of the project
  // (the store lives next to the project root, not wherever the shell is).
  let dir = process.cwd();
  while (true) {
    const candidate = path.join(dir, '.socialdiscovery');
    if (fs.existsSync(path.join(candidate, 'config.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), '.socialdiscovery');
}

export function configPath() {
  return path.join(baseDir(), 'config.json');
}

export function dbPath() {
  return path.join(baseDir(), 'socialcue.db');
}

export function voiceGuidancePath() {
  return path.join(baseDir(), 'voice-guidance.md');
}

export function runsDir() {
  return path.join(baseDir(), 'runs');
}

export function mediaDir() {
  return path.join(baseDir(), 'media');
}

/** Product-post assets cache root (see lib/asset-store.js). */
export function assetsDir() {
  return path.join(baseDir(), 'assets');
}

/** Destination-account credentials (0600 JSON; see lib/credentials.js). */
export function credentialsPath() {
  return path.join(baseDir(), 'submission-credentials.json');
}

export function ensureBaseDir() {
  const dir = baseDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
