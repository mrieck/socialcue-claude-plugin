import { useState } from 'react';
import type { OpportunityPatch } from '../api';
import type { Brand, CanonicalStatus, Filters, Opportunity, PerformanceRow } from '../types';
import { GoalsBoard } from './GoalsBoard';
import { ActivityLog } from './ActivityLog';
import { FilterBar } from './FilterBar';
import { QueueTable } from './QueueTable';
import { DetailPane } from './DetailPane';

type Tab = 'activity' | 'replies';
const TAB_KEY = 'sc-analytics-tab';
function loadTab(): Tab {
  try { return localStorage.getItem(TAB_KEY) === 'replies' ? 'replies' : 'activity'; } catch { return 'activity'; }
}

interface Props {
  dataTick: number;
  brands: Brand[];
  platforms: string[];
  filters: Filters;
  onFiltersChange: (f: Filters) => void;
  opportunities: Opportunity[];
  loading: boolean;
  selected: Opportunity | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  perf: Map<string, PerformanceRow>;
  selectedPerf?: PerformanceRow;
  pro: boolean;
  onOpenLicense: () => void;
  onSetStatus: (id: string, status: CanonicalStatus) => void;
  onUpdate: (id: string, patch: OpportunityPatch) => Promise<void>;
  onExampleSaved: (id: string, exampleSavedAt: string) => void;
}

/**
 * Analytics view: the weekly Goals board on top, then two tabs — the activity
 * log (rows act on themselves, nothing to select) and the posted-replies list
 * (formerly the "Submitted" tab — same rows, same Pro performance chips). The
 * detail pane only exists on the replies tab, since only replies open there.
 */
export function AnalyticsPanel({
  dataTick, brands, platforms, filters, onFiltersChange, opportunities, loading,
  selected, selectedId, onSelect, perf, selectedPerf, pro, onOpenLicense,
  onSetStatus, onUpdate, onExampleSaved,
}: Props) {
  const [tab, setTabState] = useState<Tab>(loadTab);
  const [activityCount, setActivityCount] = useState<number | null>(null);
  const setTab = (t: Tab) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* private mode etc. */ }
  };
  const tabButton = (t: Tab, label: string, count: number | null) => (
    <button
      type="button"
      role="tab"
      className={`pane-tab${tab === t ? ' active' : ''}`}
      aria-selected={tab === t}
      onClick={() => setTab(t)}
    >
      {label}
      {count != null && count > 0 && <span className="nav-count">{count}</span>}
    </button>
  );

  return (
    <div className="main analytics">
      <div className="queue-wrap analytics-wrap">
        <GoalsBoard dataTick={dataTick} brands={brands} />
        <div className="pane-tabs" role="tablist">
          {tabButton('activity', 'Activity log', activityCount)}
          {tabButton('replies', 'Submitted replies', opportunities.length)}
        </div>
        {/* Mounted on both tabs so its count and kind filter survive switching. */}
        <div hidden={tab !== 'activity'}>
          <ActivityLog dataTick={dataTick} pro={pro} onCount={setActivityCount} />
        </div>
        {tab === 'replies' && (
          <>
            <p className="view-note">
              Replies you marked posted{pro ? ', with performance check-ins' : ''}. Select one to see how it did.
            </p>
            <FilterBar filters={filters} brands={brands} platforms={platforms} onChange={onFiltersChange} />
            {loading
              ? <div className="empty">Loading…</div>
              : <QueueTable
                  opportunities={opportunities}
                  brands={brands}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  perf={perf}
                />}
          </>
        )}
      </div>
      {tab === 'replies' && (
        <DetailPane
          opportunity={selected}
          brands={brands}
          onSetStatus={onSetStatus}
          onUpdate={onUpdate}
          onExampleSaved={onExampleSaved}
          pro={pro}
          onOpenLicense={onOpenLicense}
          perf={selectedPerf}
        />
      )}
    </div>
  );
}
