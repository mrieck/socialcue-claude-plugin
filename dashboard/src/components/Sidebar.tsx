import { useState } from 'react';
import type { Counts, View } from '../types';
import { COMMANDS, slash, slashNs } from '../commands';

interface Props {
  view: View;
  counts: Counts;
  pro: boolean;
  onNavigate: (v: View) => void;
  onOpenCommands: () => void;
}

const ITEMS: { view: View; label: string; countKey?: keyof Counts }[] = [
  { view: 'opportunities', label: 'Conversations', countKey: 'opportunities' },
  { view: 'posts', label: 'Product Posts' },
  { view: 'content', label: 'Content Library', countKey: 'content' },
  { view: 'analytics', label: 'Analytics', countKey: 'analytics' },
  { view: 'settings', label: 'Settings' },
];

/**
 * Left sidebar — mirrors the extension's options-page nav so the two surfaces
 * read as one product. Badge counts come from the /api/changes poll. The
 * slash-command list at the bottom copies the namespaced form users type.
 */
export function Sidebar({ view, counts, pro, onNavigate, onOpenCommands }: Props) {
  const [copied, setCopied] = useState('');
  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  return (
    <aside className="sidebar">
      <div className="brand-title">Social Cue</div>
      <nav className="nav">
        {ITEMS.map(item => {
          // Pending invitations roll into the Conversations badge.
          const count = (item.countKey ? counts?.[item.countKey] ?? 0 : 0)
            + (item.view === 'opportunities' ? counts?.invitations ?? 0 : 0);
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
      <section className="sidebar-cmds" aria-label="Slash commands">
        <div className="sidebar-cmds-head">
          <span>Slash commands</span>
          <button className="copy" type="button" onClick={onOpenCommands} aria-label="Command details" title="What each command does">?</button>
        </div>
        <ul>
          {COMMANDS.map(c => (
            <li key={c.name} className="cmd-row" title={c.hint}>
              <code>{slash(c)}</code>
              {c.needs.includes('pro') && !pro && <span className="badge badge-pro">Pro</span>}
              <button className="copy" type="button" onClick={() => copy(slashNs(c), c.name)} aria-label={`Copy ${slashNs(c)}`}>
                {copied === c.name ? 'ok' : 'copy'}
              </button>
            </li>
          ))}
        </ul>
        <p className="sidebar-cmds-note">Run these in Claude Code, or ask Codex to use the skill.</p>
      </section>
    </aside>
  );
}
