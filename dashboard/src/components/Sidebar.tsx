import type { Counts, View } from '../types';

interface Props {
  view: View;
  counts: Counts;
  onNavigate: (v: View) => void;
}

const ITEMS: { view: View; label: string; countKey?: keyof Counts }[] = [
  { view: 'opportunities', label: 'Opportunities', countKey: 'opportunities' },
  { view: 'submitted', label: 'Submitted', countKey: 'submitted' },
  { view: 'content', label: 'Content Strategy', countKey: 'content' },
  { view: 'directories', label: 'Directories' },
  { view: 'settings', label: 'Settings' },
];

/**
 * Left sidebar — mirrors the extension's options-page nav so the two surfaces
 * read as one product. Badge counts come from the /api/changes poll.
 */
export function Sidebar({ view, counts, onNavigate }: Props) {
  return (
    <aside className="sidebar">
      <div className="brand-title">Social Cue</div>
      <nav className="nav">
        {ITEMS.map(item => {
          const count = item.countKey ? counts?.[item.countKey] ?? 0 : 0;
          return (
            <button
              key={item.view}
              type="button"
              aria-current={view === item.view ? 'page' : undefined}
              onClick={() => onNavigate(item.view)}
            >
              {item.label}
              {count > 0 && <span className="nav-count">{count}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
