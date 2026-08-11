import { useEffect, useMemo, useState } from 'react';
import { bootstrapToken, clearOpportunities, getBrands, getLicense, patchOpportunity, patchStatus, saveToken } from './api';
import type { OpportunityPatch } from './api';
import { useOpportunities } from './hooks/useOpportunities';
import { usePerformance } from './hooks/usePerformance';
import { FilterBar } from './components/FilterBar';
import { QueueTable } from './components/QueueTable';
import { DetailPane } from './components/DetailPane';
import { LicensePanel } from './components/LicensePanel';
import { ContentPanel } from './components/ContentPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import type { Brand, CanonicalStatus, Filters, LicenseInfo, View } from './types';

// Per-tab filter presets. Opportunities is scoped to replies so "places to
// post" nudges don't leak in; it shows every status except skipped (cleared) so
// a row can never fall into a gap between tabs — posted rows stay visible too,
// struck through. Submitted is fixed to posted (any kind).
const FILTERS_BY_VIEW: Record<View, Filters> = {
  opportunities: { status: '', notStatus: 'skipped', platform: '', brand: '', source: '', kind: 'reply' },
  submitted: { status: 'posted', notStatus: '', platform: '', brand: '', source: '', kind: '' },
  // Content Strategy renders its own panel (original posts, not opportunities);
  // preset is unused but keeps navigate() uniform.
  content: { status: '', notStatus: '', platform: '', brand: '', source: '', kind: '' },
  // Settings renders its own panel; preset is unused but keeps navigate() uniform.
  settings: { status: '', notStatus: '', platform: '', brand: '', source: '', kind: '' },
};

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
  const [filters, setFilters] = useState<Filters>(FILTERS_BY_VIEW.opportunities);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [license, setLicense] = useState<LicenseInfo>({ pro: false });
  const [showLicense, setShowLicense] = useState(false);

  const { opportunities, counts, error, authFailed, loading, refetch, setOpportunities, dataTick } =
    useOpportunities(filters, !!token);

  // Performance check-ins decorate the Submitted view (Pro only; free tier
  // never requests them and sees Submitted exactly as before).
  const perf = usePerformance(view === 'submitted' && license.pro, dataTick);

  const navigate = (v: View) => {
    setView(v);
    setFilters(FILTERS_BY_VIEW[v]);
    setSelectedId(null);
  };

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
  const selectedPerf = view === 'submitted' && selectedId ? perf.get(selectedId) : undefined;

  const setStatus = async (id: string, status: CanonicalStatus) => {
    const prev = opportunities;
    // Optimistic; revert on failure. The row may leave the current filter — that's expected.
    setOpportunities(prev.map(o => (o.id === id ? { ...o, status } : o)));
    try {
      await patchStatus(id, status);
      void refetch();
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
    if (!window.confirm(`Skip all ${n} opportunities in the queue? Posted replies are kept.`)) return;
    try {
      await clearOpportunities();
      setSelectedId(null);
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
    opportunities: 'Opportunities',
    submitted: 'Submitted posts',
    content: 'Content Strategy — original posts & places to post',
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
            <button className="copy" onClick={() => setShowLicense(s => !s)}>License</button>
            <ThemeToggle />
          </div>
        </header>
        {showLicense && (
          <LicensePanel
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
        ) : (
          <>
            <FilterBar
              filters={filters}
              brands={brands}
              platforms={platforms}
              onClearAll={view === 'opportunities' ? clearAll : undefined}
              onChange={f => { setFilters(f); setSelectedId(null); }}
            />
            <div className="main">
              <div className="queue-wrap">
                {loading
                  ? <div className="empty">Loading…</div>
                  : <QueueTable
                      opportunities={opportunities}
                      brands={brands}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      perf={view === 'submitted' ? perf : undefined}
                      strikePosted={view === 'opportunities'}
                    />}
              </div>
              <DetailPane
                opportunity={selected}
                brands={brands}
                onSetStatus={setStatus}
                onUpdate={updateOpportunity}
                onExampleSaved={markExampleSaved}
                pro={license.pro}
                onOpenLicense={() => setShowLicense(true)}
                perf={selectedPerf}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
