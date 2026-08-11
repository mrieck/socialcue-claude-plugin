import { useEffect, useRef, useState } from 'react';
import { ApiError, fetchScreenshotUrl, postIntent, saveExample } from '../api';
import type { OpportunityPatch } from '../api';
import type { Brand, CanonicalStatus, Opportunity, PerformanceRow } from '../types';
import { SourceBadge } from './SourceBadge';
import { StatusButtons } from './StatusButtons';
import { brandLabel } from './QueueTable';
import { Metric } from './PerfMetrics';

interface Props {
  opportunity: Opportunity | null;
  brands: Brand[];
  onSetStatus: (id: string, status: CanonicalStatus) => void;
  onUpdate: (id: string, patch: OpportunityPatch) => Promise<void>;
  onExampleSaved: (id: string, exampleSavedAt: string) => void;
  pro: boolean;
  onOpenLicense: () => void;
  /** Performance check-ins for this opportunity (Submitted view, Pro). */
  perf?: PerformanceRow;
}

export function DetailPane({ opportunity: o, brands, onSetStatus, onUpdate, onExampleSaved, pro, onOpenLicense, perf }: Props) {
  const [copied, setCopied] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [shotFailed, setShotFailed] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [savingExample, setSavingExample] = useState(false);

  const flashReview = (text: string) => {
    setReviewMsg(text);
    setTimeout(() => setReviewMsg(null), 2500);
  };

  // Load the screenshot as a blob URL (auth'd) whenever the selection changes.
  const oid = o?.id;
  const hasShot = !!o?.screenshotPath;
  useEffect(() => {
    setShotUrl(null);
    setShotFailed(false);
    if (!oid || !hasShot) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchScreenshotUrl(oid)
      .then(u => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        objectUrl = u;
        setShotUrl(u);
      })
      .catch(() => { if (!cancelled) setShotFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [oid, hasShot]);

  // Reset per-opportunity edit state on selection change.
  const noteFromRow = o?.replyNote ?? '';
  useEffect(() => {
    setShowContext(false);
    setReviewMsg(null);
    setNoteText(noteFromRow);
  }, [oid, noteFromRow]);

  // The draft is always an editable textarea; edits auto-save when focus leaves
  // it or the selection changes/unmounts. `pending` snapshots the row the text
  // belongs to so a late flush can never write to the wrong opportunity.
  const pending = useRef<{ id: string; text: string; suggested: string; user: string | null } | null>(null);
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Reads only refs, so any closure (blur handler, effect cleanup) may call it.
  // Trimmed text matching the original clears the edit — same rule as before.
  const flushDraft = (flash = false): Promise<void> => {
    const p = pending.current;
    pending.current = null;
    if (!p) return Promise.resolve();
    const text = p.text.trim();
    const next = text && text !== p.suggested ? text : null;
    if (next === p.user) return Promise.resolve();
    return onUpdateRef.current(p.id, { userReply: next })
      .then(() => { if (flash) flashReview('Draft saved'); })
      .catch(() => { if (flash) flashReview('Save failed — is the bridge running?'); });
  };

  // Load the selection's draft, saving the previous selection's edit first.
  useEffect(() => {
    void flushDraft();
    setDraftText(o ? o.userReply ?? o.suggestedReply : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oid]);

  // Save on unmount (leaving the queue views entirely).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { void flushDraft(); }, []);

  if (!o) {
    return <aside className="detail empty">Select an opportunity to review it.</aside>;
  }

  const edited = o.userReply != null && o.userReply !== o.suggestedReply;

  const copyReply = async () => {
    await navigator.clipboard.writeText(draftText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const revertEdit = async () => {
    pending.current = null;
    setDraftText(o.suggestedReply);
    try {
      await onUpdate(o.id, { userReply: null });
      flashReview('Reverted to the original draft');
    } catch {
      flashReview('Revert failed — is the bridge running?');
    }
  };

  const saveNote = async () => {
    try {
      await onUpdate(o.id, { replyNote: noteText.trim() });
      flashReview('Note saved — distilled into your voice guidance on the next review');
    } catch {
      flashReview('Save failed — is the bridge running?');
    }
  };

  const promoteExample = async () => {
    setSavingExample(true);
    try {
      const r = await saveExample(o.id);
      onExampleSaved(o.id, r.exampleSavedAt);
      flashReview(`Saved as example (${r.examples} total) — future drafts will match it`);
    } catch (err) {
      flashReview(err instanceof ApiError ? err.message : 'Bridge unreachable');
    } finally {
      setSavingExample(false);
    }
  };

  const postInBrowser = async (submit = false) => {
    setPosting(true);
    setPostMsg(null);
    // The bridge posts the stored effective reply — persist any unsaved edit first.
    await flushDraft();
    // Belt and braces: even total pre-fill failure leaves the draft one paste away.
    if (draftText.trim()) {
      await navigator.clipboard.writeText(draftText).catch(() => {});
    }
    try {
      const r = await postIntent(o.id, { submit });
      setPostMsg({ text: r.message, ok: r.opened });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setPostMsg({ text: 'Pro required — activate a license (License, top right).', ok: false });
      } else if (err instanceof ApiError && err.status === 502) {
        setPostMsg({ text: `Couldn't reach the browser: ${err.message}`, ok: false });
      } else {
        setPostMsg({ text: 'Bridge unreachable — is `bridge start` running?', ok: false });
      }
    } finally {
      setPosting(false);
    }
  };

  const header = (
    <header>
      <span className="score big">{o.relevanceScore ?? '?'}/10</span>
      <div>
        <h2>
          <a href={o.platformUrl} target="_blank" rel="noreferrer">{o.title || '(untitled)'}</a>
        </h2>
        {o.platformUrl && (
          <a className="url-line" href={o.platformUrl} target="_blank" rel="noreferrer">
            {o.platformUrl}
          </a>
        )}
        <div className="meta">
          {o.context && (
            <button
              className="ctx-toggle"
              onClick={() => setShowContext(v => !v)}
              title={showContext ? 'Hide context' : 'Show context'}
              aria-expanded={showContext}
            >
              {showContext ? '−' : '+'}
            </button>
          )}
          {o.platform} · {o.opportunityType} · {brandLabel(o, brands) || 'no brand'} ·{' '}
          <SourceBadge source={o.source} />
        </div>
        {o.context && showContext && <div className="meta ctx-body">{o.context}</div>}
      </div>
    </header>
  );

  const perfSection = pro && perf && (
    <section>
      <h3>Performance</h3>
      <div className="perf-stats">
        <Metric label="upvotes" first={perf.firstUpvotes} latest={perf.upvotes} />
        <Metric label="replies" first={perf.firstReplies} latest={perf.replies} />
      </div>
      <p className="path">
        {perf.checkedAt
          ? `Checked ${perf.checks}× · last ${new Date(perf.checkedAt).toLocaleString()} · deltas vs first check`
          : 'Not checked yet - the next discovery run checks automatically.'}
      </p>
      {perf.note && <p>{perf.note}</p>}
    </section>
  );

  // Posted rows are history, not work: the reply that went out (read-only) and
  // its stats. No editor, no triage, no post buttons, no notes.
  if (o.status === 'posted') {
    return (
      <aside className="detail">
        {header}
        {perfSection}
        <section>
          <h3>Posted reply</h3>
          <blockquote className="posted-reply">{o.userReply ?? o.suggestedReply}</blockquote>
        </section>
      </aside>
    );
  }

  return (
    <aside className="detail">
      {header}

      {/* Triage: Mark posted (once you've clicked submit) or Ignore. */}
      <StatusButtons current={o.status} onSet={s => onSetStatus(o.id, s)} />

      {perfSection}

      {o.relevanceReason && (
        <section>
          <h3>Why it's relevant</h3>
          <p>{o.relevanceReason}</p>
        </section>
      )}
      {(o.suggestedReply || o.userReply) && (
        <section>
          <h3>
            Draft reply
            {/* The badge IS the revert control: hover flips "edited" → "revert". */}
            {edited && (
              <button
                type="button"
                className="badge badge-edited badge-revert"
                title="Revert to the original draft"
                onClick={revertEdit}
              >
                <span className="badge-idle">edited</span>
                <span className="badge-hover">revert</span>
              </button>
            )}
            {edited && (
              <button
                className="copy"
                disabled={savingExample || !!o.exampleSavedAt}
                title="Add this before→after pair to your voice guidance so future drafts sound like you"
                onClick={promoteExample}
              >
                {o.exampleSavedAt
                  ? `Saved as example ✓ ${new Date(o.exampleSavedAt).toLocaleDateString()}`
                  : savingExample ? 'Saving…' : 'Save as example'}
              </button>
            )}
            <button className="copy" onClick={copyReply}>{copied ? 'Copied ✓' : 'Copy'}</button>
          </h3>
          <div className="draft-editor">
            <textarea
              value={draftText}
              rows={Math.max(3, draftText.split('\n').length + 1)}
              onChange={e => {
                setDraftText(e.target.value);
                pending.current = {
                  id: o.id,
                  text: e.target.value,
                  suggested: o.suggestedReply,
                  user: o.userReply ?? null,
                };
              }}
              onBlur={() => void flushDraft(true)}
            />
          </div>
        </section>
      )}

      {/* Post sits below the editor so the flow reads review → edit → post.
          One button: the bridge pre-fills in the dedicated browser and clicks
          submit — unless Dry Run Posts (Settings) is on, in which case it only
          pre-fills and the user clicks submit themselves. Recommendations open
          a full submission form, so they're always pre-fill only. */}
      <div className="post-row">
        <button
          className="post-btn"
          disabled={!pro || posting}
          onClick={() => void postInBrowser(o.kind !== 'recommendation')}
          title={pro
            ? o.kind === 'recommendation'
              ? 'Open the submission form in the dedicated browser, pre-filled — you click submit'
              : 'Open in the dedicated browser, pre-fill the reply, and submit (pre-fill only if Dry Run Posts is on in Settings)'
            : 'Pro feature'}
        >
          {posting ? 'Opening browser…' : o.kind === 'recommendation' ? 'Open & pre-fill' : 'Post & Submit'}
        </button>
        {!pro && (
          <span className="pro-hint">
            Pro feature — <a href="#" onClick={e => { e.preventDefault(); onOpenLicense(); }}>activate a license</a>
          </span>
        )}
        {o.postedIntentAt && !postMsg && (
          <span className="pro-hint">posting attempted {new Date(o.postedIntentAt).toLocaleString()}</span>
        )}
      </div>
      {postMsg && <p className={postMsg.ok ? 'post-msg ok' : 'post-msg err'}>{postMsg.text}</p>}

      <section>
        <h3>
          Notes
          <button className="copy" disabled={noteText.trim() === (o.replyNote ?? '').trim()} onClick={saveNote}>
            Save note
          </button>
        </h3>
        <textarea
          className="note-input"
          placeholder='Feedback on this draft ("too salesy", "shorter") — swept into your voice guidance'
          value={noteText}
          rows={2}
          onChange={e => setNoteText(e.target.value)}
        />
      </section>
      {reviewMsg && <p className="review-msg">{reviewMsg}</p>}
      {o.suggestedAction && (
        <section>
          <h3>Suggested action</h3>
          <p>{o.suggestedAction}</p>
        </section>
      )}
      {o.screenshotPath && (
        <section>
          <h3>Screenshot</h3>
          {shotUrl ? (
            <a href={shotUrl} target="_blank" rel="noreferrer">
              <img className="screenshot" src={shotUrl} alt="Captured page" />
            </a>
          ) : shotFailed ? (
            <p className="path">Screenshot unavailable — capture didn't complete for this opportunity.</p>
          ) : (
            <p className="path">Loading…</p>
          )}
        </section>
      )}
    </aside>
  );
}
