import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  disabled?: boolean;
  title?: string;
}

// Confirm via our own modal, never window.confirm(): Playwright auto-dismisses
// native dialogs in the automated Chrome the dashboard runs in.
export function ConfirmButton({ label, question, confirmLabel = 'Yes', onConfirm, className = 'copy', disabled, title }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={disabled} title={title} onClick={e => { e.stopPropagation(); setOpen(true); }}>
        {label}
      </button>
      {open && (
        <ConfirmModal
          question={question}
          confirmLabel={confirmLabel}
          onConfirm={onConfirm}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function ConfirmModal({ question, confirmLabel, onConfirm, onClose }: {
  question: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const yesRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    yesRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); onClose(); }
  };

  return (
    <div className="modal-backdrop" onClick={e => { e.stopPropagation(); onClose(); }}>
      <div className="modal-card confirm-modal" role="alertdialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <p className="confirm-q">{question}</p>
        <div className="confirm-actions">
          <button type="button" className="copy" onClick={onClose}>Cancel</button>
          <button ref={yesRef} type="button" className="copy danger" disabled={busy} onClick={() => void confirm()}>
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
