/**
 * Webmail URL derivation for the directory-signup email — pure, no I/O.
 *
 * The user signs into their own mailbox inside the dedicated Social Cue
 * Chrome; the driving agent opens that webmail in a second tab to read
 * verification codes/links. This maps a mail address to the webmail URL the
 * agent should open. Unknown providers return '' (the user sets
 * config.directories.webmailUrl, e.g. Google Workspace on a custom domain ->
 * https://mail.google.com).
 */

const PROVIDERS = [
  [['gmail.com', 'googlemail.com'], 'https://mail.google.com'],
  [['proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me'], 'https://mail.proton.me'],
  [['outlook.com', 'hotmail.com', 'live.com', 'msn.com'], 'https://outlook.live.com/mail'],
  [['yahoo.com', 'ymail.com', 'rocketmail.com'], 'https://mail.yahoo.com'],
  [['icloud.com', 'me.com', 'mac.com'], 'https://www.icloud.com/mail'],
  [['fastmail.com', 'fastmail.fm'], 'https://app.fastmail.com'],
  [['hey.com'], 'https://app.hey.com'],
  [['zoho.com', 'zohomail.com'], 'https://mail.zoho.com'],
  [['aol.com'], 'https://mail.aol.com'],
  [['gmx.com', 'gmx.net', 'gmx.de'], 'https://www.gmx.com'],
  [['tutanota.com', 'tuta.com', 'tuta.io'], 'https://app.tuta.com'],
];

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Domain part of an address, lowercased; '' if it isn't an address. */
export function emailDomain(email) {
  const m = String(email || '').trim().toLowerCase().match(/^[^@\s]+@([^@\s]+\.[^@\s]+)$/);
  return m ? m[1] : '';
}

/**
 * The webmail URL to open for `email`. `override` (config.directories.webmailUrl)
 * wins when set; otherwise the provider table; otherwise ''.
 */
export function webmailUrlFor(email, override = '') {
  if (override && String(override).trim()) return String(override).trim();
  const domain = emailDomain(email);
  if (!domain) return '';
  for (const [domains, url] of PROVIDERS) {
    if (domains.includes(domain)) return url;
  }
  return '';
}
