/**
 * Directory-account credentials store — generated logins for accounts the
 * submission flow creates on directory sites.
 *
 * A separate 0600 JSON file (`.socialdiscovery/submission-credentials.json`),
 * deliberately NOT SQLite: the bridge serves db rows, and keeping passwords
 * out of the db means no bridge query can ever leak one. Plaintext-at-rest is
 * a documented tradeoff matching the product's existing local-secret threat
 * model (bridge token, Postiz key in config.json); an OS-keychain backend is
 * a possible later upgrade. Nothing here is ever returned by a bridge
 * endpoint — the only reader besides the submission flow is the local
 * `submission creds <id>` CLI command.
 *
 * Keys are `${brandId}:${directoryId}` so a re-submission to the same
 * directory reuses the existing account instead of registering again.
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

const keyFor = (brandId, directoryId) => `${brandId}:${directoryId}`;

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

export function getCredentials(brandId, directoryId) {
  return loadAll()[keyFor(brandId, directoryId)] ?? null;
}

/**
 * Existing credentials for this brand+directory, or freshly generated ones
 * (persisted). `email` is required on first call.
 */
export function ensureCredentials(brandId, directoryId, { email, username } = {}) {
  const store = loadAll();
  const key = keyFor(brandId, directoryId);
  if (store[key]) return store[key];
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

export function deleteCredentials(brandId, directoryId) {
  const store = loadAll();
  const key = keyFor(brandId, directoryId);
  if (!(key in store)) return false;
  delete store[key];
  saveAll(store);
  return true;
}
