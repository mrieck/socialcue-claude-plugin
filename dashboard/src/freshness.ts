/**
 * Freshness — the "worth engaging right now" signal that drives the NEW badge.
 *
 * Mirror of socialcue-shared/src/freshness.js (this dashboard is its own Vite
 * build and can't import the vendored JS brain, the same reason CanonicalStatus
 * is duplicated in types.ts). Keep the constants and logic in sync with that
 * source of truth.
 */
import type { Opportunity } from './types';

export const FRESH_PUBLISHED_HOURS = 4;
export const FRESH_FOUND_HOURS = 24;

export function isFresh(opp: Pick<Opportunity, 'publishedAt' | 'createdAt'>, nowMs: number = Date.now()): boolean {
  if (!opp.publishedAt) return false;
  const pub = Date.parse(opp.publishedAt);
  if (Number.isNaN(pub)) return false;
  if (nowMs - pub > FRESH_PUBLISHED_HOURS * 3600e3) return false;
  const found = Date.parse(opp.createdAt);
  return Number.isNaN(found) || nowMs - found <= FRESH_FOUND_HOURS * 3600e3;
}
