import { Fragment } from 'react';
import type { Brand, CanonicalStatus, Opportunity, PerformanceRow } from '../types';
import { isFresh } from '../freshness';
import { runKey } from '../queueOrder';
import { Metric } from './PerfMetrics';

interface Props {
  opportunities: Opportunity[];
  brands: Brand[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Performance check-ins by opportunity id (Submitted view, Pro) — rows with a match grow metric chips. */
  perf?: Map<string, PerformanceRow>;
  /** Opportunities view: strike through posted rows (done, kept as history).
   *  Off in Submitted, where every row is posted. */
  strikePosted?: boolean;
  /** When set, rows grow hover-revealed quick-triage icons (✓ mark posted /
   *  ✕ ignore) so the queue can be cleaned without opening the detail pane. */
  onSetStatus?: (id: string, status: CanonicalStatus) => void;
  /** Score sort: the list arrives grouped by run — draw a divider where the run changes. */
  runGroups?: boolean;
  /** Score sort: put the relevance score on each row (it's what the order means). */
  showScore?: boolean;
}

export function relativeAge(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function brandLabel(o: Opportunity, brands: Brand[]): string {
  if (o.brandName) return o.brandName;
  if (o.brandId) return brands.find(b => b.id === o.brandId)?.name ?? '';
  return '';
}

/**
 * Opportunity queue as card rows (title / meta) — the same organisation as the
 * extension's Opportunities list, so the two surfaces read the same way. The
 * relevance score lives in the detail pane by default (with the bar at 6 the
 * list scores cluster at 7–8, so the per-row number was just noise); under the
 * score sort it comes back onto the row, since the order is the score. Clicking
 * a row selects it into the detail pane; the title link opens the source post.
 */
export function QueueTable({ opportunities, brands, selectedId, onSelect, perf, strikePosted, onSetStatus, runGroups, showScore }: Props) {
  if (!opportunities.length) {
    return <div className="empty">No conversations match the current filters.</div>;
  }
  // Newest row per run block — the divider's timestamp. Computed once, not per row.
  const blockNewest = new Map<string, string>();
  if (runGroups) {
    for (const o of opportunities) {
      const k = runKey(o);
      const cur = blockNewest.get(k);
      if (!cur || Date.parse(o.createdAt) > Date.parse(cur)) blockNewest.set(k, o.createdAt);
    }
  }
  return (
    <div className="opp-list">
      {opportunities.map((o, i) => {
        const brand = brandLabel(o, brands);
        const p = perf?.get(o.id);
        const key = runKey(o);
        const startsBlock = runGroups && (i === 0 || runKey(opportunities[i - 1]) !== key);
        const divider = startsBlock && (
          <div className="run-divider" key={`run:${key}:${i}`}>
            {o.runId ? 'run' : 'no run'} · {relativeAge(blockNewest.get(key) ?? o.createdAt)} ago
          </div>
        );
        const row = (
          <button
            key={o.id}
            type="button"
            className={`opp-row${o.id === selectedId ? ' selected' : ''}${p ? ' perf-row' : ''}${strikePosted && o.status === 'posted' ? ' posted' : ''}`}
            onClick={() => onSelect(o.id)}
          >
            <span className="row-main">
              <span className="row-title">
                <a
                  href={o.platformUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                >
                  {o.title || '(untitled)'}
                </a>
                {/* One filled badge, after the title: POSTED wins over NEW. */}
                {o.status === 'posted'
                  ? <span className="badge-fresh badge-posted">POSTED</span>
                  : isFresh(o) && <span className="badge-fresh">NEW</span>}
              </span>
              <span className="row-meta">
                {showScore && (
                  <span className={`row-score${o.relevanceScore == null ? ' unscored' : ''}`}>
                    {o.relevanceScore == null ? '–' : o.relevanceScore}/10
                  </span>
                )}
                {o.platform}
                {brand && <> · {brand}</>}
                {' · '}
                {relativeAge(o.createdAt)}
                {/* Mixed-status queue: label anything that moved past new.
                    Posted already has its filled title badge — no pill too. */}
                {o.status !== 'new' && o.status !== 'posted' && !perf && (
                  <span className={`pill pill-${o.status}`}>{o.status}</span>
                )}
              </span>
            </span>
            {p && (
              <>
                <Metric label="upvotes" first={p.firstUpvotes} latest={p.upvotes} />
                <Metric label="replies" first={p.firstReplies} latest={p.replies} />
              </>
            )}
            {/* Spans, not buttons: the row itself is a <button> and nesting is
                invalid — same reason the title link stopPropagations. Posted
                rows are history; their only quick action is undoing a
                mis-clicked ✓. */}
            {onSetStatus && o.status === 'posted' && strikePosted && (
              <span className="row-actions">
                <span
                  role="button"
                  className="row-action act-undo"
                  title="Undo — not actually posted"
                  onClick={e => { e.stopPropagation(); onSetStatus(o.id, 'reviewed'); }}
                >
                  ↺
                </span>
              </span>
            )}
            {onSetStatus && o.status !== 'posted' && (
              <span className="row-actions">
                <span
                  role="button"
                  className="row-action act-post"
                  title="Mark posted"
                  onClick={e => { e.stopPropagation(); onSetStatus(o.id, 'posted'); }}
                >
                  ✓
                </span>
                <span
                  role="button"
                  className="row-action act-skip"
                  title="Ignore"
                  onClick={e => { e.stopPropagation(); onSetStatus(o.id, 'skipped'); }}
                >
                  ✕
                </span>
              </span>
            )}
          </button>
        );
        return <Fragment key={o.id}>{divider}{row}</Fragment>;
      })}
    </div>
  );
}
