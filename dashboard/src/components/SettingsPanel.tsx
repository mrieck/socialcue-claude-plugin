import { useEffect, useState } from 'react';
import { getLicense, setPreviewFree, ApiError, connectPostiz, disconnectPostiz, getPostizChannels, getSettings, patchBrand, saveDirectorySettings, savePostizChannelMap, saveRunSettings } from '../api';
import type { LicenseInfo, BrandDetail, DirectorySettings, PostizChannel, PostizStatus, Settings } from '../types';
import { POSTIZ_REFERRAL_URL } from './ContentPanel';

// Human labels for the platform keys stored in config.
const PLATFORM_LABELS: Record<string, string> = {
  reddit: 'Reddit',
  hackernews: 'Hacker News',
  hn: 'Hacker News',
  twitter: 'Twitter / X',
  x: 'X / Twitter',
  linkedin: 'LinkedIn',
  producthunt: 'Product Hunt',
  indiehackers: 'Indie Hackers',
};
const platformLabel = (k: string) => PLATFORM_LABELS[k] ?? k;

// The platforms offered as toggles. Config keys already present but not listed
// here (aliases, custom domains) are appended so they can still be turned off.
const PLATFORM_CHOICES = ['reddit', 'hackernews', 'x', 'linkedin', 'producthunt', 'indiehackers'];

const WEIGHT_KEYS = ['feed', 'search', 'trending'] as const;
type WeightKey = (typeof WEIGHT_KEYS)[number];
type Weights = Record<WeightKey, number>;

const WEIGHT_HINTS: Record<WeightKey, string> = {
  feed: 'browse the home feed / subscribed communities',
  search: 'targeted searches for brand-relevant threads',
  trending: 'trending + rising posts',
};

/** Fill in missing weight keys and scale so the three always sum to 100. */
function normalizeWeights(sw: Record<string, number> | undefined): Weights {
  const w: Weights = {
    feed: Number(sw?.feed) || 0,
    search: Number(sw?.search) || 0,
    trending: Number(sw?.trending) || 0,
  };
  const sum = w.feed + w.search + w.trending;
  if (sum <= 0) return { feed: 33, search: 34, trending: 33 };
  const feed = Math.round((w.feed / sum) * 100);
  const search = Math.round((w.search / sum) * 100);
  return { feed, search, trending: 100 - feed - search };
}

/** Move one weight; the other two share the remainder, keeping their ratio. */
function rebalance(w: Weights, key: WeightKey, value: number): Weights {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const [a, b] = WEIGHT_KEYS.filter(k => k !== key);
  const rest = 100 - v;
  const prev = w[a] + w[b];
  const next = { ...w, [key]: v };
  next[a] = prev <= 0 ? Math.ceil(rest / 2) : Math.round((w[a] / prev) * rest);
  next[b] = rest - next[a];
  return next;
}

interface RunForm {
  platforms: string[];
  weights: Weights;
  engagementRatio: number;
  maxTurns: number;
  dryRunPosts: boolean;
}

function RunSetupSection({ settings }: { settings: Settings }) {
  const initial: RunForm = {
    platforms: settings.platforms,
    weights: normalizeWeights(settings.strategyWeights),
    engagementRatio: settings.engagementRatio ?? 0.8,
    maxTurns: settings.maxTurnsPerPlatform ?? 75,
    dryRunPosts: settings.dryRunPosts ?? false,
  };
  const [form, setForm] = useState<RunForm>(initial);
  const [snapshot, setSnapshot] = useState<RunForm>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const dirty = JSON.stringify(form) !== JSON.stringify(snapshot);
  const choices = [...PLATFORM_CHOICES, ...form.platforms.filter(p => !PLATFORM_CHOICES.includes(p))];

  const togglePlatform = (key: string) =>
    setForm(f => ({
      ...f,
      platforms: f.platforms.includes(key)
        ? f.platforms.filter(p => p !== key)
        : [...f.platforms, key],
    }));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await saveRunSettings({
        platforms: form.platforms,
        strategyWeights: form.weights,
        engagementRatio: form.engagementRatio,
        maxTurnsPerPlatform: form.maxTurns,
        dryRunPosts: form.dryRunPosts,
      });
      setSnapshot(form);
      setMsg({ text: 'Saved — applies to your next discovery run', ok: true });
    } catch (err) {
      setMsg({
        text: err instanceof ApiError ? `Save failed: ${err.message}` : 'Save failed — is the bridge running?',
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  };

  const communityPct = Math.round(form.engagementRatio * 100);

  return (
    <section className="settings-block">
      <div className="settings-block-head">
        <h3>Run setup</h3>
        <div className="run-actions">
          {msg && !dirty && <span className={msg.ok ? 'post-msg ok' : 'post-msg err'}>{msg.text}</span>}
          {dirty && (
            <>
              <button onClick={() => { setForm(snapshot); setMsg(null); }} disabled={busy}>Reset</button>
              <button className="copy" onClick={() => void save()} disabled={busy || !form.platforms.length}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
            </>
          )}
        </div>
      </div>
      <p className="view-note">
        What your next discovery run will use — saved straight into{' '}
        <code>.socialdiscovery/config.json</code>.
      </p>

      <div className="run-field">
        <label>Target platforms</label>
        <div className="chip-row">
          {choices.map(key => {
            const on = form.platforms.includes(key);
            return (
              <button
                key={key}
                type="button"
                className={`chip${on ? ' on' : ''}`}
                aria-pressed={on}
                onClick={() => togglePlatform(key)}
              >
                {platformLabel(key)}
              </button>
            );
          })}
        </div>
        {!form.platforms.length && <p className="post-msg err">Pick at least one platform.</p>}
      </div>

      <div className="run-field">
        <label>
          Strategy budget <span className="hint">how the run splits its browsing time</span>
        </label>
        {WEIGHT_KEYS.map(k => (
          <div className="slider-row" key={k}>
            <span className="slider-label" title={WEIGHT_HINTS[k]}>{k}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={form.weights[k]}
              onChange={e => setForm(f => ({ ...f, weights: rebalance(f.weights, k, Number(e.target.value)) }))}
            />
            <span className="slider-value">{form.weights[k]}%</span>
          </div>
        ))}
      </div>

      <div className="run-field">
        <label>
          Max turns / platform <span className="hint">how long discovery browses each platform</span>
        </label>
        <div className="slider-row no-label">
          <input
            type="range"
            min={10}
            max={200}
            step={5}
            value={form.maxTurns}
            onChange={e => setForm(f => ({ ...f, maxTurns: Number(e.target.value) }))}
          />
          <span className="slider-value">{form.maxTurns} turns</span>
        </div>
      </div>

      <div className="run-field">
        <label>
          Engagement ratio <span className="hint">community conversation vs. product-relevant threads</span>
        </label>
        <div className="slider-row no-label">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={form.engagementRatio}
            onChange={e => setForm(f => ({ ...f, engagementRatio: Number(e.target.value) }))}
          />
          <span className="slider-value">{communityPct}% community · {100 - communityPct}% product</span>
        </div>
      </div>

      <div className="run-field">
        <label>
          Dry Run Posts{' '}
          <span className="hint">
            "Post &amp; Submit" only pre-fills the reply in the browser — submit is never
            clicked for you. The reply is still marked posted; you press the button yourself.
          </span>
        </label>
        <button
          type="button"
          role="switch"
          aria-checked={form.dryRunPosts}
          className={`switch${form.dryRunPosts ? ' on' : ''}`}
          onClick={() => setForm(f => ({ ...f, dryRunPosts: !f.dryRunPosts }))}
        >
          <span className="knob" />
        </button>
      </div>
    </section>
  );
}

function BrandEditForm({ b, onCancel, onSaved }: {
  b: BrandDetail;
  onCancel: () => void;
  onSaved: (b: BrandDetail) => void;
}) {
  const [f, setF] = useState({
    name: b.name,
    url: b.url,
    tagline: b.tagline,
    shortDescription: b.shortDescription,
    aboutBrand: b.aboutBrand,
    tags: b.tags.join(', '),
    projectPath: b.projectPath ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF(v => ({ ...v, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const saved = await patchBrand(b.id, {
        name: f.name.trim(),
        url: f.url.trim(),
        tagline: f.tagline.trim(),
        shortDescription: f.shortDescription,
        aboutBrand: f.aboutBrand,
        tags: f.tags.split(',').map(t => t.trim()).filter(Boolean),
        projectPath: f.projectPath.trim(),
      });
      onSaved(saved);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Bridge unreachable');
      setBusy(false);
    }
  };

  return (
    <form className="brand-edit" onSubmit={e => { e.preventDefault(); void save(); }}>
      <div>
        <label>Name</label>
        <input type="text" value={f.name} onChange={set('name')} />
      </div>
      <div>
        <label>URL</label>
        <input type="text" value={f.url} placeholder="https://…" onChange={set('url')} />
      </div>
      <div>
        <label>Tagline</label>
        <input type="text" value={f.tagline} onChange={set('tagline')} />
      </div>
      <div>
        <label>Tags <span className="muted">(comma-separated)</span></label>
        <input type="text" value={f.tags} onChange={set('tags')} />
      </div>
      <div>
        <label>Short description</label>
        <textarea rows={2} value={f.shortDescription} onChange={set('shortDescription')} />
      </div>
      <div>
        <label>About <span className="muted">(feeds the scoring brain)</span></label>
        <textarea rows={4} value={f.aboutBrand} onChange={set('aboutBrand')} />
      </div>
      <div>
        <label>Project folder <span className="muted">(optional — local path with logos/screenshots/docs, mined for directory submissions)</span></label>
        <input type="text" value={f.projectPath} placeholder="/absolute/path/to/project" onChange={set('projectPath')} />
      </div>
      {err && <p className="post-msg err">{err}</p>}
      <div className="brand-edit-actions">
        <button type="button" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="copy" type="submit" disabled={busy || !f.name.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function BrandCard({ b, onSaved }: { b: BrandDetail; onSaved: (b: BrandDetail) => void }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const detail = b.aboutBrand || b.shortDescription;

  const toggleActive = async () => {
    setBusy(true);
    setErr(null);
    try {
      onSaved(await patchBrand(b.id, { isActive: !b.isActive }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Bridge unreachable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`brand-card${b.isActive ? '' : ' inactive'}`}>
      <div className="brand-card-head">
        <span className="brand-card-name">{b.name}</span>
        {!editing && (
          <button className="ctx-toggle brand-edit-btn" onClick={() => setEditing(true)}>edit</button>
        )}
        <button
          type="button"
          role="switch"
          aria-checked={b.isActive}
          className={`switch${b.isActive ? ' on' : ''}`}
          title={b.isActive ? 'Active — discovery hunts for this brand' : 'Inactive — skipped by discovery'}
          disabled={busy || editing}
          onClick={() => void toggleActive()}
        >
          <span className="knob" />
        </button>
      </div>
      {editing ? (
        <BrandEditForm
          b={b}
          onCancel={() => setEditing(false)}
          onSaved={saved => { setEditing(false); onSaved(saved); }}
        />
      ) : (
        <>
          {b.tagline && <p className="brand-card-tagline">{b.tagline}</p>}
          {b.url && (
            <a className="brand-card-url" href={b.url} target="_blank" rel="noreferrer">{b.url}</a>
          )}
          {b.tags.length > 0 && (
            <div className="tag-row">
              {b.tags.map(t => <span key={t} className="tag">{t}</span>)}
            </div>
          )}
          {detail && (
            <>
              <button className="ctx-toggle detail-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}>
                {open ? '−' : '+'} details
              </button>
              {open && <p className="brand-card-about">{detail}</p>}
            </>
          )}
          {err && <p className="post-msg err">{err}</p>}
        </>
      )}
    </div>
  );
}

/**
 * Per-account brand assignment. The map is brandId -> [integrationId], and it
 * is many-to-many both ways: a brand can own several accounts, and one account
 * (e.g. a founder X account) can back several — or all — brands. No brands
 * toggled = "any brand": the account stays selectable everywhere.
 */
function ChannelBrandTable({
  channels,
  brands,
  channelMap,
  onChange,
}: {
  channels: PostizChannel[];
  brands: BrandDetail[];
  channelMap: Record<string, string[]>;
  onChange: (map: Record<string, string[]>) => void;
}) {
  const isOn = (channelId: string, brandId: string) =>
    (channelMap[brandId] ?? []).includes(channelId);

  const toggle = (channelId: string, brandId: string) => {
    const cur = channelMap[brandId] ?? [];
    const ids = cur.includes(channelId) ? cur.filter(id => id !== channelId) : [...cur, channelId];
    const next = { ...channelMap };
    if (ids.length) next[brandId] = ids;
    else delete next[brandId];
    onChange(next);
  };

  return (
    <div className="channel-brand-table">
      {channels.map(ch => {
        const unassigned = brands.every(b => !isOn(ch.id, b.id));
        return (
          <div key={ch.id} className="channel-brand-row">
            <span className="channel-brand-name">
              {ch.name} <span className="muted">({ch.identifier})</span>
            </span>
            <div className="chip-row">
              {brands.map(b => (
                <button
                  key={b.id}
                  type="button"
                  className={`chip${isOn(ch.id, b.id) ? ' on' : ''}`}
                  aria-pressed={isOn(ch.id, b.id)}
                  onClick={() => toggle(ch.id, b.id)}
                >
                  {b.name}
                </button>
              ))}
              {unassigned && <span className="muted chip-hint">any brand</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Postiz connection (Content Strategy). The API key is write-only: submitted
 * once on connect, validated by listing channels, never echoed back.
 */
function PostizSection({ initial, brands }: { initial: PostizStatus; brands: BrandDetail[] }) {
  const [status, setStatus] = useState<PostizStatus>(initial);
  const [channels, setChannels] = useState<PostizChannel[] | null>(null);
  const [mapMsg, setMapMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status.connected) getPostizChannels().then(setChannels).catch(() => setChannels([]));
  }, [status.connected]);

  const saveMap = async (channelMap: Record<string, string[]>) => {
    const prev = status.channelMap;
    setStatus(s => ({ ...s, channelMap }));
    try {
      await savePostizChannelMap(channelMap);
      setMapMsg('Saved');
    } catch {
      setStatus(s => ({ ...s, channelMap: prev }));
      setMapMsg('Save failed — is the bridge running?');
    }
  };
  const [apiKey, setApiKey] = useState('');
  const [apiUrl, setApiUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const connect = async () => {
    if (!apiKey.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await connectPostiz(apiKey.trim(), apiUrl.trim() || undefined);
      setStatus(s => ({ ...s, connected: true, apiUrl: r.apiUrl }));
      setApiKey('');
      setMsg({ text: `Connected — ${r.channels.length} channel${r.channels.length === 1 ? '' : 's'} found`, ok: true });
    } catch (err) {
      setMsg({
        text: err instanceof ApiError ? `Couldn't connect: ${err.message}` : 'Bridge unreachable',
        ok: false,
      });
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await disconnectPostiz();
      setStatus(s => ({ ...s, connected: false }));
    } catch {
      setMsg({ text: 'Bridge unreachable', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-block">
      <h3>Postiz — content scheduling</h3>
      <p className="view-note">
        Opt-in: original posts you schedule from the Content Strategy tab go through
        your own Postiz account (cloud or self-hosted). Nothing is sent anywhere until
        you connect a key. Don't have Postiz?{' '}
        <a href={POSTIZ_REFERRAL_URL} target="_blank" rel="noreferrer">Get an API key</a>{' '}
        or self-host it.
      </p>
      {status.connected ? (
        <>
          <dl className="kv">
            <dt>Status</dt>
            <dd>Connected · {status.apiUrl}</dd>
            <dt />
            <dd><button className="copy" disabled={busy} onClick={disconnect}>Disconnect</button></dd>
          </dl>
          <h4 className="channel-brand-head">
            Accounts → brands
            {mapMsg && <span className="pro-hint"> {mapMsg}</span>}
          </h4>
          <p className="view-note">
            Toggle which brands each account posts for — an account can back one brand,
            several, or all of them (e.g. a founder account early on). New posts for a
            brand preselect its accounts (including posts submitted by your producer
            agents); accounts with no brands toggled stay selectable everywhere.
          </p>
          {channels === null ? (
            <p className="muted">Loading accounts…</p>
          ) : channels.length === 0 ? (
            <p className="muted">No accounts connected in Postiz yet — add some there first.</p>
          ) : (
            <ChannelBrandTable
              channels={channels}
              brands={brands}
              channelMap={status.channelMap}
              onChange={saveMap}
            />
          )}
        </>
      ) : (
        <form
          className="postiz-connect"
          onSubmit={e => { e.preventDefault(); void connect(); }}
        >
          <input
            type="password"
            value={apiKey}
            placeholder="Postiz API key"
            onChange={e => setApiKey(e.target.value)}
          />
          <button className="copy" type="submit" disabled={busy || !apiKey.trim()}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
          <button
            className="advanced-toggle"
            type="button"
            onClick={() => setShowAdvanced(s => !s)}
          >
            {showAdvanced ? '▾' : '▸'} Advanced
          </button>
          {showAdvanced && (
            <div className="postiz-advanced">
              <p className="view-note">
                Have your own self-hosted Postiz server? You can enter a URL to it here:
              </p>
              <input
                type="text"
                value={apiUrl}
                placeholder="https://your-postiz-server.example.com/api"
                onChange={e => setApiUrl(e.target.value)}
              />
            </div>
          )}
        </form>
      )}
      {msg && <p className={msg.ok ? 'post-msg ok' : 'post-msg err'}>{msg.text}</p>}
    </section>
  );
}

function DirectorySignupSection({ initial }: { initial: DirectorySettings }) {
  const [saved, setSaved] = useState<DirectorySettings>(initial);
  const [email, setEmail] = useState(initial.signupEmail);
  const [webmail, setWebmail] = useState(initial.webmailUrl);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const dirty = email.trim() !== saved.signupEmail || webmail.trim() !== saved.webmailUrl;

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveDirectorySettings({ signupEmail: email.trim(), webmailUrl: webmail.trim() });
      setSaved(r);
      setEmail(r.signupEmail);
      setWebmail(r.webmailUrl);
      setMsg({ text: 'Saved.', ok: true });
    } catch (e) {
      setMsg({ text: e instanceof ApiError ? e.message : 'Could not save.', ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="settings-block">
      <h3>Directory signups <span className="badge badge-pro">Pro</span></h3>
      <p className="view-note">
        When <code>/socialcue-submit</code> hits a directory that needs an account, it signs
        up as <em>you</em>: one click on "Continue with Google" where the site offers it,
        otherwise an email signup on this address. It reads the verification email by
        opening your webmail in a second tab of the Social Cue Chrome. So sign into this
        inbox <strong>and</strong> your Google account in that Chrome window once. Social Cue
        never stores your email password, only the address.
      </p>
      <form
        className="postiz-connect"
        onSubmit={e => { e.preventDefault(); void save(); }}
      >
        <input
          type="email"
          value={email}
          placeholder="you@example.com"
          onChange={e => setEmail(e.target.value)}
        />
        <input
          type="url"
          value={webmail}
          placeholder={saved.effectiveWebmailUrl ? `webmail URL (auto: ${saved.effectiveWebmailUrl})` : 'webmail URL (e.g. https://mail.google.com)'}
          onChange={e => setWebmail(e.target.value)}
        />
        <button className="copy" type="submit" disabled={busy || !dirty}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </form>
      {saved.signupEmail && (
        <p className="muted">
          Agent will open{' '}
          {saved.effectiveWebmailUrl
            ? <a href={saved.effectiveWebmailUrl} target="_blank" rel="noreferrer">{saved.effectiveWebmailUrl}</a>
            : <em>unknown provider - set the webmail URL above</em>}
          {' '}for verification mail.
        </p>
      )}
      {msg && <p className={msg.ok ? 'post-msg ok' : 'post-msg err'}>{msg.text}</p>}
    </section>
  );
}

export function SettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getSettings().then(setSettings).catch(() => setError(true));
  }, []);

  if (error) return <div className="empty">Couldn't load settings.</div>;
  if (!settings) return <div className="empty">Loading…</div>;

  const active = settings.brands.filter(b => b.isActive).length;

  return (
    <div className="settings">
      <RunSetupSection settings={settings} />

      <PostizSection
        initial={settings.postiz ?? { connected: false, apiUrl: '', channelMap: {} }}
        brands={settings.brands}
      />

      <DirectorySignupSection
        initial={settings.directories ?? { signupEmail: '', webmailUrl: '', effectiveWebmailUrl: '' }}
      />

      <DeveloperSection />

      <section className="settings-block">
        <h3>Brands <span className="muted">({active} active / {settings.brands.length} total)</span></h3>
        <p className="view-note">
          Toggle a brand off to skip it on the next run, or edit its profile in place —
          the profile text feeds the scoring brain. Adding or removing brands stays
          with <code>/socialcue-setup</code> (new brands get a guided profile draft).
        </p>
        {settings.brands.length === 0 ? (
          <p className="muted">No brands yet — run <code>/socialcue-setup</code> to add one.</p>
        ) : (
          <div className="brand-grid">
            {settings.brands.map(b => (
              <BrandCard
                key={b.id}
                b={b}
                onSaved={saved =>
                  setSettings(s => s && ({
                    ...s,
                    brands: s.brands.map(x => (x.id === saved.id ? saved : x)),
                  }))
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}


/**
 * Maintainer-only (the bridge reports canPreviewFree when venues.adminKey is
 * set): flip the whole install to the free tier to test what free users see.
 * Reloads the dashboard so every Pro-gated surface re-evaluates.
 */
function DeveloperSection() {
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLicense().then(setLicense).catch(() => setLicense(null));
  }, []);

  if (!license?.canPreviewFree) return null;
  const on = license.previewFree === true;

  const toggle = async () => {
    setBusy(true);
    try {
      await setPreviewFree(!on);
      window.location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <section className="settings-block">
      <h3>Developer <span className="muted">(maintainer machine)</span></h3>
      <p className="view-note">
        Preview the <strong>free tier</strong> without touching your subscription: while on,
        <code>isPro()</code> answers false everywhere on this machine — CLI, bridge, venue
        sync, dashboard — so you see exactly what a free install sees. Your Pro key
        {license.email ? <> for <code>{license.email}</code></> : null} stays valid; admin
        pushes to the venue playbook keep working (they key off the admin key, not Pro).
      </p>
      <p>
        <button className="copy" type="button" onClick={() => void toggle()} disabled={busy}>
          {busy ? 'Switching…' : on ? 'Back to Pro' : 'Preview as free'}
        </button>
        {on && <span className="badge" style={{ marginLeft: 8 }}>Free preview ON</span>}
      </p>
    </section>
  );
}
