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

export function ensureBaseDir() {
  const dir = baseDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
