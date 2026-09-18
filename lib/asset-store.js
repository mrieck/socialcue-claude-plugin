/**
 * Per-subject asset cache for Product Posts.
 *
 * Destination forms ask for logos, screenshots, OG images, banners — each in
 * its own size. The agent finds or produces those on the fly (project folder,
 * content media, the subject's website/GitHub, a browser screenshot, resized
 * locally with sips/ffmpeg) and saves anything worth reusing here, keyed by
 * subject and a descriptive role, so the next post to another destination
 * starts from what's on file instead of scrounging again.
 *
 * Filesystem only — `.socialdiscovery/assets/<subjectKey>/<role>.<ext>` plus a
 * best-effort `index.json` sidecar with dimensions. No resize logic lives
 * here: the skill decides what a form needs and how to make it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { assetsDir } from './paths.js';

/** Suggested role names; any `<what>-<WxH>`-style role is accepted. */
export const ASSET_ROLES = [
  'logo-square-240', 'logo-square-400', 'logo-square-512',
  'screenshot-1270x760', 'og-1200x630', 'banner-1500x500', 'icon-64', 'raw',
];

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const INDEX = 'index.json';

/** Filesystem-safe folder name for a subject key ("brand:<id>" -> "brand_<id>"). */
export function safeSubjectKey(subjectKey) {
  const k = String(subjectKey ?? '').trim().replace(/[^\w.-]+/g, '_');
  if (!k || k === '.' || k === '..' || k.startsWith('.')) throw new Error(`bad subject key: ${subjectKey}`);
  return k;
}

export function subjectAssetDir(subjectKey) {
  return path.join(assetsDir(), safeSubjectKey(subjectKey));
}

/** Absolute path of one asset file, guarding `..` escapes. */
export function resolveAssetPath(subjectKey, file) {
  const dir = subjectAssetDir(subjectKey);
  const abs = path.resolve(dir, String(file));
  if (path.dirname(abs) !== dir) throw new Error(`asset path escapes the store: ${file}`);
  return abs;
}

function readIndex(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, INDEX), 'utf8')); } catch { return {}; }
}
function writeIndex(dir, idx) {
  try { fs.writeFileSync(path.join(dir, INDEX), JSON.stringify(idx, null, 2) + '\n'); } catch { /* sidecar only */ }
}

/** Image dimensions via macOS `sips` (best-effort; null elsewhere or on failure). */
export function imageDimensions(absPath) {
  if (process.platform !== 'darwin' || !IMAGE_EXT.has(path.extname(absPath).toLowerCase())) return null;
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', absPath], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    });
    const w = /pixelWidth:\s*(\d+)/.exec(out)?.[1];
    const h = /pixelHeight:\s*(\d+)/.exec(out)?.[1];
    return w && h ? { width: Number(w), height: Number(h) } : null;
  } catch { return null; }
}

/** Assets on file for a subject: [{ role, file, absPath, bytes, width?, height? }]. */
export function listAssets(subjectKey) {
  const dir = subjectAssetDir(subjectKey);
  if (!fs.existsSync(dir)) return [];
  const idx = readIndex(dir);
  const out = [];
  for (const file of fs.readdirSync(dir).sort()) {
    if (file === INDEX || file.startsWith('.')) continue;
    const abs = path.join(dir, file);
    let st;
    try { st = fs.statSync(abs); } catch { continue; }
    if (!st.isFile()) continue;
    const role = path.basename(file, path.extname(file));
    const dims = idx[file] ?? imageDimensions(abs);
    out.push({ role, file, absPath: abs, bytes: st.size, ...(dims ?? {}) });
  }
  return out;
}

/**
 * Copy a produced file into the subject's cache as `<role>.<ext>` (overwrites
 * a previous file for that role). Returns the listing entry.
 */
export function ingestAsset(subjectKey, role, absSource) {
  const src = String(absSource);
  if (!path.isAbsolute(src)) throw new Error(`asset source must be an absolute path: ${absSource}`);
  if (!fs.existsSync(src)) throw new Error(`asset file not found: ${src}`);
  const r = String(role ?? '').trim().toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!r) throw new Error('asset role required (e.g. logo-square-400)');
  const ext = path.extname(src).toLowerCase() || '';
  const dir = subjectAssetDir(subjectKey);
  fs.mkdirSync(dir, { recursive: true });
  // Drop any stale file for this role with a different extension.
  for (const f of fs.readdirSync(dir)) {
    if (f !== INDEX && path.basename(f, path.extname(f)) === r) fs.rmSync(path.join(dir, f), { force: true });
  }
  const file = `${r}${ext}`;
  const abs = path.join(dir, file);
  fs.copyFileSync(src, abs);
  const idx = readIndex(dir);
  for (const k of Object.keys(idx)) if (path.basename(k, path.extname(k)) === r) delete idx[k];
  const dims = imageDimensions(abs);
  if (dims) idx[file] = dims;
  writeIndex(dir, idx);
  return { role: r, file, absPath: abs, bytes: fs.statSync(abs).size, ...(dims ?? {}) };
}

/** Remove one asset file. Best-effort; returns whether something was deleted. */
export function removeAsset(subjectKey, file) {
  try {
    const abs = resolveAssetPath(subjectKey, file);
    if (!fs.existsSync(abs)) return false;
    fs.rmSync(abs, { force: true });
    const dir = path.dirname(abs);
    const idx = readIndex(dir);
    delete idx[path.basename(abs)];
    writeIndex(dir, idx);
    return true;
  } catch { return false; }
}
