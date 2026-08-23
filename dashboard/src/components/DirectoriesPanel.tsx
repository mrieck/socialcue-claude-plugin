import { useEffect, useMemo, useState } from 'react';
import { ApiError, getDirectories, getSubmissions, patchSubmission } from '../api';
import type { Brand, Directory, Submission, SubmissionStatus } from '../types';

/**
 * Directories — the Pro "submit anywhere" pillar's state surface. The panel
 * shows the registry and every submission attempt per brand; it deliberately
 * does NOT trigger submissions. Agentic form-filling needs the Claude Code
 * loop, so the "Submit" affordance copies the `/socialcue-submit` command for
 * the user to run there (same reason the bridge has no start endpoint).
 */
interface Props {
  /** Bumped by the /api/changes poll so CLI-side progress lands live. */
  dataTick: number;
  brands: Brand[];
  pro: boolean;
  onOpenLicense: () => void;
}

const STATUS_LABELS: Record<SubmissionStatus, string> = {
  pending: 'Pending',
  account_created: 'Account created',
  awaiting_verification: 'Awaiting email',
  submitted: 'Submitted',
  live: 'Live',
  failed: 'Failed',
  skipped: 'Skipped',
};

/** Reuse the queue's pill palette: map submission states onto its classes. */
const STATUS_PILL: Record<SubmissionStatus, string> = {
  pending: 'pill-new',
  account_created: 'pill-reviewed',
  awaiting_verification: 'pill-reviewed',
  submitted: 'pill-approved',
  live: 'pill-posted',
  failed: 'pill-failed',
  skipped: 'pill-skipped',
};

const TEST_LABELS: Record<NonNullable<Directory['testStatus']>, string> = {
  works: 'works',
  needs_fix: 'needs fix',
  blocked: 'blocked',
};
const TEST_PILL: Record<NonNullable<Directory['testStatus']>, string> = {
  works: 'pill-approved',
  needs_fix: 'pill-reviewed',
  blocked: 'pill-failed',
};

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google', github: 'GitHub', microsoft: 'Microsoft', discord: 'Discord',
  twitter: 'X', apple: 'Apple', facebook: 'Facebook',
};

/** "No account" / "Email signup" / "Google login" / "Google or email" / "Signup ?" */
function signupLabel(d: Directory): string {
  const providers = (d.oauthProviders ?? []).map(p => PROVIDER_LABELS[p] ?? p).join('/');
  switch (d.signup) {
    case 'none': return 'no account';
    case 'email': return 'email signup';
    case 'oauth': return providers ? `${providers} login` : 'OAuth login';
    case 'mixed': return providers ? `${providers} or email` : 'OAuth or email';
    default: return 'signup ?';
  }
}

function SubmissionRow({ sub, dirName }: { sub: Submission; dirName: string }) {
  const [showLog, setShowLog] = useState(false);
  const [listingDraft, setListingDraft] = useState('');
  const [row, setRow] = useState(sub);
  useEffect(() => setRow(sub), [sub]);

  const markLive = async () => {
    const listingUrl = listingDraft.trim();
    try {
      setRow(await patchSubmission(row.id, listingUrl ? { status: 'live', listingUrl } : { status: 'live' }));
    } catch { /* poll error banner covers it */ }
  };

  return (
    <div className="opp-row" style={{ cursor: 'default' }}>
      <div className="row-main">
        <div className="row-title">
          {dirName}
          <span className={`pill ${STATUS_PILL[row.status]}`}>{STATUS_LABELS[row.status]}</span>
        </div>
        <div className="row-meta">
          {row.emailUsed && <span>email: {row.emailUsed}</span>}
          {row.listingUrl
            ? <a href={row.listingUrl} target="_blank" rel="noreferrer">listing ↗</a>
            : <a href={row.directoryUrl} target="_blank" rel="noreferrer">site ↗</a>}
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
                placeholder="live listing URL (optional)"
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

export function DirectoriesPanel({ dataTick, brands, pro, onOpenLicense }: Props) {
  const [directories, setDirectories] = useState<Directory[]>([]);
  const [submissions, setSubmissions] = useState<Submission[] | null>(null);
  const [gated, setGated] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => {
    getDirectories().then(setDirectories).catch(() => {});
    if (!pro) { setGated(true); return; } // free tier never requests (same as perf)
    getSubmissions()
      .then(s => { setSubmissions(s); setGated(false); })
      .catch(err => {
        if (err instanceof ApiError && err.status === 403) setGated(true);
        else setError(String(err?.message ?? err));
      });
  }, [dataTick, pro]);

  const dirName = useMemo(() => {
    const m = new Map(directories.map(d => [d.id, d.name]));
    return (sub: Submission) => (sub.directoryId && m.get(sub.directoryId)) || sub.directoryUrl;
  }, [directories]);

  const activeBrands = brands.filter(b => b.isActive);
  const submittedFor = useMemo(() => {
    const set = new Set((submissions ?? []).map(s => `${s.brandId}:${s.directoryId}`));
    return (brandId: string, dirId: string) => set.has(`${brandId}:${dirId}`);
  }, [submissions]);

  const copyCommand = (brandName: string, dirId: string) => {
    const cmd = `/socialcue-submit "${brandName}" ${dirId}`;
    void navigator.clipboard.writeText(cmd).then(() => {
      setCopied(`${brandName}:${dirId}`);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  if (gated) {
    return (
      <div className="main">
        <div className="queue-wrap">
          <div className="empty">
            <p><strong>Directory submission is a Pro feature.</strong></p>
            <p>
              Get your brand listed on Product Hunt, BetaList, and dozens of other
              directories. The agent fills each form in your own browser, signing up
              with the email and Google account you're logged into there, and you
              approve before anything submits.
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
          Submissions run in Claude Code: pick a directory below, copy the command,
          and run it there — the agent fills the form in your browser and stops for
          your review before submitting. This page tracks the results.
        </div>

        {activeBrands.map(brand => {
          const rows = (submissions ?? []).filter(s => s.brandId === brand.id);
          return (
            <section key={brand.id}>
              <h2>{brand.name}</h2>
              {rows.length
                ? rows.map(s => <SubmissionRow key={s.id} sub={s} dirName={dirName(s)} />)
                : <div className="empty">No submissions yet.</div>}
              <details>
                <summary>Submit {brand.name} to a directory…</summary>
                <div className="opp-list">
                  {directories.map(d => (
                    <div key={d.id} className="opp-row" style={{ cursor: 'default' }}>
                      <div className="row-main">
                        <div className="row-title">
                          {d.name}
                          {submittedFor(brand.id, d.id) && <span className="badge">attempted</span>}
                          <span className="badge">{signupLabel(d)}</span>
                          {d.testStatus && (
                            <span className={`pill ${TEST_PILL[d.testStatus]}`}>{TEST_LABELS[d.testStatus]}</span>
                          )}
                        </div>
                        <div className="row-meta">
                          <a href={d.url} target="_blank" rel="noreferrer">{d.url.replace(/^https?:\/\//, '')}</a>
                          <button className="copy" type="button" onClick={() => copyCommand(brand.name, d.id)}>
                            {copied === `${brand.name}:${d.id}` ? 'copied!' : 'copy command'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="view-note">
                  Not listed? Any URL works: <code>/socialcue-submit "{brand.name}" https://…</code>
                </div>
              </details>
            </section>
          );
        })}
        {!activeBrands.length && <div className="empty">No active brands — run /socialcue-setup first.</div>}
      </div>
    </div>
  );
}
