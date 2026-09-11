import { useEffect, useMemo, useState } from 'react';
import { ApiError, getContent, getDestinations, getPosts, patchPost } from '../api';
import type { Brand, ContentItem, Destination, DestinationKind, PostStatus, ProductPost } from '../types';
import { DestinationsPane, type SubjectChoice } from './DestinationsPane';

/**
 * Product Posts — the Pro "post anywhere" pillar's state surface. Left: every
 * attempt to get a subject (a brand, a Content Library item, an ad-hoc
 * project) listed, launched, or posted somewhere. Right: all the places to
 * post plus a command builder. The panel deliberately does NOT trigger posts —
 * agentic form-filling needs the Claude Code loop, so the affordances copy a
 * `/socialcue-post` command for the user to run there (same reason the bridge
 * has no start endpoint).
 */
interface Props {
  /** Bumped by the /api/changes poll so CLI-side progress lands live. */
  dataTick: number;
  brands: Brand[];
  pro: boolean;
  onOpenLicense: () => void;
}

const STATUS_LABELS: Record<PostStatus, string> = {
  pending: 'Pending',
  account_created: 'Account created',
  awaiting_verification: 'Awaiting email',
  submitted: 'Submitted',
  live: 'Live',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Reuse the queue's pill palette: map post states onto its classes. */
const STATUS_PILL: Record<PostStatus, string> = {
  pending: 'pill-new',
  account_created: 'pill-reviewed',
  awaiting_verification: 'pill-reviewed',
  submitted: 'pill-approved',
  live: 'pill-posted',
  failed: 'pill-failed',
  skipped: 'pill-skipped',
};

const KIND_SHORT: Record<DestinationKind, string> = {
  directory: 'directory', launch: 'launch', community: 'community', forum: 'forum',
};

function PostRow({ post, destName }: { post: ProductPost; destName: string }) {
  const [showLog, setShowLog] = useState(false);
  const [listingDraft, setListingDraft] = useState('');
  const [row, setRow] = useState(post);
  useEffect(() => setRow(post), [post]);

  const markLive = async () => {
    const listingUrl = listingDraft.trim();
    try {
      setRow(await patchPost(row.id, listingUrl ? { status: 'live', listingUrl } : { status: 'live' }));
    } catch { /* poll error banner covers it */ }
  };

  return (
    <div className="opp-row" style={{ cursor: 'default' }}>
      <div className="row-main">
        <div className="row-title">
          <span>{row.subjectName}</span>
          <span className="muted">→</span>
          <span>{destName}</span>
          {row.destinationKind && <span className={`badge badge-kind-${row.destinationKind}`}>{KIND_SHORT[row.destinationKind]}</span>}
          <span className="badge">{row.postType}</span>
          <span className={`pill ${STATUS_PILL[row.status]}`}>{STATUS_LABELS[row.status]}</span>
        </div>
        <div className="row-meta">
          <span>{row.subjectKind}</span>
          {row.emailUsed && <span>email: {row.emailUsed}</span>}
          {row.listingUrl
            ? <a href={row.listingUrl} target="_blank" rel="noreferrer">live ↗</a>
            : <a href={row.destinationUrl} target="_blank" rel="noreferrer">site ↗</a>}
          <span>{new Date(row.updatedAt).toLocaleDateString()}</span>
          {row.log.length > 0 && (
            <button className="copy" type="button" onClick={() => setShowLog(s => !s)}>
              {showLog ? 'hide log' : `log (${row.log.length})`}
            </button>
          )}
          {row.status === 'submitted' && (
            <>
              <input
                type="text"
                placeholder="live URL (optional)"
                value={listingDraft}
                onChange={e => setListingDraft(e.target.value)}
                style={{ maxWidth: 220 }}
              />
              <button className="copy" type="button" onClick={markLive}>Mark live</button>
            </>
          )}
        </div>
        {showLog && (
          <div className="row-meta" style={{ display: 'block', whiteSpace: 'pre-wrap' }}>
            {row.log.map((l, i) => (
              <div key={i}>{new Date(l.at).toLocaleString()} — {l.msg}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProductPostsPanel({ dataTick, brands, pro, onOpenLicense }: Props) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [posts, setPosts] = useState<ProductPost[] | null>(null);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState<SubjectChoice | null>(null);
  const [filterSubject, setFilterSubject] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterKind, setFilterKind] = useState('');

  useEffect(() => {
    getDestinations().then(r => setDestinations(r.destinations)).catch(() => {});
    getContent().then(setContentItems).catch(() => {});
    if (!pro) { setGated(true); return; } // free tier never requests (same as perf)
    getPosts()
      .then(p => { setPosts(p); setGated(false); })
      .catch(err => {
        if (err instanceof ApiError && err.status === 403) setGated(true);
        else setError(String(err?.message ?? err));
      });
  }, [dataTick, pro]);

  const destName = useMemo(() => {
    const m = new Map(destinations.map(d => [d.id, d.name]));
    return (p: ProductPost) => p.destinationName || (p.destinationId && m.get(p.destinationId)) || p.destinationUrl;
  }, [destinations]);

  /** Subjects that appear in posts (for the filter), plus configured brands. */
  const subjectOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const b of brands.filter(x => x.isActive)) seen.set(`brand:${b.id}`, b.name);
    for (const p of posts ?? []) if (!seen.has(p.subjectKey)) seen.set(p.subjectKey, `${p.subjectName} (${p.subjectKind})`);
    return [...seen.entries()];
  }, [brands, posts]);

  const visible = useMemo(() => (posts ?? []).filter(p =>
    (!filterSubject || p.subjectKey === filterSubject)
    && (!filterStatus || p.status === filterStatus)
    && (!filterKind || p.destinationKind === filterKind)
  ), [posts, filterSubject, filterStatus, filterKind]);

  if (gated) {
    return (
      <div className="main">
        <div className="queue-wrap">
          <div className="empty">
            <p><strong>Product Posts is a Pro feature.</strong></p>
            <p>
              Get your brand in front of new audiences — directory listings like
              Product Hunt and BetaList, new posts on Indie Hackers, subreddit
              submissions, or a fresh thread on a forum. The agent fills each form
              in your own browser, signing up with the email and Google account
              you're logged into there, finds the logos and screenshots each form
              wants, and you approve before anything submits. Pro also unlocks
              the venue playbook: 300+ directories, launch sites, communities and
              forums with their signup paths, form quirks and posting rules,
              kept up to date from real runs.
            </p>
            <p><button type="button" onClick={onOpenLicense}>Upgrade to Pro</button></p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main">
      <div className="queue-wrap">
        {error && <div className="error">{error}</div>}
        <div className="view-note">
          Product posts run in Claude Code: pick what to post and where in the
          right pane, copy the command, and run it there — the agent fills the
          form in your browser and stops for your review before submitting. This
          list tracks the results.
        </div>
        <div className="filter-bar">
          <label>
            Subject
            <select value={filterSubject} onChange={e => setFilterSubject(e.target.value)}>
              <option value="">All</option>
              {subjectOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label>
            Status
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
              <option value="">All</option>
              {(Object.keys(STATUS_LABELS) as PostStatus[]).map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <label>
            Kind
            <select value={filterKind} onChange={e => setFilterKind(e.target.value)}>
              <option value="">All</option>
              {(Object.keys(KIND_SHORT) as DestinationKind[]).map(k => <option key={k} value={k}>{KIND_SHORT[k]}</option>)}
            </select>
          </label>
        </div>
        {posts === null ? (
          <div className="empty">Loading…</div>
        ) : visible.length ? (
          <div className="opp-list">
            {visible.map(p => <PostRow key={p.id} post={p} destName={destName(p)} />)}
          </div>
        ) : (
          <div className="empty">
            {posts.length ? 'No product posts match the current filters.' : 'No product posts yet — build a command on the right to get started.'}
          </div>
        )}
      </div>
      <DestinationsPane
        destinations={destinations}
        posts={posts ?? []}
        brands={brands}
        contentItems={contentItems}
        subject={subject}
        onSubjectChange={setSubject}
        dataTick={dataTick}
      />
    </div>
  );
}
