/**
 * Destination-account credentials store — generated logins for accounts the
 * product-post flow creates on directories, launch sites, communities, forums.
 *
 * A separate 0600 JSON file (`.socialdiscovery/submission-credentials.json`),
 * deliberately NOT SQLite: the bridge serves db rows, and keeping passwords
 * out of the db means no bridge query can ever leak one. Plaintext-at-rest is
 * a documented tradeoff matching the product's existing local-secret threat
 * model (bridge token, Postiz key in config.json); an OS-keychain backend is
 * a possible later upgrade. Nothing here is ever returned by a bridge
 * endpoint — the only reader besides the submission flow is the local
 * `post creds <id>` CLI command.
 *
 * Keys are `${credKey}:${destinationId}` (see credentialKeyFor) so a re-post
 * to the same destination reuses the existing account instead of registering
 * again. For a directory/launch listing the credKey is the subject key
 * (`brand:<id>` etc.); for communities and forums it is `user` — one Reddit or
 * Indie Hackers account posts many things. Legacy `${brandId}:${destinationId}`
 * keys from the directory-submission era are still read.
 */
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { credentialsPath, ensureBaseDir } from './paths.js';

function loadAll() {
  const p = credentialsPath();
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveAll(store) {
  ensureBaseDir();
  const p = credentialsPath();
  fs.writeFileSync(p, JSON.stringify(store, null, 2) + '\n', { mode: 0o600 });
  // writeFileSync's mode only applies on create; re-assert on every save.
  fs.chmodSync(p, 0o600);
}

const keyFor = (credKey, destinationId) => `${credKey}:${destinationId}`;

/**
 * Which credential bucket a post uses on a destination. Communities and
 * forums are per-user accounts; listings are per-subject.
 */
export function credentialKeyFor(subjectKey, destination) {
  const kind = destination?.kind ?? 'directory';
  return kind === 'community' || kind === 'forum' ? 'user' : String(subjectKey);
}

/** Legacy key for brand subjects (`<brandId>:<destinationId>`), else null. */
function legacyKey(credKey, destinationId) {
  const m = /^brand:(.+)$/.exec(String(credKey));
  return m ? `${m[1]}:${destinationId}` : null;
}

/**
 * A password that clears typical directory signup rules (length, upper/lower,
 * digit, symbol) without ambiguous characters.
 */
export function generatePassword(length = 20) {
  const classes = [
    'abcdefghjkmnpqrstuvwxyz',
    'ABCDEFGHJKLMNPQRSTUVWXYZ',
    '23456789',
    '!#$%&*+-=',
  ];
  const all = classes.join('');
  const bytes = randomBytes(length);
  // One char from each class up front (guarantees every rule), rest from the
  // full alphabet. Directory forms don't care about prefix patterns.
  let pw = classes.map((c, i) => c[bytes[i] % c.length]).join('');
  for (let i = classes.length; i < length; i++) pw += all[bytes[i] % all.length];
  return pw;
}

export function getCredentials(credKey, destinationId) {
  const store = loadAll();
  const legacy = legacyKey(credKey, destinationId);
  return store[keyFor(credKey, destinationId)] ?? (legacy ? store[legacy] : null) ?? null;
}

/**
 * Existing credentials for this credKey+destination, or freshly generated ones
 * (persisted). `email` is required on first call.
 */
export function ensureCredentials(credKey, destinationId, { email, username } = {}) {
  const store = loadAll();
  const key = keyFor(credKey, destinationId);
  if (store[key]) return store[key];
  const legacy = legacyKey(credKey, destinationId);
  if (legacy && store[legacy]) return store[legacy];
  if (!email) throw new Error('ensureCredentials: email required to create credentials');
  store[key] = {
    email,
    password: generatePassword(),
    ...(username ? { username } : {}),
    createdAt: new Date().toISOString(),
  };
  saveAll(store);
  return store[key];
}

export function deleteCredentials(credKey, destinationId) {
  const store = loadAll();
  const key = keyFor(credKey, destinationId);
  if (!(key in store)) return false;
  delete store[key];
  saveAll(store);
  return true;
}
