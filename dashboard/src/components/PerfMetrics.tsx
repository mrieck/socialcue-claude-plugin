/** Compact performance metric chip (Pro): latest value + delta vs first check. */

export function delta(first: number | null, latest: number | null): string | null {
  if (first == null || latest == null || latest === first) return null;
  const d = latest - first;
  return d > 0 ? `+${d}` : `${d}`;
}

export function Metric({ label, first, latest }: { label: string; first: number | null; latest: number | null }) {
  const d = delta(first, latest);
  return (
    <span className="perf-metric">
      <span className="perf-value">{latest ?? '—'}</span>
      {d && <span className={`perf-delta${d.startsWith('+') ? ' up' : ''}`}>{d}</span>}
      <span className="perf-label">{label}</span>
    </span>
  );
}
