import { useState } from 'react';
import { ApiError, activateLicense, connectLicense } from '../api';
import type { LicenseInfo } from '../types';

interface Props {
  license: LicenseInfo;
  onActivated: (info: LicenseInfo) => void;
  onClose: () => void;
}

/** Topbar popover: shows Pro status or takes an account token / license key. */
export function LicensePanel({ license, onActivated, onClose }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // An account token (scacct_…) is the normal path — it fetches a fresh key and
  // keeps auto-renewing. A raw SC1-… key is still accepted for manual/dev use.
  const submit = async () => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    setError(null);
    try {
      const info = v.startsWith('scacct_') ? await connectLicense(v) : await activateLicense(v);
      onActivated(info);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'bridge unreachable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="license-panel">
      <header>
        <h3>License</h3>
        <button className="copy" onClick={onClose}>✕</button>
      </header>
      {license.pro ? (
        <p>
          <span className="badge badge-pro">Pro</span> Licensed to {license.email}
          {license.expires ? ` · renews through ${license.expires}` : ''}.
        </p>
      ) : (
        <>
          <p>
            Free tier: the unified queue, drafts and statuses. <strong>Pro</strong> adds
            assisted posting — one click opens the thread in your browser with the
            draft pre-filled; click submit yourself, or have it clicked for you.
          </p>
          {license.expired && (
            <p className="error">Your Pro key expired — paste your account token to reconnect.</p>
          )}
          <form
            onSubmit={e => {
              e.preventDefault();
              void submit();
            }}
          >
            <input
              type="password"
              value={value}
              placeholder="scacct_… account token"
              onChange={e => setValue(e.target.value)}
            />
            <button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
          </form>
          <p className="hint">
            From your Pro welcome email. Lost it? Recover it at trysocialcue.com/account.
          </p>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}
