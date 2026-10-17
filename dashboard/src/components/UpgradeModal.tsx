import { useEffect, useState } from 'react';
import { ApiError, activateLicense, connectLicense } from '../api';
import type { LicenseInfo } from '../types';

// Stable marketing URL on purpose (dist is committed and ships in a plugin
// cache for months) — /pricing survives checkout-provider changes.
export const UPGRADE_URL = 'https://trysocialcue.com/pricing?ref=dashboard';
export const ACCOUNT_URL = 'https://trysocialcue.com/account';

interface Props {
  license: LicenseInfo;
  onActivated: (info: LicenseInfo) => void;
  onClose: () => void;
}

/** Upgrade/license modal: sells Pro to free users (with the token form at the
 *  bottom), or shows license status once activated. Opened from the topbar
 *  License button and from the gated Post & Submit button. */
export function UpgradeModal({ license, onActivated, onClose }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'bridge unreachable');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={license.pro ? 'License' : 'Upgrade to Pro'}
        onClick={e => e.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{license.pro ? 'License' : 'Post replies in one click'}</h2>
          <button className="copy" onClick={onClose} aria-label="Close">✕</button>
        </header>
        {license.pro ? (
          <p className="upgrade-sub">
            <span className="badge badge-pro">Pro</span> Licensed to {license.email}
            {license.expires ? ` · renews through ${license.expires}` : ''}.
          </p>
        ) : (
          <>
            <p className="upgrade-sub">
              Social Cue Pro turns your approved drafts into posted replies, then
              tracks how each one performs.
            </p>
            <ul className="upgrade-benefits">
              <li>
                Assisted posting: one click opens the thread in your browser with the
                draft pre-filled. Click submit yourself, or have it clicked for you.
              </li>
              <li>
                Reply performance tracking: upvotes and replies on everything you
                post, checked automatically on each discovery run.
              </li>
              <li>
                Runs on the Claude subscription you already have. No extra AI costs,
                no per-post fees.
              </li>
            </ul>
            <a className="upgrade-cta" href={UPGRADE_URL} target="_blank" rel="noreferrer">
              Get Pro - $19/mo
            </a>
            <p className="upgrade-price">14-day money-back guarantee. Cancel anytime.</p>
            <div className="upgrade-divider" />
            <p className="upgrade-have">Already have a license? Enter it here:</p>
            {license.expired && (
              <p className="error">Your Pro key expired - paste your account token to reconnect.</p>
            )}
            <form
              className="license-form"
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
            <p className="upgrade-hint">
              Your account token is in your Pro welcome email. Lost it? Recover it at{' '}
              <a href={ACCOUNT_URL} target="_blank" rel="noreferrer">trysocialcue.com/account</a>.
            </p>
            {error && <p className="error">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
