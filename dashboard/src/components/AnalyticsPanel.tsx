import type { OpportunityPatch } from '../api';
import type { Brand, CanonicalStatus, Filters, Opportunity, PerformanceRow } from '../types';
import { GoalsBoard } from './GoalsBoard';
import { FilterBar } from './FilterBar';
import { QueueTable } from './QueueTable';
import { DetailPane } from './DetailPane';

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
 * Analytics view: the weekly Goals board on top, then the posted-replies list
 * (formerly the "Submitted" tab — same rows, same Pro performance chips) with
 * the detail pane alongside. The board lives inside the scrolling queue column
 * so the detail pane keeps its full-height column untouched.
 */
export function AnalyticsPanel({
  dataTick, brands, platforms, filters, onFiltersChange, opportunities, loading,
  selected, selectedId, onSelect, perf, selectedPerf, pro, onOpenLicense,
  onSetStatus, onUpdate, onExampleSaved,
}: Props) {
  return (
    <div className="main">
      <div className="queue-wrap analytics-wrap">
        <GoalsBoard dataTick={dataTick} brands={brands} />
        <div className="content-head">
          <h2>Submitted replies</h2>
          {opportunities.length > 0 && <span className="nav-count">{opportunities.length}</span>}
          <span className="muted">replies you've marked posted{pro ? ' — with performance check-ins' : ''}</span>
        </div>
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
      </div>
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
    </div>
  );
}
