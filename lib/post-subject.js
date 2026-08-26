/**
 * Resolve what a product post is *about* — the subject — from CLI flags.
 *
 *   brand:<idOrName>   a configured brand (config.json)
 *   content:<id>       a Content Library item (its body + media travel with it)
 *   adhoc              anything else: --name (required) --url --path [--brand for context]
 *
 * Returns a normalized subject plus the owning brand (or null), and the
 * asset-search hints the skill uses to scrounge logos/screenshots on the fly.
 * Kept out of cli.js so tests can import it (cli.js runs main() on import).
 */
import fs from 'node:fs';
import path from 'node:path';
import * as cfg from './config.js';
import * as db from './db.js';
import { resolveMediaPath } from './media-store.js';

export const slugify = s => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function brandFields(b) {
  if (!b) return {};
  return {
    tagline: b.tagline ?? '', shortDescription: b.shortDescription ?? '',
    aboutBrand: b.aboutBrand ?? '', tags: Array.isArray(b.tags) ? b.tags : [],
  };
}

/**
 * @param {object} flags  { subject?, brand?, name?, url?, path? }
 * @param {object} config loaded config (brands)
 * @returns {{ subject: object, brand: object|null }}
 * @throws Error with a user-facing message
 */
export function resolveSubject(flags, config) {
  const brands = config.brands ?? [];
  const findBrand = ref => {
    const r = cfg.resolveBrand(String(ref), brands);
    return r ? brands.find(b => b.id === r.id) : null;
  };

  let spec = flags.subject !== undefined && flags.subject !== true ? String(flags.subject) : '';
  if (!spec && flags.brand && !flags.name) spec = `brand:${flags.brand}`; // legacy --brand only
  if (!spec && flags.name) spec = 'adhoc';
  if (!spec) throw new Error('post start requires --subject <brand:ref | content:<id> | adhoc --name "…">');

  if (spec.startsWith('brand:') || (!spec.includes(':') && spec !== 'adhoc' && findBrand(spec))) {
    const ref = spec.startsWith('brand:') ? spec.slice(6) : spec;
    const brand = findBrand(ref);
    if (!brand) throw new Error(`No brand matches "${ref}"`);
    return {
      brand,
      subject: {
        kind: 'brand', key: `brand:${brand.id}`, id: brand.id, name: brand.name, url: brand.url ?? '',
        path: brand.projectPath || null, ...brandFields(brand), body: null, media: [],
      },
    };
  }
  if (spec.startsWith('content:')) {
    const id = spec.slice(8).trim();
    const row = db.getContentItemById(id);
    if (!row) throw new Error(`No content item ${id} (see "content list")`);
    const brand = row.brand_id ? brands.find(b => b.id === row.brand_id) ?? null : null;
    let media = [];
    try { media = JSON.parse(row.media || '[]'); } catch { media = []; }
    return {
      brand,
      subject: {
        kind: 'content', key: `content:${row.id}`, id: row.id, name: row.title || '(untitled)',
        url: row.release_url || brand?.url || '', path: brand?.projectPath || null,
        ...brandFields(brand), body: row.body ?? '',
        media: media.map(m => { try { return resolveMediaPath(m); } catch { return null; } }).filter(Boolean),
      },
    };
  }
  if (spec === 'adhoc') {
    const name = flags.name !== undefined && flags.name !== true ? String(flags.name).trim() : '';
    if (!name) throw new Error('adhoc subject requires --name "<what you are posting>"');
    const brand = flags.brand ? findBrand(flags.brand) : null;
    if (flags.brand && !brand) throw new Error(`No brand matches "${flags.brand}"`);
    const p = flags.path !== undefined && flags.path !== true ? path.resolve(String(flags.path)) : null;
    if (p && !fs.existsSync(p)) throw new Error(`--path does not exist: ${p}`);
    return {
      brand,
      subject: {
        kind: 'adhoc', key: `adhoc:${slugify(name)}`, id: null, name,
        url: flags.url !== undefined && flags.url !== true ? String(flags.url) : '',
        path: p, ...brandFields(brand), body: null, media: [],
      },
    };
  }
  throw new Error(`Unknown subject "${spec}" — use brand:<ref>, content:<id>, or adhoc --name "…"`);
}

/** Where the agent should look for assets, cheapest first; only what exists. */
export function buildSearchHints(subject) {
  const hints = [];
  if (subject.path) {
    hints.push(`Local folder ${subject.path}: glob **/*logo*, **/*icon*, **/screenshot*, **/*.png in docs/ or public/, README images`);
  }
  if (subject.media?.length) hints.push(`Content media already attached: ${subject.media.join(', ')} (extract a frame from video with ffmpeg if needed)`);
  if (subject.url) {
    hints.push(`Website ${subject.url}: favicon / apple-touch-icon, og:image meta tag, hero image (navigate + get_page_info, or screenshot it)`);
    if (/github\.com\//.test(subject.url)) hints.push('GitHub repo: social preview image (og:image), README images, the owner avatar as a square logo fallback');
  }
  hints.push('Take a browser screenshot of the live site/app for a screenshot slot; crop/resize with sips or ffmpeg');
  return hints;
}
