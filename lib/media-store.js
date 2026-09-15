/**
 * Managed media store for Content Strategy attachments.
 *
 * Producer agents drop finished work (memes, screenshots, demo videos) into the
 * queue with absolute paths to wherever they happened to render them. Those
 * locations are scratch space: projects get renamed, agents clean up after
 * themselves. So at ingestion (`content add` / POST /api/content) attachments
 * are COPIED into `.socialdiscovery/media/<itemId>/` and rows store paths
 * *relative to mediaDir()*. From that point the queue owns its media — the
 * source files can disappear without breaking a queued post.
 *
 * Legacy rows (pre-ingestion) hold absolute paths; resolveMediaPath() passes
 * those through so they keep working until the item is sent or deleted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { mediaDir } from './paths.js';

/** Absolute path an entry resolves to for reading/upload. Guards `..` escapes. */
export function resolveMediaPath(entry) {
  const p = String(entry);
  if (path.isAbsolute(p)) return p; // legacy pre-store row
  const root = mediaDir();
  const abs = path.resolve(root, p);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`media entry escapes the media store: ${entry}`);
  }
  return abs;
}

/**
 * Copy absolute source files into the item's media dir; returns store-relative
 * entries ("<itemId>/<name>"). Entries that are already store-relative are kept
 * as-is (PATCH sends the existing list back mixed with any new files). Throws
 * on a missing source — callers validate/report, nothing is half-ingested
 * before the throw beyond already-copied files (idempotent to retry).
 */
export function ingestMedia(itemId, entries = []) {
  const id = String(itemId);
  if (!id || id.includes('/') || id.includes('..')) throw new Error(`bad media item id: ${itemId}`);
  const out = [];
  for (const entry of entries) {
    const p = String(entry);
    if (!path.isAbsolute(p)) {
      resolveMediaPath(p); // validates it stays inside the store
      out.push(p);
      continue;
    }
    if (!fs.existsSync(p)) throw new Error(`media file not found: ${p}`);
    const dir = path.join(mediaDir(), id);
    fs.mkdirSync(dir, { recursive: true });
    // Basename collisions within one item get a numeric suffix.
    const ext = path.extname(p);
    const stem = path.basename(p, ext);
    let name = `${stem}${ext}`;
    for (let n = 1; fs.existsSync(path.join(dir, name)); n++) name = `${stem}-${n}${ext}`;
    fs.copyFileSync(p, path.join(dir, name));
    out.push(`${id}/${name}`);
  }
  return out;
}

/**
 * Write uploaded bytes (dashboard attachment) into the item's media dir.
 * Returns the store-relative entry ("<itemId>/<name>"). The filename is
 * reduced to a safe basename; collisions get a numeric suffix like ingestMedia.
 */
export function saveUploadedMedia(itemId, filename, buf) {
  const id = String(itemId);
  if (!id || id.includes('/') || id.includes('..')) throw new Error(`bad media item id: ${itemId}`);
  const base = path.basename(String(filename || 'upload')).replace(/[^\w.\- ]+/g, '_');
  const ext = path.extname(base);
  const stem = path.basename(base, ext) || 'upload';
  const dir = path.join(mediaDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  let name = `${stem}${ext}`;
  for (let n = 1; fs.existsSync(path.join(dir, name)); n++) name = `${stem}-${n}${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return `${id}/${name}`;
}

/**
 * Delete one store-relative entry's file (attachment removed in the editor).
 * Legacy absolute-path entries are left on disk — they're the producer's
 * files, not ours to delete. Best-effort, never throws.
 */
export function removeMediaFile(entry) {
  try {
    const p = String(entry);
    if (path.isAbsolute(p)) return;
    fs.rmSync(resolveMediaPath(p), { force: true });
  } catch {
    /* cleanup only */
  }
}

/** Delete an item's media dir (item removed). Best-effort, never throws. */
export function removeItemMedia(itemId) {
  const id = String(itemId);
  if (!id || id.includes('/') || id.includes('..')) return;
  try {
    fs.rmSync(path.join(mediaDir(), id), { recursive: true, force: true });
  } catch {
    /* cleanup only */
  }
}
