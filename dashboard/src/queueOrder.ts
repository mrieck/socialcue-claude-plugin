import type { Opportunity, QueueSort } from './types';

/**
 * Order the queue for display.
 *
 * '' (newest) keeps the bridge's order: created_at DESC.
 *
 * 'score' sorts by relevance score, but never across runs: each discovery run
 * stays together as a block, blocks are ordered newest run first, and only
 * inside a block do rows sort by score (highest first, unscored last, ties by
 * recency). A strong 8 from last week therefore never floats above today's
 * run — the queue still reads top-down as "this run, then the one before".
 *
 * Rows with no run (extension finds) each form their own block, placed by
 * their own timestamp, so they slot in between runs by time.
 */
export function orderQueue(opps: Opportunity[], sort: QueueSort): Opportunity[] {
  if (sort !== 'score') return opps;

  const blocks = new Map<string, { newestAt: number; items: Opportunity[] }>();
  for (const o of opps) {
    const key = o.runId ?? `single:${o.id}`;
    const at = Date.parse(o.createdAt) || 0;
    const b = blocks.get(key);
    if (b) {
      b.items.push(o);
      if (at > b.newestAt) b.newestAt = at;
    } else {
      blocks.set(key, { newestAt: at, items: [o] });
    }
  }

  const byScore = (a: Opportunity, b: Opportunity) => {
    const sa = a.relevanceScore ?? -1;
    const sb = b.relevanceScore ?? -1;
    if (sb !== sa) return sb - sa;
    return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
  };

  return [...blocks.values()]
    .sort((a, b) => b.newestAt - a.newestAt)
    .flatMap(b => [...b.items].sort(byScore));
}

/** Run-block key for divider detection: rows with the same key sit under one divider. */
export function runKey(o: Opportunity): string {
  return o.runId ?? 'none';
}
