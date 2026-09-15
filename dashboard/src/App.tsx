import { useCallback, useEffect, useMemo, useState } from 'react';
import { bootstrapToken, clearOpportunities, getBrands, getLeads, getLicense, patchLead, patchOpportunity, patchStatus, saveToken } from './api';
import type { OpportunityPatch } from './api';
import { useOpportunities } from './hooks/useOpportunities';
import { usePerformance } from './hooks/usePerformance';
import { FilterBar } from './components/FilterBar';
import { QueueTable } from './components/QueueTable';
import { DetailPane } from './components/DetailPane';
import { UpgradeModal } from './components/UpgradeModal';
import { ContentPanel } from './components/ContentPanel';
import { ProductPostsPanel } from './components/ProductPostsPanel';
import { InvitationsList, LeadDetail, isOpenLead, leadBrandName } from './components/Invitations';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { orderQueue } from './queueOrder';
import type { Brand, CanonicalStatus, Filters, Lead, LicenseInfo, QueueSort, View } from './types';

// Per-tab filter presets. Conversations is scoped to replies so "places to
// post" nudges don't leak in; it shows every status except skipped (cleared) so
// a row can never fall into a gap between tabs — posted rows stay visible too,
// struck through. Analytics' "Submitted replies" list is fixed to posted (any kind).
const FILTERS_BY_VIEW: Record<View, Filters> = {
  opportunities: { status: '', notStatus: 'skipped', platform: '', brand: '', source: '', kind: 'reply', sort: '' },
  analytics: { status: 'posted', notStatus: '', platform: '', brand: '', source: '', kind: '', sort: '' },
  // Content Library renders its own panel (original posts, not opportunities);
  // preset is unused but keeps navigate() uniform.
  content: { status: '', notStatus: '', platform: '', brand: '', source: '', kind: '', sort: '' },
  // Product Posts renders its own panel; preset is unused but keeps navigate() uniform.
  posts: { status: '', notStatus: '', platform: '', brand: '', source: '', kind: '', sort: '' },
  // Settings renders its own panel; preset is unused but keeps navigate() uniform.
  settings: { status: '', notStatus: '', platform: '', brand: '', source: '', kind: '', sort: '' },
};

// The queue sort is a preference, not a filter: it survives tab switches and
// reloads (navigate() resets the rest of the filters to the tab preset).
const SORT_KEY = 'sc-queue-sort';
function loadSort(): QueueSort {
  try { return localStorage.getItem(SORT_KEY) === 'score' ? 'score' : ''; } catch { return ''; }
}
function saveSort(sort: QueueSort) {
  try { localStorage.setItem(SORT_KEY, sort); } catch { /* private mode etc. */ }
}
function presetFor(v: View): Filters {
  const f = FILTERS_BY_VIEW[v];
  return v === 'opportunities' ? { ...f, sort: loadSort() } : f;
}

const THEME_KEY = 'sc-theme';
type Theme = 'dark' | 'light';

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

// Apply the saved theme on load so the token gate matches too (before the
// toggle in the topbar mounts).
applyTheme((localStorage.getItem(THEME_KEY) as Theme) || 'dark');

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || 'dark',
  );
  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      className="theme-toggle"
      type="button"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      onClick={() => setTheme(next)}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}

function TokenGate({ onSave }: { onSave: (t: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="token-gate">
      <h1>Social Cue</h1>
      <p>
        Paste the pairing token printed by <code>bridge start</code> (or reopen the
        dashboard link it prints, which carries the token automatically).
      </p>
      <form
        onSubmit={e => {
          e.preventDefault();
          if (value.trim()) onSave(value);
        }}
      >
        <input
          type="password"
          value={value}
          placeholder="pairing token"
          onChange={e => setValue(e.target.value)}
        />
        <button type="submit">Connect</button>
      </form>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState<string | null>(() => bootstrapToken());
  const [view, setView] = useState<View>('opportunities');
  const [filters, setFilters] = useState<Filters>(() => presetFor('opportunities'));
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Founder invitations (Pro) share the Conversations view: pinned under the
  // queue, opened in the same right pane. One selection at a time across both.
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseInfo>({ pro: false });
  const [showLicense, setShowLicense] = useState(false);

  const { opportunities, counts, error, authFailed, loading, refetch, setOpportunities, dataTick } =
    useOpportunities(filters, !!token);

  // Performance check-ins decorate the Analytics view's posted-replies list
  // (Pro only; free tier never requests them and sees the list undecorated).
  const perf = usePerformance(view === 'analytics' && license.pro, dataTick);

  const navigate = (v: View) => {
    setView(v);
    setFilters(presetFor(v));
    setSelectedId(null);
    setSelectedLeadId(null);
  };
  const selectOpportunity = (id: string | null) => { setSelectedId(id); setSelectedLeadId(null); };
  const selectLead = (id: string | null) => { setSelectedLeadId(id); setSelectedId(null); };

  // Free tier never requests leads (403 anyway); a failed load just leaves the
  // block empty — the poll error banner covers a dead bridge.
  const loadLeads = useCallback(async () => {
    if (!token || !license.pro) { setLeads([]); return; }
    try { setLeads((await getLeads()).leads); } catch { /* keep what we have */ }
  }, [token, license.pro]);
  useEffect(() => { void loadLeads(); }, [loadLeads, dataTick]);

  // Brand/platform filters apply to the pinned people too; dismissed (skipped)
  // and closed leads are gone for good.
  const visibleLeads = useMemo(
    () => leads.filter(l => isOpenLead(l)
      && (!filters.brand || l.brandId === filters.brand)
      && (!filters.platform || l.platform === filters.platform)),
    [leads, filters.brand, filters.platform],
  );
  const selectedLead = leads.find(l => l.id === selectedLeadId) ?? null;
  const replaceLead = (next: Lead) => setLeads(ls => ls.map(l => (l.id === next.id ? next : l)));

  const dismissLead = async (id: string) => {
    const prev = leads;
    setLeads(prev.map(l => (l.id === id ? { ...l, status: 'skipped' } : l)));
    if (selectedLeadId === id) setSelectedLeadId(null);
    try { replaceLead(await patchLead(id, { status: 'skipped' })); } catch { setLeads(prev); }
  };

  // Score sort is applied here, not in the bridge: the list is already in hand
  // (≤200 rows) and the run-grouping rule is a display concern.
  const ordered = useMemo(() => orderQueue(opportunities, filters.sort), [opportunities, filters.sort]);

  useEffect(() => {
    if (token) {
      getBrands().then(setBrands).catch(() => {});
      getLicense().then(setLicense).catch(() => {});
    }
  }, [token]);

  const platforms = useMemo(
    () => [...new Set(opportunities.map(o => o.platform))].sort(),
    [opportunities],
  );

  const selected = opportunities.find(o => o.id === selectedId) ?? null;
  const selectedPerf = view === 'analytics' && selectedId ? perf.get(selectedId) : undefined;

  const setStatus = async (id: string, status: CanonicalStatus) => {
    const prev = opportunities;
    // Optimistic; revert on failure. The row may leave the current filter — that's expected.
    setOpportunities(prev.map(o => (o.id === id ? { ...o, status } : o)));
    try {
      await patchStatus(id, status);
      void refetch();
      void loadLeads(); // a linked invitation's "reply posted" state follows the reply
    } catch {
      setOpportunities(prev);
    }
  };

  // Review-field updates (draft rewrite / note). Optimistic; the bridge returns
  // the authoritative row, which replaces the guess. Throws so the pane can
  // surface failures instead of silently losing an edit.
  const updateOpportunity = async (id: string, patch: OpportunityPatch) => {
    const prev = opportunities;
    setOpportunities(prev.map(o => (o.id === id ? { ...o, ...patch } : o)));
    try {
      const updated = await patchOpportunity(id, patch);
      setOpportunities(cur => cur.map(o => (o.id === id ? updated : o)));
    } catch (err) {
      setOpportunities(prev);
      throw err;
    }
  };

  // "Clear all": bulk-skip the whole reply queue (old conversations go stale
  // fast — this empties the dashboard in one click). Posted rows are untouched.
  const clearAll = async () => {
    const n = opportunities.filter(x => x.status !== 'posted').length;
    if (!n) return;
    if (!window.confirm(`Skip all ${n} conversations in the queue? Posted replies are kept.`)) return;
    try {
      await clearOpportunities();
      selectOpportunity(null);
      void refetch();
    } catch {
      /* the poll error banner covers it */
    }
  };

  // save-example stamps exampleSavedAt server-side; merge it back into the row.
  const markExampleSaved = (id: string, exampleSavedAt: string) => {
    setOpportunities(cur => cur.map(o => (o.id === id ? { ...o, exampleSavedAt } : o)));
  };

  if (!token || authFailed) {
    return (
      <TokenGate
        onSave={t => {
          saveToken(t);
          setToken(t);
          void refetch();
        }}
      />
    );
  }

  const TITLES: Record<View, string> = {
    opportunities: 'Conversations — threads worth joining, with drafted replies',
    posts: 'Product Posts — list, launch, or post your product anywhere',
    content: 'Content Library — content created that\'s ready to post',
    analytics: 'Analytics — weekly goals and what you\'ve posted',
    settings: 'Settings — brands & run config',
  };

  return (
    <div className="app">
      <Sidebar view={view} counts={counts} onNavigate={navigate} />
      <div className="content">
        <header className="topbar">
          <h1>{TITLES[view]}</h1>
          {error && <span className="error">{error}</span>}
          <div className="topbar-right">
            {license.pro && <span className="badge badge-pro">Pro</span>}
            {license.previewFree && <span className="badge" title="Maintainer preview: everything behaves as the free tier">Free preview</span>}
            <button className="copy" onClick={() => setShowLicense(true)}>License</button>
            <ThemeToggle />
          </div>
        </header>
        {showLicense && (
          <UpgradeModal
            license={license}
            onActivated={info => setLicense(info)}
            onClose={() => setShowLicense(false)}
          />
        )}
        {view === 'settings' ? (
          <div className="main">
            <div className="queue-wrap">
              <SettingsPanel />
            </div>
          </div>
        ) : view === 'content' ? (
          <ContentPanel
            dataTick={dataTick}
            brands={brands}
          />
        ) : view === 'posts' ? (
          <ProductPostsPanel
            dataTick={dataTick}
            brands={brands}
            pro={license.pro}
            onOpenLicense={() => setShowLicense(true)}
          />
        ) : view === 'analytics' ? (
          <AnalyticsPanel
            dataTick={dataTick}
            brands={brands}
            platforms={platforms}
            filters={filters}
            onFiltersChange={f => { setFilters(f); setSelectedId(null); }}
            opportunities={opportunities}
            loading={loading}
            selected={selected}
            selectedId={selectedId}
            onSelect={setSelectedId}
            perf={perf}
            selectedPerf={selectedPerf}
            pro={license.pro}
            onOpenLicense={() => setShowLicense(true)}
            onSetStatus={setStatus}
            onUpdate={updateOpportunity}
            onExampleSaved={markExampleSaved}
          />
        ) : (
          <>
            <FilterBar
              filters={filters}
              brands={brands}
              platforms={platforms}
              onClearAll={clearAll}
              sortable
              onChange={f => {
                if (f.sort !== filters.sort) saveSort(f.sort);
                setFilters(f);
                selectOpportunity(null);
              }}
            />
            <div className="main">
              <div className="queue-wrap">
                {loading
                  ? <div className="empty">Loading…</div>
                  : <>
                      <QueueTable
                        opportunities={ordered}
                        brands={brands}
                        selectedId={selectedId}
                        onSelect={selectOpportunity}
                        runGroups={filters.sort === 'score'}
                        showScore={filters.sort === 'score'}
                        strikePosted
                        onSetStatus={setStatus}
                      />
                      <InvitationsList
                        leads={visibleLeads}
                        brands={brands}
                        selectedId={selectedLeadId}
                        onSelect={selectLead}
                        onDismiss={id => void dismissLead(id)}
                      />
                    </>}
              </div>
              {selectedLead
                ? <LeadDetail
                    key={selectedLead.id}
                    lead={selectedLead}
                    brandName={leadBrandName(selectedLead, brands)}
                    onChanged={replaceLead}
                    onOpenLicense={() => setShowLicense(true)}
                    onOpenConversation={selectOpportunity}
                  />
                : <DetailPane
                    opportunity={selected}
                    brands={brands}
                    onSetStatus={setStatus}
                    onUpdate={updateOpportunity}
                    onExampleSaved={markExampleSaved}
                    pro={license.pro}
                    onOpenLicense={() => setShowLicense(true)}
                  />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
