import { useEffect, useState } from 'react';
import { COMMANDS, NEED_LABELS, slashNs } from '../commands';

interface Props {
  pro: boolean;
  onClose: () => void;
  onUpgrade: () => void;
}

/** Details for every slash command: what it does, what it needs, an example
 *  to copy. Opened from the "?" in the sidebar's command list. */
export function CommandsModal({ pro, onClose, onUpgrade }: Props) {
  const [copied, setCopied] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card commands-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Slash commands"
        onClick={e => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>Slash commands</h2>
          <button className="copy" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="upgrade-sub">
          Type these in Claude Code with the Social Cue plugin installed. In Codex, ask it to
          use the matching <code>socialcue</code> skill instead. This dashboard only shows state;
          the agent does the work.
        </p>
        {COMMANDS.map(c => {
          const gated = c.needs.includes('pro') && !pro;
          const line = `${slashNs(c)}${c.example ? ' ' + c.example : ''}`;
          return (
            <article key={c.name} className="cmd-detail">
              <h3>
                <code>{slashNs(c)}</code>
                {gated && <span className="badge badge-pro">Pro</span>}
              </h3>
              <p>{c.description}</p>
              {c.needs.length > 0 && (
                <p className="cmd-needs">
                  Needs: {c.needs.map(n => NEED_LABELS[n]).join(', ')}
                  {gated && (
                    <>
                      {' · '}
                      <button type="button" className="linkish" onClick={onUpgrade}>Get Pro</button>
                    </>
                  )}
                </p>
              )}
              <div className="cmd-box">
                <code>{line}</code>
                <button className="copy" type="button" onClick={() => copy(line, c.name)}>
                  {copied === c.name ? 'Copied' : 'Copy'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
