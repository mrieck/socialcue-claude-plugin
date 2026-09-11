import type { Brand, Filters } from '../types';

interface Props {
  filters: Filters;
  brands: Brand[];
  platforms: string[];
  onChange: (f: Filters) => void;
  /** Opportunities view only: bulk-skip the whole queue. */
  onClearAll?: () => void;
}

// There is deliberately no status filter: the Opportunities view shows every
// reply that's still in play (all statuses except skipped/posted) so nothing
// falls into a gap between tabs, and Submitted is fixed to posted.
export function FilterBar({ filters, brands, platforms, onChange, onClearAll }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <div className="filter-bar">
      <label>
        Platform
        <select value={filters.platform} onChange={e => set({ platform: e.target.value })}>
          <option value="">all</option>
          {platforms.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </label>
      <label>
        Brand
        <select value={filters.brand} onChange={e => set({ brand: e.target.value })}>
          <option value="">all</option>
          {brands.map(b => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>
      <label>
        Source
        <select value={filters.source} onChange={e => set({ source: e.target.value })}>
          <option value="">both</option>
          <option value="plugin">plugin</option>
          <option value="extension">extension</option>
        </select>
      </label>
      {onClearAll && (
        <button type="button" className="copy clear-all" onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  );
}
