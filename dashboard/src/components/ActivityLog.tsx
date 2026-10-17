import { useEffect, useState } from 'react';
import { ApiError, getActivity, patchActivity, promoteActivity } from '../api';
import type { Activity } from '../types';

interface Props {
  dataTick: number;
  pro: boolean;
}

const KIND_LABEL: Record<Activity['kind'], string> = { post: 'post', comment: 'comment', reply: 'reply', repost: 'repost' };

function fmt(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Everything the user posted anywhere, collected by /log-activity. Posts can
 * be filed in the Content Library; any row can be flagged for Pro check-ins.
 */
export function ActivityLog({ dataTick, pro }: Props) {
  const [items, setItems] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getActivity({ kind: kind || undefined })
      .then(rows => { if (alive) { setItems(rows); setErr(null); } })
      .catch(e => { if (alive) setErr(e instanceof ApiError ? e.message : 'bridge unreachable'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dataTick, kind]);

  const update = (id: string, next: Activity) => setItems(list => list.map(a => (a.id === id ? next : a)));

  const toggleTracked = async (a: Activity) => {
    setBusy(a.id);
    try { update(a.id, await patchActivity(a.id, { tracked: !a.tracked })); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  const promote = async (a: Activity) => {
    setBusy(a.id);
    try { update(a.id, await promoteActivity(a.id)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
    finally { setBusy(''); }
  };

  return (
    <section className="activity-log">
      <div className="content-head">
        <h2>Activity log</h2>
        {items.length > 0 && <span className="nav-count">{items.length}</span>}
        <span className="muted">what you posted anywhere in the last 30 days — logged by <code>/log-activity</code></span>
        <select value={kind} onChange={e => setKind(e.target.value)} aria-label="Kind">
          <option value="">all kinds</option>
          <option value="post">posts</option>
          <option value="comment">comments</option>
          <option value="reply">replies</option>
          <option value="repost">reposts</option>
        </select>
      </div>
      {err && <p className="error">{err}</p>}
      {loading ? (
        <div className="empty">Loading…</div>
      ) : !items.length ? (
        <div className="empty">Nothing logged yet. Run <code>/log-activity</code> in Claude Code to pull in posts and comments you made from your phone.</div>
      ) : (
        <div className="opp-list">
          {items.map(a => (
            <div key={a.id} className="content-row activity-row">
              <span className="row-main">
                <span className="row-title">
                  {a.title || a.body.slice(0, 120) || a.url}
                </span>
                <span className="row-meta">
                  <span className="badge">{a.platform}</span>
                  <span className={`badge badge-kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
                  {a.community ? ` · ${a.community}` : ''}
                  {a.parentTitle ? ` · on: ${a.parentTitle.slice(0, 60)}` : ''}
                  {a.brandName ? ` · ${a.brandName}` : ''}
                  {a.postedAt ? ` · ${fmt(a.postedAt)}` : ''}
                  {a.score != null ? ` · ${a.score} pts` : ''}
                  {a.replyCount != null ? ` · ${a.replyCount} replies` : ''}
                  {' · '}
                  <a href={a.url} target="_blank" rel="noreferrer">open ↗</a>
                  {a.contentItemId && <> · <span className="badge badge-source">in Library</span></>}
                </span>
              </span>
              <span className="activity-actions">
                {a.kind === 'post' && !a.contentItemId && (
                  <button type="button" className="copy" disabled={busy === a.id} onClick={() => void promote(a)}>File in Library</button>
                )}
                <button
                  type="button"
                  className={`copy${a.tracked ? ' on' : ''}`}
                  disabled={busy === a.id}
                  title={pro ? 'Include this in performance check-ins' : 'Performance tracking is Pro'}
                  onClick={() => void toggleTracked(a)}
                >
                  {a.tracked ? 'Tracking' : 'Track'}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
