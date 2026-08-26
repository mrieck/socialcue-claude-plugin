import { useEffect, useMemo, useState } from 'react';
import { fetchAssetUrl, getAssets } from '../api';
import type {
  AssetOnFile, Brand, ContentItem, Destination, DestinationCategory, DestinationCost, DestinationFit, PostType, ProductPost,
} from '../types';

/**
 * Right pane of Product Posts: "all the places to post". A small "Post…"
 * builder at the top (pick what to post + where → a /socialcue-post command
 * to copy), the subject's cached assets, then the destination catalog grouped
 * by kind. Nothing here triggers a post — the agent loop lives in Claude Code.
 */

/** What the builder is posting. Mirrors `post start --subject`. */
export type SubjectChoice =
  | { kind: 'brand'; id: string; name: string }
  | { kind: 'content'; id: string; name: string }
  | { kind: 'adhoc'; name: string; url: string; path: string };

export function subjectKeyOf(s: SubjectChoice | null): string | null {
  if (!s) return null;
  if (s.kind === 'brand') return `brand:${s.id}`;
  if (s.kind === 'content') return `content:${s.id}`;
  const slug = s.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `adhoc:${slug}` : null;
}

const CATEGORY_LABELS: Record<DestinationCategory, string> = {
  startup: 'Startup & product directories',
  launch: 'Launch platforms',
  'ai-tools': 'AI tool directories',
  'ai-agents': 'AI agent directories',
  mcp: 'MCP registries',
  claude: 'Claude plugin & skill directories',
  'browser-ext': 'Browser extension directories',
  mac: 'Mac app directories',
  ios: 'iOS app directories & review sites',
  review: 'Software review sites',
  oss: 'Open source & self-hosted',
  'startup-db': 'Startup databases',
  regional: 'Regional directories',
  community: 'Communities',
  forum: 'Forums',
};
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as DestinationCategory[];
const FIT_LABELS: Record<DestinationFit, string> = {
  saas: 'SaaS', ai: 'AI', mcp: 'MCP', 'claude-plugin': 'Claude plugin', 'chrome-ext': 'Browser ext',
  mac: 'Mac', ios: 'iOS', oss: 'Open source', devtool: 'Dev tool',
};
const FIT_ORDER = Object.keys(FIT_LABELS) as DestinationFit[];
const COST_LABELS: Record<DestinationCost, string> = { free: 'free', freemium: 'freemium', paid: 'paid', revshare: 'rev-share' };
const COST_ORDER: DestinationCost[] = ['free', 'freemium', 'paid'];
const FILTER_KEY = 'sc.destFilters';

/** The category a row is shown under (rows added via `dest add` may lack one). */
function categoryOf(d: Destination): DestinationCategory {
  if (d.category) return d.category;
  return d.kind === 'launch' ? 'launch' : d.kind === 'community' ? 'community' : d.kind === 'forum' ? 'forum' : 'startup';
}

interface DestFilters { fits: DestinationFit[]; costs: DestinationCost[] }
function loadFilters(): DestFilters {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<DestFilters>;
      return {
        fits: (v.fits ?? []).filter((f): f is DestinationFit => f in FIT_LABELS),
        costs: (v.costs ?? []).filter((c): c is DestinationCost => c in COST_LABELS),
      };
    }
  } catch { /* storage unavailable */ }
  return { fits: [], costs: [] };
}
function saveFilters(f: DestFilters) {
  try { localStorage.setItem(FILTER_KEY, JSON.stringify(f)); } catch { /* ignore */ }
}
const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google', github: 'GitHub', microsoft: 'Microsoft', discord: 'Discord',
  twitter: 'X', apple: 'Apple', facebook: 'Facebook', forem: 'Forem',
};

/** "no account" / "email signup" / "Google login" / "Google or email" / "signup ?" */
export function signupLabel(d: Destination): string {
  const providers = (d.oauthProviders ?? []).map(p => PROVIDER_LABELS[p] ?? p).join('/');
  switch (d.signup) {
    case 'none': return 'no account';
    case 'email': return 'email signup';
    case 'oauth': return providers ? `${providers} login` : 'OAuth login';
    case 'mixed': return providers ? `${providers} or email` : 'OAuth or email';
    default: return 'signup ?';
  }
}

/**
 * The /socialcue-post invocation for this subject + destination, in plain
 * words — the agent resolves names itself; nobody types ids or flags.
 */
export function buildCommand(subject: SubjectChoice | null, dest: Destination | null, customUrl: string, type: PostType | ''): string | null {
  const where = customUrl.trim() || dest?.name || '';
  if (!subject || !where) return null;
  let what: string;
  if (subject.kind === 'adhoc') {
    const name = subject.name.trim();
    const url = subject.url.trim();
    if (!name && !url) return null;
    what = name ? name : url;
    if (name && url) what += ` (${url})`;
    if (subject.path.trim()) what += ` — files in ${subject.path.trim()}`;
  } else {
    what = subject.name;
  }
  const how = type ? ` as a ${type === 'listing' ? 'listing' : type === 'article' ? 'full article' : type === 'thread' ? 'text post' : 'link post'}` : '';
  return `/socialcue-post ${what} to ${where}${how}`;
}

function AssetThumb({ subjectKey, asset }: { subjectKey: string; asset: AssetOnFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let obj: string | null = null;
    let cancelled = false;
    fetchAssetUrl(subjectKey, asset.file)
      .then(u => { if (cancelled) URL.revokeObjectURL(u); else { obj = u; setUrl(u); } })
      .catch(() => {});
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [subjectKey, asset.file]);
  return (
    <figure className="asset-thumb" title={asset.file}>
      {url ? <img src={url} alt={asset.role} /> : <div className="asset-ph" />}
      <figcaption>
        {asset.role}
        {asset.width && asset.height ? <span> · {asset.width}×{asset.height}</span> : null}
      </figcaption>
    </figure>
  );
}

interface Props {
  destinations: Destination[];
  posts: ProductPost[];
  brands: Brand[];
  contentItems: ContentItem[];
  subject: SubjectChoice | null;
  onSubjectChange: (s: SubjectChoice | null) => void;
  dataTick: number;
}

export function DestinationsPane({ destinations, posts, brands, contentItems, subject, onSubjectChange, dataTick }: Props) {
  const [destId, setDestId] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [type, setType] = useState<PostType | ''>('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<DestFilters>(loadFilters);
  const [copied, setCopied] = useState('');
  const [assets, setAssets] = useState<AssetOnFile[]>([]);

  const subjectKey = subjectKeyOf(subject);
  const selectedDest = destinations.find(d => d.id === destId) ?? null;

  // A destination's post types drive the optional --type; reset when it no longer fits.
  useEffect(() => {
    if (customUrl.trim()) return;
    if (type && selectedDest && !selectedDest.postTypes.includes(type)) setType('');
  }, [selectedDest, customUrl, type]);

  useEffect(() => {
    if (!subjectKey) { setAssets([]); return; }
    getAssets(subjectKey).then(setAssets).catch(() => setAssets([]));
  }, [subjectKey, dataTick]);

  const command = buildCommand(subject, selectedDest, customUrl, type);

  const attempted = useMemo(() => {
    const set = new Set(posts.filter(p => p.subjectKey === subjectKey).map(p => p.destinationId));
    return (id: string) => set.has(id);
  }, [posts, subjectKey]);

  const filtering = filters.fits.length > 0 || filters.costs.length > 0;
  // Fit/cost chips narrow both the catalog and the "Where" dropdown; the
  // search box only narrows the catalog. Communities/forums carry no fit
  // tags, so a fit filter never hides them (they take anything).
  const filtered = useMemo(() => destinations.filter(d => {
    if (filters.fits.length && d.fits.length && !filters.fits.some(f => d.fits.includes(f))) return false;
    if (filters.costs.length && d.cost && !filters.costs.includes(d.cost)) return false;
    return true;
  }), [destinations, filters]);

  const grouped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = needle
      ? filtered.filter(d => `${d.name} ${d.id} ${d.url} ${d.notes} ${d.localNotes ?? ''} ${categoryOf(d)} ${d.fits.join(' ')} ${d.cost ?? ''}`.toLowerCase().includes(needle))
      : filtered;
    return CATEGORY_ORDER
      .map(category => ({ category, rows: rows.filter(d => categoryOf(d) === category) }))
      .filter(g => g.rows.length);
  }, [filtered, search]);
  const expandAll = filtering || search.trim().length > 0;

  const toggleFit = (f: DestinationFit) => setFilters(prev => {
    const next = { ...prev, fits: prev.fits.includes(f) ? prev.fits.filter(x => x !== f) : [...prev.fits, f] };
    saveFilters(next);
    return next;
  });
  const toggleCost = (c: DestinationCost) => setFilters(prev => {
    const next = { ...prev, costs: prev.costs.includes(c) ? prev.costs.filter(x => x !== c) : [...prev.costs, c] };
    saveFilters(next);
    return next;
  });
  const clearFilters = () => { const next = { fits: [], costs: [] }; saveFilters(next); setFilters(next); };

  const copy = (text: string, key: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  const pickSubject = (value: string) => {
    if (!value) { onSubjectChange(null); return; }
    const [kind, id] = value.split(':', 2);
    if (kind === 'brand') {
      const b = brands.find(x => x.id === id);
      if (b) onSubjectChange({ kind: 'brand', id: b.id, name: b.name });
    } else if (kind === 'content') {
      const c = contentItems.find(x => x.id === id);
      if (c) onSubjectChange({ kind: 'content', id: c.id, name: c.title || '(untitled)' });
    } else if (kind === 'adhoc') {
      onSubjectChange({ kind: 'adhoc', name: '', url: '', path: '' });
    }
  };
  const subjectValue = !subject ? '' : subject.kind === 'adhoc' ? 'adhoc:' : `${subject.kind}:${subject.id}`;

  return (
    <div className="detail dest-pane">
      <section className="post-form">
        <h3>Post…</h3>
        <label>
          What
          <select value={subjectValue} onChange={e => pickSubject(e.target.value)}>
            <option value="">— pick a subject —</option>
            {brands.filter(b => b.isActive).length > 0 && (
              <optgroup label="Brands">
                {brands.filter(b => b.isActive).map(b => (
                  <option key={b.id} value={`brand:${b.id}`}>{b.name}</option>
                ))}
              </optgroup>
            )}
            {contentItems.length > 0 && (
              <optgroup label="Content Library">
                {contentItems.map(c => (
                  <option key={c.id} value={`content:${c.id}`}>{c.title || '(untitled)'}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="Something else">
              <option value="adhoc:">Ad-hoc project / URL…</option>
            </optgroup>
          </select>
        </label>
        {subject?.kind === 'adhoc' && (
          <>
            <label>
              Name
              <input type="text" placeholder="e.g. claude-plugins" value={subject.name}
                onChange={e => onSubjectChange({ ...subject, name: e.target.value })} />
            </label>
            <label>
              URL
              <input type="text" placeholder="https://github.com/you/repo" value={subject.url}
                onChange={e => onSubjectChange({ ...subject, url: e.target.value })} />
            </label>
            <label>
              Local folder
              <input type="text" placeholder="/abs/path (optional — logos, screenshots, README)" value={subject.path}
                onChange={e => onSubjectChange({ ...subject, path: e.target.value })} />
            </label>
          </>
        )}
        <label>
          Where
          <select value={destId} onChange={e => { setDestId(e.target.value); setCustomUrl(''); }}>
            <option value="">— pick a destination —</option>
            {CATEGORY_ORDER.map(category => {
              const rows = filtered.filter(d => categoryOf(d) === category || d.id === destId);
              return rows.length ? (
                <optgroup key={category} label={CATEGORY_LABELS[category]}>
                  {rows.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </optgroup>
              ) : null;
            })}
          </select>
        </label>
        <label>
          or any URL
          <input type="text" placeholder="https://… (a submit or new-post page)" value={customUrl}
            onChange={e => { setCustomUrl(e.target.value); if (e.target.value.trim()) setDestId(''); }} />
        </label>
        {(customUrl.trim() || (selectedDest && selectedDest.postTypes.length > 1)) && (
          <label>
            Type
            <select value={type} onChange={e => setType(e.target.value as PostType | '')}>
              <option value="">{selectedDest ? `default (${selectedDest.postTypes[0]})` : 'let the agent decide'}</option>
              {(selectedDest?.postTypes ?? ['listing', 'article', 'thread', 'link']).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        )}
        <div className="cmd-box">
          <code>{command ?? 'Pick what to post and where — or just tell Claude Code in your own words: /socialcue-post the DemoDay video to r/SideProject'}</code>
          <button className="copy" type="button" disabled={!command} onClick={() => command && copy(command, 'form')}>
            {copied === 'form' ? 'copied!' : 'copy'}
          </button>
        </div>
      </section>

      {subjectKey && (
        <section>
          <h3>Assets on file <span className="muted">{subjectKey}</span></h3>
          {assets.length ? (
            <div className="asset-grid">
              {assets.map(a => <AssetThumb key={a.file} subjectKey={subjectKey} asset={a} />)}
            </div>
          ) : (
            <p className="muted small">Nothing cached yet — the agent finds or makes what each form needs and saves reusable logos/screenshots here.</p>
          )}
        </section>
      )}

      <section>
        <h3>
          Places to post{' '}
          <span className="muted">{filtering ? `${filtered.length} of ${destinations.length}` : destinations.length}</span>
        </h3>
        <input className="dest-search" type="search" placeholder="Search destinations…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <div className="dest-filters">
          <span className="dest-filter-label">Fits</span>
          {FIT_ORDER.map(f => (
            <button key={f} type="button" className={`chip${filters.fits.includes(f) ? ' on' : ''}`}
              onClick={() => toggleFit(f)}>{FIT_LABELS[f]}</button>
          ))}
        </div>
        <div className="dest-filters">
          <span className="dest-filter-label">Cost</span>
          {COST_ORDER.map(c => (
            <button key={c} type="button" className={`chip${filters.costs.includes(c) ? ' on' : ''}`}
              onClick={() => toggleCost(c)}>{COST_LABELS[c]}</button>
          ))}
          {filtering && <button type="button" className="chip clear" onClick={clearFilters}>clear</button>}
        </div>
        {grouped.map(g => (
          <details key={`${g.category}:${expandAll}`} className="dest-group" open={expandAll}>
            <summary>{CATEGORY_LABELS[g.category]} <span className="muted">{g.rows.length}</span></summary>
            {g.rows.map(d => {
              const cmd = buildCommand(subject, d, '', '');
              const isSel = d.id === destId && !customUrl.trim();
              return (
                <div key={d.id} className={`dest-row${isSel ? ' selected' : ''}`}
                  onClick={() => { setDestId(d.id); setCustomUrl(''); }}>
                  <div className="dest-row-title">
                    <span className="dest-name">{d.name}</span>
                    {subjectKey && attempted(d.id) && <span className="badge">attempted</span>}
                    {d.cost && <span className={`pill pill-cost-${d.cost}`}>{COST_LABELS[d.cost]}</span>}
                  </div>
                  <div className="dest-row-meta">
                    <span>{signupLabel(d)}</span>
                    <span>· {d.postTypes.join('/')}</span>
                    {d.fits.length > 0 && <span className="dest-fits">{d.fits.map(f => FIT_LABELS[f] ?? f).join(' · ')}</span>}
                    <a href={d.submitUrl || d.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>site ↗</a>
                    <button className="copy" type="button" disabled={!cmd}
                      title={cmd ? cmd : 'Pick a subject first'}
                      onClick={e => { e.stopPropagation(); if (cmd) copy(cmd, d.id); }}>
                      {copied === d.id ? 'copied!' : 'copy command'}
                    </button>
                  </div>
                </div>
              );
            })}
          </details>
        ))}
        {!grouped.length && <p className="muted small">No destinations match.</p>}
        <p className="muted small">
          Not listed? Any directory, community, or forum URL works:{' '}
          <code>/socialcue-post my thing to https://…</code>
        </p>
      </section>
    </div>
  );
}
