export function SourceBadge({ source }: { source: 'plugin' | 'extension' }) {
  return <span className={`badge badge-${source}`}>{source}</span>;
}
