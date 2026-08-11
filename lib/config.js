/**
 * Load / save / mutate the local config (`.socialdiscovery/config.json`).
 * Validated against the shared ConfigSchema. Brands + accounts are the
 * user-editable source of truth here (not in SQLite).
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { configPath, ensureBaseDir } from './paths.js';
import { ConfigSchema, BrandSchema, emptyConfig } from '../vendor/shared/schema.js';

export function configExists() {
  return fs.existsSync(configPath());
}

export function loadConfig() {
  if (!configExists()) {
    return emptyConfig();
  }
  const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  return ConfigSchema.parse(raw);
}

export function saveConfig(config) {
  const validated = ConfigSchema.parse(config);
  ensureBaseDir();
  fs.writeFileSync(configPath(), JSON.stringify(validated, null, 2) + '\n');
  return validated;
}

export function initConfig({ force = false } = {}) {
  if (configExists() && !force) {
    return { created: false, config: loadConfig() };
  }
  const config = saveConfig(emptyConfig());
  return { created: true, config };
}

export function addBrand(partial) {
  const config = loadConfig();
  const brand = BrandSchema.parse({ id: randomUUID(), ...partial });
  config.brands.push(brand);
  saveConfig(config);
  return brand;
}

/**
 * Partial update of one brand (dashboard Settings tab). Whitelisted profile
 * fields only — id is immutable. Returns the updated brand, or null if no
 * brand has that id. Throws (zod) on invalid values, e.g. a malformed url.
 */
export function updateBrand(id, patch = {}) {
  const config = loadConfig();
  const idx = config.brands.findIndex(b => b.id === id);
  if (idx === -1) return null;
  const merged = { ...config.brands[idx] };
  for (const k of ['name', 'url', 'tagline', 'shortDescription', 'aboutBrand', 'tags', 'isActive']) {
    if (patch[k] !== undefined) merged[k] = patch[k];
  }
  config.brands[idx] = BrandSchema.parse({ ...merged, id });
  saveConfig(config);
  return config.brands[idx];
}

export function removeBrand(idOrName) {
  const config = loadConfig();
  const before = config.brands.length;
  config.brands = config.brands.filter(
    b => b.id !== idOrName && b.name.toLowerCase() !== String(idOrName).toLowerCase()
  );
  saveConfig(config);
  return before - config.brands.length;
}

export function activeBrands() {
  return loadConfig().brands.filter(b => b.isActive);
}

/**
 * Resolve a free-form brand reference (a UUID *or* a display name — the
 * discovery subagent passes either) to the canonical `{ id, name }`. Returns
 * null when the reference is empty or matches no configured brand, so callers
 * can store a clean null rather than an unresolved string. Matching config as
 * the source of truth here keeps `opportunities.brand_id` an actual brand id
 * (what the dashboard filter queries by) and `brand_name` the label.
 */
export function resolveBrand(idOrName, brands = loadConfig().brands) {
  const ref = String(idOrName ?? '').trim();
  if (!ref) return null;
  const lower = ref.toLowerCase();
  const match = brands.find(b => b.id === ref || b.name.toLowerCase() === lower);
  return match ? { id: match.id, name: match.name } : null;
}
