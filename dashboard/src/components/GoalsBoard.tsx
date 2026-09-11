import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiError, createGoal, deleteGoal, deleteGoalEntry, getGoals, logGoalEntry, patchGoal, seedGoals } from '../api';
import type { Brand, Goal, GoalPatch, GoalRule, GoalsBoard as Board } from '../types';

interface Props {
  dataTick: number;
  brands: Brand[];
}

const CONTENT_PLATFORMS = ['threads', 'tiktok', 'youtube', 'instagram', 'x', 'bluesky', 'linkedin', 'reddit', 'facebook'];
const REPLY_PLATFORMS = ['reddit', 'x', 'hackernews', 'indiehackers', 'producthunt', 'threads', 'linkedin', 'devto'];
const POST_TYPES = ['listing', 'article', 'thread', 'link'];

/** Shift a local YYYY-MM-DD by n days (kept in local time so the Sunday boundary never drifts). */
function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function fmtEntryTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * The weekly goals board at the top of the Analytics view. Each goal is a
 * weekly target with an optional auto-rule (counts rows already in the store)
 * plus "Log one" manual entries; the two are shown separately so the user can
 * see what Social Cue knows vs what they told it. Weeks run Sunday → Saturday
 * in the bridge's local time.
 */
export function GoalsBoard({ dataTick, brands }: Props) {
  const [weekDate, setWeekDate] = useState<string | null>(null); // null = this week
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Goal | 'new' | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      setBoard(await getGoals(weekDate));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load goals');
    }
  }, [weekDate]);

  useEffect(() => { void refetch(); }, [refetch, dataTick]);

  const replaceGoal = (g: Goal) =>
    setBoard(b => (b ? { ...b, goals: b.goals.map(x => (x.id === g.id ? g : x)) } : b));

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(null); void refetch(); }
  };

  const logOne = (g: Goal, note = '') =>
    run(`log:${g.id}`, async () => { const r = await logGoalEntry(g.id, { note }, weekDate); replaceGoal(r.goal); });
  const removeEntry = (g: Goal, entryId: string) =>
    run(`entry:${entryId}`, async () => { replaceGoal(await deleteGoalEntry(g.id, entryId, weekDate)); });
  const archive = async (g: Goal) => {
    await patchGoal(g.id, { archived: true }, weekDate);
    setEditing(null);
    void refetch();
  };
  const remove = async (g: Goal) => {
    await deleteGoal(g.id);
    setEditing(null);
    void refetch();
  };
  /** Drop `dragId` onto `targetId`: reassign sort_order across the whole list
   *  so the order is stable (no gaps, no ties) rather than swapping two rows. */
  const dropOn = (targetId: string) => {
    if (!board || !dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = board.goals.map(x => x.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...board.goals];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setBoard({ ...board, goals: next.map((g, i) => ({ ...g, sortOrder: i })) }); // optimistic
    setDragId(null);
    setOverId(null);
    void run('reorder', async () => {
      await Promise.all(next.map((g, i) => (g.sortOrder === i ? Promise.resolve() : patchGoal(g.id, { sortOrder: i }, weekDate).then(() => undefined))));
    });
  };
  const seed = () => run('seed', async () => { await seedGoals(); });

  const toggleOpen = (id: string) =>
    setOpen(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const saveForm = async (patch: GoalPatch & { title: string; target: number }) => {
    if (editing === 'new') await createGoal(patch, weekDate);
    else if (editing) replaceGoal(await patchGoal(editing.id, patch, weekDate));
    setEditing(null);
    void refetch();
  };

  const week = board?.week;
  const goals = board?.goals ?? [];

  return (
    <section className="goals">
      <div className="goals-head">
        <h2>Goals</h2>
        {week && (
          <div className="week-nav">
            <button type="button" className="copy" title="Previous week" onClick={() => setWeekDate(shiftDate(week.startDate, -7))}>‹</button>
            <span className="week-label">{week.label}{week.isCurrent ? ' · this week' : ''}</span>
            <button type="button" className="copy" title="Next week" onClick={() => setWeekDate(shiftDate(week.startDate, 7))}>›</button>
            {!week.isCurrent && (
              <button type="button" className="copy" onClick={() => setWeekDate(null)}>This week</button>
            )}
          </div>
        )}
        {board && goals.length > 0 && (
          <span className="goal-totals">
            {board.totals.met}/{board.totals.goals} goals met · {board.totals.count}/{board.totals.target} items
          </span>
        )}
        <div className="goals-actions">
          <button type="button" className="copy" onClick={() => setEditing('new')}>Add goal</button>
        </div>
      </div>
      {error && <p className="post-msg err">{error}</p>}

      {editing && (
        <GoalModal
          goal={editing === 'new' ? null : editing}
          brands={brands}
          onCancel={() => setEditing(null)}
          onSave={saveForm}
          onArchive={archive}
          onDelete={remove}
        />
      )}

      {board && !goals.length && (
        <div className="goal-empty">
          <p className="muted">No weekly goals yet. Set targets for the routine you want to keep (memes, videos, articles) and this board counts what you shipped each week.</p>
          <div className="goals-actions">
            <button type="button" className="copy" disabled={busy === 'seed'} onClick={seed}>Add my starter goals</button>
            <button type="button" className="copy" onClick={() => setEditing('new')}>Add goal</button>
          </div>
        </div>
      )}

      {goals.length > 0 && (
        <div className="goal-grid">
          {goals.map(g => {
            const met = g.count >= g.target;
            const pct = Math.min(100, Math.round((g.count / Math.max(1, g.target)) * 100));
            const isOpen = open.has(g.id);
            return (
              <div
                key={g.id}
                className={`goal-card${met ? ' met' : ''}${dragId === g.id ? ' dragging' : ''}${overId === g.id && dragId !== g.id ? ' drop-target' : ''}`}
                draggable={!isOpen}
                onDragStart={e => { setDragId(g.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.id); }}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                onDragOver={e => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overId !== g.id) setOverId(g.id); } }}
                onDragLeave={() => { if (overId === g.id) setOverId(null); }}
                onDrop={e => { e.preventDefault(); dropOn(g.id); }}
                title={g.rule ? `Counted automatically: ${g.ruleLabel}` : 'Counted from what you log'}
              >
                <div className="goal-title-row">
                  <span className="goal-title">{g.title}</span>
                  {g.brandName && <span className="pill">{g.brandName}</span>}
                  <button type="button" className="copy icon goal-edit" title="Edit goal" onClick={() => setEditing(g)}>✎</button>
                </div>
                <div className="goal-count-row">
                  <span className="goal-count">{g.count}<span className="goal-target"> / {g.target}</span></span>
                  <span className="goal-sub">{g.autoCount} auto · {g.manualCount} logged</span>
                </div>
                <div className="goal-progress" title={`${pct}%`}>
                  <div className="goal-progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <div className="goal-actions">
                  <button type="button" className="copy log-one" disabled={busy === `log:${g.id}`} onClick={() => logOne(g)}>Log one</button>
                  <button type="button" className="copy" onClick={() => toggleOpen(g.id)}>
                    {isOpen ? 'Hide' : 'Entries'}{g.manualCount ? ` (${g.manualCount})` : ''}
                  </button>
                </div>
                {isOpen && <EntryList goal={g} busy={busy} onLog={note => logOne(g, note)} onRemove={id => removeEntry(g, id)} />}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function EntryList({ goal, busy, onLog, onRemove }: {
  goal: Goal; busy: string | null; onLog: (note: string) => void; onRemove: (entryId: string) => void;
}) {
  const [note, setNote] = useState('');
  return (
    <div className="goal-entries">
      <form
        className="goal-entry-form"
        onSubmit={e => { e.preventDefault(); onLog(note.trim()); setNote(''); }}
      >
        <input type="text" placeholder="note (optional): what did you publish?" value={note} onChange={e => setNote(e.target.value)} />
        <button type="submit" className="copy" disabled={busy === `log:${goal.id}`}>Log</button>
      </form>
      {!goal.entries.length && <p className="muted small">Nothing logged this week.</p>}
      {goal.entries.map(e => (
        <div key={e.id} className="goal-entry">
          <span className="goal-entry-at">{fmtEntryTime(e.at)}</span>
          <span className="goal-entry-note">{e.note || <span className="muted">—</span>}</span>
          {e.source !== 'manual' && <span className="badge">{e.source}</span>}
          <button type="button" className="copy icon" title="Remove entry" disabled={busy === `entry:${e.id}`} onClick={() => onRemove(e.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

type RuleType = GoalRule['type'] | '';

function GoalModal({ goal, brands, onCancel, onSave, onArchive, onDelete }: {
  goal: Goal | null;
  brands: Brand[];
  onCancel: () => void;
  onSave: (patch: GoalPatch & { title: string; target: number }) => Promise<void>;
  onArchive: (g: Goal) => Promise<void>;
  onDelete: (g: Goal) => Promise<void>;
}) {
  const r = goal?.rule ?? null;
  const [title, setTitle] = useState(goal?.title ?? '');
  const [target, setTarget] = useState(String(goal?.target ?? 1));
  const [brandId, setBrandId] = useState(goal?.brandId ?? '');
  const [ruleType, setRuleType] = useState<RuleType>(r?.type ?? '');
  const [platform, setPlatform] = useState(r && r.type !== 'post' ? r.platform ?? '' : '');
  const [source, setSource] = useState(r?.type === 'content' ? r.source ?? '' : '');
  const [titlePrefix, setTitlePrefix] = useState(r?.type === 'content' ? r.titlePrefix ?? '' : '');
  const [excludeTitlePrefix, setExcludeTitlePrefix] = useState(r?.type === 'content' ? r.excludeTitlePrefix ?? '' : '');
  const [postType, setPostType] = useState(r?.type === 'post' ? r.postType ?? '' : '');
  const [destinationHost, setDestinationHost] = useState(r?.type === 'post' ? r.destinationHost ?? '' : '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const guarded = async (fn: () => Promise<void>) => {
    setSaving(true);
    setErr(null);
    try { await fn(); }
    catch (ex) { setErr(ex instanceof ApiError ? ex.message : String(ex)); }
    finally { setSaving(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(target);
    if (!title.trim()) { setErr('Give the goal a title'); return; }
    if (!Number.isInteger(n) || n < 1) { setErr('Target must be a whole number of at least 1'); return; }
    let rule: GoalPatch['rule'] = null;
    if (ruleType === 'content') rule = { type: 'content', platform: platform || null, source: source || null, titlePrefix: titlePrefix || null, excludeTitlePrefix: excludeTitlePrefix || null };
    else if (ruleType === 'post') rule = { type: 'post', postType: postType || null, destinationHost: destinationHost || null };
    else if (ruleType === 'reply') rule = { type: 'reply', platform: platform || null };
    await guarded(() => onSave({ title: title.trim(), target: n, brandId: brandId || null, rule }));
  };

  const platformOptions = ruleType === 'reply' ? REPLY_PLATFORMS : CONTENT_PLATFORMS;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal-card goal-modal post-form"
        role="dialog"
        aria-modal="true"
        aria-label={goal ? 'Edit goal' : 'Add goal'}
        onClick={e => e.stopPropagation()}
        onSubmit={submit}
      >
      <header className="modal-header">
        <h2>{goal ? 'Edit goal' : 'Add goal'}</h2>
        <button type="button" className="copy" onClick={onCancel}>✕</button>
      </header>
      <div className="goal-form-row">
        <label className="grow">
          Goal
          <input type="text" value={title} placeholder="e.g. 3 TikTok videos" onChange={e => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="narrow">
          Per week
          <input type="text" inputMode="numeric" value={target} onChange={e => setTarget(e.target.value)} />
        </label>
        <label>
          Brand
          <select value={brandId} onChange={e => setBrandId(e.target.value)}>
            <option value="">any</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>
      <div className="goal-form-row">
        <label>
          Count automatically from
          <select value={ruleType} onChange={e => { setRuleType(e.target.value as RuleType); setPlatform(''); }}>
            <option value="">nothing — I'll log it</option>
            <option value="content">Content Library (scheduled / published)</option>
            <option value="post">Product Posts (submitted / live)</option>
            <option value="reply">Replies marked posted</option>
          </select>
        </label>
        {(ruleType === 'content' || ruleType === 'reply') && (
          <label>
            Platform
            <select value={platform} onChange={e => setPlatform(e.target.value)}>
              <option value="">any</option>
              {platformOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        )}
        {ruleType === 'content' && (
          <>
            <label>
              Source
              <input type="text" value={source} placeholder="any (e.g. crosspost, memelab)" onChange={e => setSource(e.target.value)} />
            </label>
            <label>
              Title starts with
              <input type="text" value={titlePrefix} placeholder="e.g. meme-" onChange={e => setTitlePrefix(e.target.value)} />
            </label>
            <label>
              Title does not start with
              <input type="text" value={excludeTitlePrefix} placeholder="e.g. meme-" onChange={e => setExcludeTitlePrefix(e.target.value)} />
            </label>
          </>
        )}
        {ruleType === 'post' && (
          <>
            <label>
              Destination host
              <input type="text" value={destinationHost} placeholder="e.g. indiehackers.com" onChange={e => setDestinationHost(e.target.value)} />
            </label>
            <label>
              Post type
              <select value={postType} onChange={e => setPostType(e.target.value)}>
                <option value="">any</option>
                {POST_TYPES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </>
        )}
      </div>
      {err && <p className="post-msg err">{err}</p>}
      <div className="goal-modal-actions">
        {goal && (
          <>
            <button type="button" className="copy" disabled={saving} title="Hide from the board, keep its history" onClick={() => guarded(() => onArchive(goal))}>Archive</button>
            <button
              type="button"
              className="copy danger"
              disabled={saving}
              onClick={() => { if (window.confirm(`Delete "${goal.title}" and its logged entries?`)) void guarded(() => onDelete(goal)); }}
            >
              Delete
            </button>
          </>
        )}
        <span className="goal-spacer" />
        <button type="button" className="copy" onClick={onCancel}>Cancel</button>
        <button type="submit" className="copy primary" disabled={saving}>{goal ? 'Save' : 'Add goal'}</button>
      </div>
      </form>
    </div>
  );
}
