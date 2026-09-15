import { useRef, useState } from 'react';
import { ApiError, openLead, patchLead } from '../api';
import type { Brand, Lead, LeadStatus } from '../types';
import { relativeAge } from './QueueTable';

/**
 * Founder invitations (Pro) inside the Conversations view. They used to have
 * their own tab, but the UI is the same shape as a conversation (a person on
 * the left, "how good a match" on the right), so they live as a block pinned
 * to the bottom of the queue instead. Dismiss (✕) skips the lead for good —
 * skipped and closed leads never show again.
 *
 * Nothing here sends a message: "Message" copies the DM to the clipboard and
 * opens the person's profile in the dedicated browser; the user clicks the
 * platform's message button and pastes. It stays disabled until the linked
 * public reply is posted — reply first, DM second.
 */

const STAGES: { status: LeadStatus; label: string; verb: string }[] = [
  { status: 'candidate', label: 'Reply first', verb: 'Back to candidate' },
  { status: 'replied', label: 'Replied — ready to invite', verb: 'Reply posted' },
  { status: 'invited', label: 'Invited', verb: 'Mark invited' },
  { status: 'responded', label: 'Responded', verb: 'They responded' },
  { status: 'setup_done', label: 'Setup completed', verb: 'Setup done' },
  { status: 'first_result', label: 'First useful result', verb: 'First result' },
  { status: 'closed', label: 'Closed', verb: 'Close' },
  { status: 'skipped', label: 'Dismissed', verb: 'Dismiss' },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.status, i])) as Record<LeadStatus, number>;

const STATUS_PILL: Record<LeadStatus, string> = {
  candidate: 'pill-new',
  replied: 'pill-reviewed',
  invited: 'pill-approved',
  responded: 'pill-approved',
  setup_done: 'pill-posted',
  first_result: 'pill-posted',
  closed: 'pill-skipped',
  skipped: 'pill-skipped',
};

/** Leads still worth showing: anything not dismissed or closed. */
export function isOpenLead(l: Lead): boolean {
  return l.status !== 'skipped' && l.status !== 'closed';
}

export function leadBrandName(l: Lead, brands: Brand[]): string {
  return l.brandName || (l.brandId && brands.find(b => b.id === l.brandId)?.name) || '';
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface ListProps {
  leads: Lead[];
  brands: Brand[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDismiss: (id: string) => void;
}

/** The pinned block under the conversation queue. Renders nothing when empty. */
export function InvitationsList({ leads, brands, selectedId, onSelect, onDismiss }: ListProps) {
  if (!leads.length) return null;
  const rows = [...leads].sort((a, b) => (b.fitScore ?? -1) - (a.fitScore ?? -1));
  return (
    <div className="invites-pinned">
      <div className="run-divider">Invitations · {rows.length} — people who asked for what you built</div>
      <div className="opp-list">
        {rows.map(l => {
          const brand = leadBrandName(l, brands);
          return (
            <button
              key={l.id}
              type="button"
              className={`opp-row${l.id === selectedId ? ' selected' : ''}`}
              onClick={() => onSelect(l.id)}
            >
              <span className="row-main">
                <span className="row-title">
                  <span>{l.handle || l.profileUrl}</span>
                  {l.productName && <span className="muted">{'\u00a0· '}{l.productName}</span>}
                  {l.oppReplyCount != null && l.oppReplyCount > 0 && l.status === 'replied' && (
                    <span className="badge-fresh">OP REPLIED</span>
                  )}
                </span>
                <span className="row-meta">
                  <span className="row-score">{l.fitScore ?? '–'}/10</span>
                  {l.platform}
                  {brand && <> · {brand}</>}
                  {' · '}
                  {relativeAge(l.createdAt)}
                  <span className={`pill ${STATUS_PILL[l.status]}`}>{l.status.replace('_', ' ')}</span>
                </span>
              </span>
              <span className="row-actions">
                <span
                  role="button"
                  className="row-action act-skip"
                  title="Dismiss — never show this person again"
                  onClick={e => { e.stopPropagation(); onDismiss(l.id); }}
                >
                  ✕
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface DetailProps {
  lead: Lead;
  brandName: string;
  onChanged: (l: Lead) => void;
  onOpenLicense: () => void;
  /** Select the linked conversation in the queue. */
  onOpenConversation: (oppId: string) => void;
}

export function LeadDetail({ lead, brandName, onChanged, onOpenLicense, onOpenConversation }: DetailProps) {
  const [dm, setDm] = useState(lead.userDm ?? lead.draftDm);
  const [objection, setObjection] = useState(lead.objection);
  const [note, setNote] = useState(lead.note);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const leadRef = useRef(lead);
  leadRef.current = lead;

  const edited = dm.trim() !== lead.draftDm.trim() && dm.trim() !== '';

  const save = async (patch: Parameters<typeof patchLead>[1], flash?: string) => {
    try {
      onChanged(await patchLead(leadRef.current.id, patch));
      if (flash) setMsg({ text: flash, ok: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) { onOpenLicense(); return; }
      setMsg({ text: 'Save failed — is the bridge running?', ok: false });
    }
  };

  // Blur-autosave, same rule as the reply editor: trimmed text equal to the
  // original clears the edit.
  const flushDm = () => {
    const text = dm.trim();
    const next = text && text !== lead.draftDm.trim() ? text : null;
    if (next === (lead.userDm ?? null)) return;
    void save({ userDm: next ?? '' }, 'Draft saved');
  };
  const flushObjection = () => { if (objection !== lead.objection) void save({ objection }); };
  const flushNote = () => { if (note !== lead.note) void save({ note }); };

  // Reply first, DM second: the linked reply's real status decides, so a reply
  // marked posted in the queue unlocks Message here without a second click.
  const replyPosted = !lead.oppId || lead.oppStatus === 'posted';
  const canMessage = replyPosted && lead.status !== 'skipped' && lead.status !== 'closed';

  const message = async () => {
    setBusy(true);
    setMsg(null);
    flushDm();
    if (dm.trim()) await navigator.clipboard.writeText(dm).catch(() => {});
    try {
      const r = await openLead(lead.id);
      setMsg({ text: `${r.message} Your DM is on the clipboard — open their messages and paste.`, ok: r.opened });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) { onOpenLicense(); }
      else if (err instanceof ApiError && err.status === 502) setMsg({ text: `Couldn't reach the browser: ${err.message}`, ok: false });
      else setMsg({ text: 'Bridge unreachable — is `bridge start` running?', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (status: LeadStatus) => void save({ status });

  // Forward moves only, plus close/dismiss; "back to candidate" is available
  // for mistakes. A candidate whose reply is already posted skips straight to
  // "Mark invited" — the "Reply posted" step is implied by the linked reply.
  const effective: LeadStatus = lead.status === 'candidate' && replyPosted && lead.oppId ? 'replied' : lead.status;
  const nextStages = STAGES.filter(s =>
    s.status !== lead.status && s.status !== effective &&
    (s.status === 'closed' || s.status === 'skipped' || s.status === 'candidate' ||
      STAGE_INDEX[s.status] === STAGE_INDEX[effective] + 1));

  return (
    <aside className="detail">
      <header>
        <span className="score big">{lead.fitScore ?? '?'}/10</span>
        <div>
          <h2>
            <a href={lead.profileUrl} target="_blank" rel="noreferrer">{lead.handle || lead.profileUrl}</a>
          </h2>
          {lead.productUrl
            ? <a className="url-line" href={lead.productUrl} target="_blank" rel="noreferrer">{lead.productName || lead.productUrl} ↗</a>
            : lead.productName && <div className="url-line">{lead.productName}</div>}
          <div className="meta">
            Invitation · {lead.platform} · {brandName || 'no brand'} · <span className={`pill ${STATUS_PILL[lead.status]}`}>{lead.status.replace('_', ' ')}</span>
          </div>
        </div>
      </header>

      <section>
        <h3>Their ask</h3>
        <blockquote className="posted-reply">{lead.ask || '(not captured)'}</blockquote>
        {lead.oppId ? (
          <p className="path">
            Public reply: {lead.oppStatus ?? 'unknown'}
            {lead.oppReplyCount != null && lead.oppReplyCount > 0 && ' · they replied to it'}
            {' · '}
            <button type="button" className="copy" onClick={() => onOpenConversation(lead.oppId!)}>open conversation</button>
          </p>
        ) : (
          <p className="path">No collected reply linked — reply publicly first, then invite.</p>
        )}
      </section>

      <section>
        <h3>Why they fit</h3>
        <p>{lead.fitSummary}</p>
        {lead.evidence.length > 0 && (
          <ul className="lead-evidence">
            {lead.evidence.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
        {lead.disqualifiers && <p className="post-msg err">Watch out: {lead.disqualifiers}</p>}
      </section>

      <section>
        <h3>
          Invitation DM
          {edited && (
            <button
              type="button"
              className="badge badge-edited badge-revert"
              title="Revert to the drafted DM"
              onClick={() => { setDm(lead.draftDm); void save({ userDm: '' }, 'Reverted'); }}
            >
              <span className="badge-idle">edited</span>
              <span className="badge-hover">revert</span>
            </button>
          )}
        </h3>
        <div className="draft-editor">
          <textarea
            rows={7}
            value={dm}
            onChange={e => setDm(e.target.value)}
            onBlur={flushDm}
          />
        </div>
        <div className="post-row">
          <button
            type="button"
            className="copy"
            disabled={busy || !canMessage}
            title={canMessage ? 'Copy the DM and open their profile in the Social Cue browser' : 'Post the public reply first, then mark it posted in the queue'}
            onClick={() => void message()}
          >
            {busy ? 'Opening…' : 'Message (copy + open profile)'}
          </button>
          {!replyPosted && <span className="muted">reply first — the public reply isn't posted yet</span>}
          {msg && <span className={msg.ok ? 'post-msg ok' : 'post-msg err'}>{msg.text}</span>}
        </div>
      </section>

      <section>
        <h3>Pipeline</h3>
        <div className="status-buttons lead-pipeline">
          {nextStages.map(s => (
            <button key={s.status} type="button" onClick={() => setStatus(s.status)}>{s.verb}</button>
          ))}
        </div>
        <p className="path">
          invited {fmtDate(lead.invitedAt)} · responded {fmtDate(lead.respondedAt)} · setup {fmtDate(lead.setupAt)} · first result {fmtDate(lead.firstResultAt)}
        </p>
      </section>

      <section>
        <h3>Objection / next step</h3>
        <textarea className="note-input" rows={2} value={objection} onChange={e => setObjection(e.target.value)} onBlur={flushObjection} placeholder="What they said no to, or what happens next" />
      </section>
      <section>
        <h3>Notes</h3>
        <textarea className="note-input" rows={2} value={note} onChange={e => setNote(e.target.value)} onBlur={flushNote} />
      </section>
    </aside>
  );
}
