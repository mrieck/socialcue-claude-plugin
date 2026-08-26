import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  createContent,
  deleteContent,
  getContent,
  getPostizChannels,
  getPostizStatus,
  patchContent,
  removeContentMedia,
  scheduleContent,
  syncContent,
  uploadContentMedia,
} from '../api';
import type { ContentPatch } from '../api';
import type { Brand, ContentItem, ContentStatus, PostizChannel } from '../types';
import { CONTENT_STATUSES } from '../types';

/** Swap for the real affiliate link before launch. */
export const POSTIZ_REFERRAL_URL = 'https://postiz.pro/socialcue';

interface Props {
  /** Bumped by the /api/changes poll so syncs land live. */
  dataTick: number;
  brands: Brand[];
}

const STATUS_LABELS: Record<ContentStatus, string> = {
  idea: 'Idea',
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Published',
  failed: 'Failed',
};

/** Default schedule slot: an hour out, rounded up to the next quarter hour. */
function defaultScheduleAt(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function metricChips(metrics: Record<string, unknown>): [string, string][] {
  return Object.entries(metrics)
    .filter(([, v]) => typeof v === 'number' || typeof v === 'string')
    .slice(0, 4)
    .map(([k, v]) => [k, String(v)]);
}

interface EditorProps {
  item: ContentItem | null; // null = new item
  brands: Brand[];
  channels: PostizChannel[] | null; // null = Postiz not connected
  /** Brand id -> Postiz integration ids (Settings → Accounts → brands). */
  channelMap: Record<string, string[]>;
  onSaved: () => void;
  onClose: () => void;
}

function ContentEditor({ item, brands, channels, channelMap, onSaved, onClose }: EditorProps) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [brandId, setBrandId] = useState(item?.brandId ?? '');
  const [selected, setSelected] = useState<string[]>(item?.channels ?? []);
  const [subreddits, setSubreddits] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [id, s] of Object.entries(item?.settings ?? {})) {
      const sub = (s as { subreddit?: { value?: string }[] })?.subreddit?.[0]?.value;
      if (sub) out[id] = sub;
    }
    return out;
  });
  const [date, setDate] = useState(item?.scheduledFor?.slice(0, 16) ?? defaultScheduleAt());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [showOtherBrands, setShowOtherBrands] = useState(false);
  // Attachments already in the managed store + files picked but not yet saved.
  const [mediaEntries, setMediaEntries] = useState<string[]>(item?.media ?? []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);

  // Already handed to Postiz: content is a mirror, only viewing makes sense.
  const sent = !!item?.postizPostId;

  const toggleChannel = (id: string) =>
    setSelected(cur => (cur.includes(id) ? cur.filter(c => c !== id) : [...cur, id]));

  // Brand ↔ account association: this brand's accounts + unassigned ones are
  // offered; accounts assigned ONLY to other brands hide behind a toggle so a
  // meme for brand A doesn't land on brand B's X account by accident. The map
  // is many-to-many — a shared (founder) account assigned to this brand stays
  // offered no matter how many other brands it also backs.
  const assignedAnywhere = (id: string) =>
    Object.values(channelMap).some(ids => ids.includes(id));
  const offeredHere = (id: string) =>
    (brandId && (channelMap[brandId] ?? []).includes(id)) || !assignedAnywhere(id);
  const anyAssignments = Object.keys(channelMap).length > 0;
  const grouping = anyAssignments && brandId
    ? {
        offered: (channels ?? []).filter(ch => offeredHere(ch.id)),
        other: (channels ?? []).filter(ch => !offeredHere(ch.id)),
      }
    : { offered: channels ?? [], other: [] };

  const pickBrand = (id: string) => {
    setBrandId(id);
    // New/unsent post: switch the selection to the brand's own accounts.
    if (!sent) {
      const mapped = channelMap[id] ?? [];
      if (mapped.length) setSelected(mapped.filter(m => (channels ?? []).some(ch => ch.id === m)));
    }
  };

  const buildPatch = (): ContentPatch => {
    // Postiz per-channel settings. Seed from what the item already carries so
    // agent-authored settings (YouTube title, TikTok flags, …) survive a save;
    // this editor only manages the Reddit subreddit field on top.
    const settings: Record<string, unknown> = {};
    for (const id of selected) {
      const existing = (item?.settings ?? {})[id];
      if (existing !== undefined) settings[id] = existing;
    }
    for (const id of selected) {
      const ch = channels?.find(c => c.id === id);
      if (ch?.identifier?.includes('reddit')) {
        if (subreddits[id]) {
          settings[id] = {
            __type: 'reddit',
            subreddit: [{ value: subreddits[id], title, type: 'text' }],
          };
        } else {
          delete settings[id];
        }
      }
    }
    return {
      title,
      body,
      brandId: brandId || null,
      channels: selected,
      settings,
      scheduledFor: date ? new Date(date).toISOString() : null,
    };
  };

  const save = async (): Promise<ContentItem | null> => {
    const patch = buildPatch();
    try {
      let saved = item ? await patchContent(item.id, patch) : await createContent(patch);
      // Attachments picked in the editor upload once the item exists; they hit
      // Postiz later, at schedule time.
      for (const f of pendingFiles) saved = await uploadContentMedia(saved.id, f);
      setPendingFiles([]);
      setMediaEntries(saved.media);
      return saved;
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : 'Bridge unreachable', ok: false });
      return null;
    }
  };

  const removeAttachment = async (entry: string) => {
    if (!item) return;
    try {
      const updated = await removeContentMedia(item.id, entry);
      setMediaEntries(updated.media);
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? err.message : 'Bridge unreachable', ok: false });
    }
  };

  const send = async (type: 'schedule' | 'now') => {
    setBusy(true);
    setMsg(null);
    const saved = sent ? item : await save();
    if (!saved) { setBusy(false); return; }
    try {
      await scheduleContent(saved.id, {
        type,
        date: date ? new Date(date).toISOString() : undefined,
      });
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setMsg({ text: err.message === 'postiz_not_connected' ? 'Connect Postiz in Settings first.' : err.message, ok: false });
      } else {
        setMsg({ text: err instanceof ApiError ? err.message : 'Bridge unreachable', ok: false });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail content-editor">
      <header>
        <h2>Social Channel Post</h2>
        {item && <button className="copy" onClick={onClose}>Close</button>}
      </header>

      <section>
        <h3>Brand</h3>
        <select value={brandId} onChange={e => pickBrand(e.target.value)} disabled={sent}>
          <option value="">no brand</option>
          {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </section>

      <section>
        <h3>Title</h3>
        <input
          type="text"
          value={title}
          disabled={sent}
          placeholder="Working title (used as the Reddit post title)"
          onChange={e => setTitle(e.target.value)}
        />
      </section>

      <section>
        <h3>Post{item?.format === 'markdown' && <span className="badge badge-source">markdown</span>}</h3>
        {item?.notes && (
          <p className="muted" title="Left by the agent that wrote this item — preserved on save">
            {item.source !== 'user' ? `${item.source}: ` : ''}{item.notes}
          </p>
        )}
        <textarea
          value={body}
          disabled={sent}
          rows={Math.max(6, body.split('\n').length + 1)}
          placeholder="The post itself — one body for all selected channels"
          onChange={e => setBody(e.target.value)}
        />
      </section>

      <section>
        <h3>Channels</h3>
        {channels === null ? (
          <p className="muted">Connect Postiz in Settings to pick channels.</p>
        ) : channels.length === 0 ? (
          <p className="muted">No channels connected in Postiz yet — add some there first.</p>
        ) : (
          <div className="channel-list">
            {grouping.offered.map(ch => (
              <label key={ch.id} className="channel-option">
                <input
                  type="checkbox"
                  checked={selected.includes(ch.id)}
                  disabled={sent}
                  onChange={() => toggleChannel(ch.id)}
                />
                {ch.name} <span className="muted">({ch.identifier})</span>
                {(channelMap[brandId] ?? []).includes(ch.id) && (
                  <span className="badge badge-source">brand account</span>
                )}
                {ch.identifier?.includes('reddit') && selected.includes(ch.id) && (
                  <input
                    type="text"
                    className="subreddit-input"
                    placeholder="subreddit (e.g. SaaS)"
                    value={subreddits[ch.id] ?? ''}
                    disabled={sent}
                    onChange={e => setSubreddits(s => ({ ...s, [ch.id]: e.target.value }))}
                  />
                )}
              </label>
            ))}
            {grouping.other.length > 0 && !sent && (
              <button className="ctx-toggle detail-toggle" onClick={() => setShowOtherBrands(v => !v)}>
                {showOtherBrands ? '−' : '+'} other brands' accounts ({grouping.other.length})
              </button>
            )}
            {showOtherBrands && grouping.other.map(ch => (
              <label key={ch.id} className="channel-option other-brand">
                <input
                  type="checkbox"
                  checked={selected.includes(ch.id)}
                  disabled={sent}
                  onChange={() => toggleChannel(ch.id)}
                />
                {ch.name} <span className="muted">({ch.identifier} — assigned to another brand)</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {item && Object.keys(item.variants ?? {}).length > 0 && (
        <section>
          <h3>Per-platform variants</h3>
          <p className="muted">Agent-authored per-channel packaging — preserved on save, edited via Claude.</p>
          <ul className="media-list">
            {Object.entries(item.variants).map(([id, v]) => (
              <li key={id} title={v.content ?? ''}>
                {channels?.find(c => c.id === id)?.name ?? id}
                {v.content && <span className="muted"> — {v.content.length > 80 ? `${v.content.slice(0, 80)}…` : v.content}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>Media</h3>
        {(mediaEntries.length > 0 || pendingFiles.length > 0) && (
          <ul className="media-list">
            {mediaEntries.map(m => (
              <li key={m} title={m}>
                {m.split('/').pop()}
                {!sent && (
                  <button className="copy media-remove" onClick={() => void removeAttachment(m)}>Remove</button>
                )}
              </li>
            ))}
            {pendingFiles.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                {f.name} <span className="muted">(added on save)</span>
                <button
                  className="copy media-remove"
                  onClick={() => setPendingFiles(cur => cur.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {!sent && (
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            onChange={e => {
              const files = Array.from(e.target.files ?? []);
              if (files.length) setPendingFiles(cur => [...cur, ...files]);
              e.target.value = '';
            }}
          />
        )}
        <p className="muted">Attachments upload to Postiz when this post is scheduled.</p>
      </section>

      <section>
        <h3>
          Schedule for
          {date && !sent && (
            <button
              className="copy schedule-clear"
              title="Clear the schedule and post immediately instead"
              onClick={() => setDate('')}
            >
              ×
            </button>
          )}
        </h3>
        <input
          type="datetime-local"
          value={date}
          disabled={sent}
          onChange={e => setDate(e.target.value)}
        />
      </section>

      {sent ? (
        <p className="muted">
          Already in Postiz ({STATUS_LABELS[item!.status]}) — edit or reschedule it there.
        </p>
      ) : (
        <div className="post-row">
          <button
            className="post-btn"
            disabled={busy || !selected.length || !body.trim()}
            title={date ? 'Schedule via your Postiz account' : 'Publish immediately via Postiz'}
            onClick={() => send(date ? 'schedule' : 'now')}
          >
            {busy ? 'Working…' : date ? 'Schedule for Postiz' : 'Post via Postiz'}
          </button>
        </div>
      )}
      {msg && <p className={msg.ok ? 'post-msg ok' : 'post-msg err'}>{msg.text}</p>}

      {channels === null ? (
        <p className="muted postiz-note">
          For social feeds we recommend{' '}
          <a href={POSTIZ_REFERRAL_URL} target="_blank" rel="noreferrer">Postiz</a>
          {' '}- connect your own account in Settings and this composer schedules
          across all your channels.
        </p>
      ) : (
        <p className="muted postiz-note">
          <a href={POSTIZ_REFERRAL_URL} target="_blank" rel="noreferrer">Postiz</a>
          {' '}is connected - posts go out through your own account.
        </p>
      )}
    </div>
  );
}

/**
 * Content Strategy: original posts per brand, drafted here and (Pro) scheduled
 * through the user's own Postiz account, with status/analytics synced back.
 * Composing is free; schedule/sync mirror the acting/tracking Pro line.
 */
export function ContentPanel({ dataTick, brands }: Props) {
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [channels, setChannels] = useState<PostizChannel[] | null>(null);
  const [channelMap, setChannelMap] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<ContentItem | null | 'new'>(null);
  // The composer is always visible; bumping the nonce remounts it blank
  // (after a save, or when the user backs out of editing an item).
  const [editorNonce, setEditorNonce] = useState(0);
  const closeEditor = () => { setEditing(null); setEditorNonce(n => n + 1); };
  const [brandFilter, setBrandFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refetch = useCallback(() => {
    getContent({ brand: brandFilter || undefined, status: statusFilter || undefined })
      .then(r => { setItems(r); setError(null); })
      .catch(e => setError(String(e.message ?? e)));
  }, [brandFilter, statusFilter]);

  useEffect(refetch, [refetch, dataTick]);

  useEffect(() => {
    getPostizStatus().then(s => {
      setConnected(s.connected);
      setChannelMap(s.channelMap ?? {});
      if (s.connected) getPostizChannels().then(setChannels).catch(() => setChannels([]));
    }).catch(() => setConnected(false));
  }, []);

  // Opportunistic status refresh on open (throttled server-side).
  useEffect(() => {
    if (connected) syncContent().catch(() => {});
  }, [connected]);

  const doSync = async () => {
    setSyncMsg('Syncing…');
    try {
      const r = await syncContent(true);
      setSyncMsg(r.synced ? `Synced ${r.synced} post${r.synced === 1 ? '' : 's'}` : 'Nothing to sync');
      refetch();
    } catch (err) {
      setSyncMsg(err instanceof ApiError && err.status === 403
        ? 'Pro required for sync'
        : `Sync failed: ${err instanceof ApiError ? err.message : 'bridge unreachable'}`);
    }
  };

  const remove = async (item: ContentItem) => {
    if (!window.confirm(`Delete "${item.title || '(untitled)'}"${item.postizPostId ? ' (also removed from Postiz)' : ''}?`)) return;
    try {
      await deleteContent(item.id);
      refetch();
    } catch (err) {
      setSyncMsg(`Delete failed: ${err instanceof ApiError ? err.message : 'bridge unreachable'}`);
    }
  };

  if (error) return <div className="empty">Couldn't load content: {error}</div>;
  if (items === null) return <div className="empty">Loading…</div>;

  return (
    <div className="main">
      <div className="queue-wrap">
        <div className="content-head">
          <h2>Your content</h2>
          {items.length > 0 && <span className="nav-count">{items.length}</span>}
          <span className="muted">posts composed here or dropped in by your agents</span>
        </div>
        <div className="content-toolbar">
          <button className="copy" onClick={closeEditor}>New post</button>
          <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
            <option value="">all brands</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">all statuses</option>
            {CONTENT_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          {connected ? (
            <button className="copy" onClick={doSync} title="Pull status + performance from Postiz">
              Sync from Postiz
            </button>
          ) : connected === false ? (
            <span className="pro-hint">
              Not connected — add your Postiz API key in Settings
              {' '}(<a href={POSTIZ_REFERRAL_URL} target="_blank" rel="noreferrer">get one</a>)
            </span>
          ) : null}
          {syncMsg && <span className="pro-hint">{syncMsg}</span>}
        </div>

        {items.length === 0 ? (
          <div className="empty">
            Nothing here yet. Compose a post on the right, or let your agents fill
            this queue: anything dropped in with <code>content add</code> (demo
            videos, memes, blog posts) lands here as a draft with its media
            attached, ready to review and schedule.
          </div>
        ) : (
          <div className="opp-list">
            {items.map(item => (
              <div key={item.id} className="opp-row content-row">
                <span className="row-main">
                  <span className="row-title">
                    {item.releaseUrl
                      ? <a href={item.releaseUrl} target="_blank" rel="noreferrer">{item.title || '(untitled)'}</a>
                      : <a href="#" onClick={e => { e.preventDefault(); setEditing(item); }}>{item.title || '(untitled)'}</a>}
                  </span>
                  <span className="row-meta">
                    <span className={`badge badge-content-${item.status}`}>{STATUS_LABELS[item.status]}</span>
                    {item.source !== 'user' && <span className="badge badge-source">{item.source}</span>}
                    {item.format === 'markdown' && <span className="badge badge-source">markdown</span>}
                    {item.brandName ? ` · ${item.brandName}` : ''}
                    {item.media.length ? ` · 📎${item.media.length}` : ''}
                    {item.channels.length ? ` · ${item.channels.length} channel${item.channels.length === 1 ? '' : 's'}` : ''}
                    {item.scheduledFor ? ` · ${new Date(item.scheduledFor).toLocaleString()}` : ''}
                    {metricChips(item.metrics).map(([k, v]) => ` · ${v} ${k}`).join('')}
                  </span>
                </span>
                <button className="copy" onClick={() => setEditing(item)}>
                  {item.postizPostId ? 'View' : 'Edit'}
                </button>
                <button className="copy" onClick={() => remove(item)}>Delete</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <ContentEditor
        key={editing && editing !== 'new' ? editing.id : `new-${editorNonce}`}
        item={editing && editing !== 'new' ? editing : null}
        brands={brands}
        channels={connected ? channels ?? [] : null}
        channelMap={channelMap}
        onSaved={refetch}
        onClose={closeEditor}
      />
    </div>
  );
}
