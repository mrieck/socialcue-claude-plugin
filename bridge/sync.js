/**
 * POST /api/sync — the extension push/pull protocol.
 *
 * Request  { push:  [extension Opportunity, ...],   // new/changed since watermark
 *            known: [{ id, url }, ...] }            // everything the extension holds
 * Response { imported, merged,
 *            statuses: [{ id, status }, ...] }      // extension vocab, for pull-back
 *
 * Rules (locked in the plan):
 *  - Identity is normalizeUrl(platformUrl) — first wins, existing rows are never
 *    overwritten (the plugin row is usually richer and may already be triaged).
 *  - Status conflict: the extension's status is applied only while the canonical
 *    row is still 'new' (untriaged); otherwise the canonical status wins and
 *    flows back down via `statuses`.
 *  - Brand: resolve brandName case-insensitively against config.brands.
 */
import * as db from '../lib/db.js';
import * as cfg from '../lib/config.js';
import { OpportunitySchema } from '../vendor/shared/schema.js';
import { extToCanonical, canonicalToExt } from './status-map.js';
import { bumpWrites } from './changes.js';

export function buildSyncHandler() {
  return function handleSync(body) {
    const push = Array.isArray(body?.push) ? body.push : [];
    const known = Array.isArray(body?.known) ? body.known : [];

    const brands = cfg.loadConfig().brands;
    const brandIdByName = new Map(brands.map(b => [b.name.toLowerCase(), b.id]));

    let imported = 0;
    let merged = 0;
    let mutated = 0;

    for (const raw of push) {
      if (!raw?.platformUrl || !raw?.platform) continue;
      const canonicalStatus = extToCanonical(raw.status);

      const existing = db.findOpportunityByUrl(raw.platformUrl);
      if (existing) {
        merged++;
        if (existing.status === 'new' && canonicalStatus !== 'new') {
          db.setOpportunityStatus(existing.id, canonicalStatus);
          mutated++;
        }
        continue;
      }

      let opp;
      try {
        opp = OpportunitySchema.parse({
          ...raw,
          source: 'extension',
          status: canonicalStatus,
          brandId: brandIdByName.get(String(raw.brandName ?? '').toLowerCase()) ?? null,
          brandName: raw.brandName ?? '',
          runId: null,
          screenshotPath: null,
        });
      } catch {
        continue; // skip malformed items; never fail the whole sync
      }
      db.addOpportunity(opp);
      imported++;
      mutated++;
    }
    if (mutated) bumpWrites(); // wake dashboard polls

    const statuses = [];
    for (const k of known) {
      if (!k?.id || !k?.url) continue;
      const row = db.findOpportunityByUrl(k.url);
      if (row) statuses.push({ id: k.id, status: canonicalToExt(row.status) });
    }

    return { imported, merged, statuses };
  };
}
