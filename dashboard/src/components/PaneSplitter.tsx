import type { PointerEvent } from 'react';

const KEY = 'sc-list-w';
const MIN_PX = 280;
const MAX_FRAC = 0.65;

function setListWidth(px: number | null) {
  if (px == null) document.documentElement.style.removeProperty('--list-w');
  else document.documentElement.style.setProperty('--list-w', `${Math.round(px)}px`);
}

/** Restore the saved list width on load (before the first paint of .main). */
export function applySavedListWidth() {
  try {
    const v = Number(localStorage.getItem(KEY));
    if (v >= MIN_PX) setListWidth(v);
  } catch { /* private mode etc. */ }
}

/**
 * Drag handle between the list column and the reading/editor pane (Outlook
 * style). Writes --list-w on <html> so every view shares the width; the
 * value persists across reloads. Double-click resets to the default.
 */
export function PaneSplitter() {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const main = e.currentTarget.parentElement;
    if (!main) return;
    e.preventDefault();
    const left = main.getBoundingClientRect().left;
    const max = main.clientWidth * MAX_FRAC;
    let width = 0;
    document.body.classList.add('resizing');
    const move = (ev: globalThis.PointerEvent) => {
      width = Math.min(max, Math.max(MIN_PX, ev.clientX - left));
      setListWidth(width);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing');
      if (width) try { localStorage.setItem(KEY, String(Math.round(width))); } catch { /* ignore */ }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const reset = () => {
    setListWidth(null);
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  };
  return (
    <div
      className="pane-splitter"
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onDoubleClick={reset}
    />
  );
}
