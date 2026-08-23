/**
 * Status vocabulary mapping between the extension's 3-state popup
 * (new / dismissed / done) and the canonical opportunity lifecycle
 * (new / reviewed / approved / posted / skipped / failed).
 *
 * Round-trip stable: done→posted→done, dismissed→skipped→dismissed, new→new→new.
 * Anything still actionable canonically (reviewed/approved/failed) must remain
 * visible in the popup, so it maps down to 'new'.
 *
 * Mirrored in the extension's src/lib/bridge.ts — keep the two tables in sync.
 */

export const CANONICAL_STATUSES = ['new', 'reviewed', 'approved', 'posted', 'skipped', 'failed'];

const EXT_TO_CANONICAL = {
  new: 'new',
  dismissed: 'skipped',
  done: 'posted',
};

const CANONICAL_TO_EXT = {
  posted: 'done',
  skipped: 'dismissed',
};

/** Extension popup status -> canonical DB status. Unknown input -> 'new'. */
export function extToCanonical(status) {
  return EXT_TO_CANONICAL[status] ?? 'new';
}

/** Canonical DB status -> extension popup status. */
export function canonicalToExt(status) {
  return CANONICAL_TO_EXT[status] ?? 'new';
}
