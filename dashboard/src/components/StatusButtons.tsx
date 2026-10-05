import type { CanonicalStatus } from '../types';

// Triage is deliberately just two calls: mark it posted once you've engaged, or
// ignore it. "Post" itself is the assisted-post button in the detail pane; there
// are no intermediate reviewed/approved states to set by hand.
const ACTIONS: { status: CanonicalStatus; label: string }[] = [
  { status: 'posted', label: 'Mark posted' },
  { status: 'skipped', label: 'Ignore' },
];

interface Props {
  current: CanonicalStatus;
  onSet: (status: CanonicalStatus) => void;
}

export function StatusButtons({ current, onSet }: Props) {
  return (
    <div className="status-buttons">
      {ACTIONS.map(a => (
        <button
          key={a.status}
          className={current === a.status ? 'active' : ''}
          onClick={() => onSet(a.status)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
