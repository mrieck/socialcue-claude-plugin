#!/usr/bin/env node
/**
 * Social Cue license keygen (seller-side tool — buyers never run this).
 *
 *   node scripts/license-keygen.js --init
 *     Generate an Ed25519 keypair. Prints the private key PEM (store it OUTSIDE
 *     the repo, e.g. ~/.socialcue-license-key.pem, and back it up) and the
 *     public key PEM to paste into lib/license.js.
 *
 *   SOCIALCUE_LICENSE_PRIVATE_KEY=~/.socialcue-license-key.pem \
 *     node scripts/license-keygen.js --email buyer@example.com [--days 35]
 *     Sign a Pro key and print it. With --days it includes an `expires` date
 *     (matching the production payload); without it the key never expires
 *     (handy for local dev).
 *
 * Committing this script is fine — all the security lives in the private key.
 * In production the licensing site (../socialcue-website) is the signer and
 * delivers short-lived keys automatically; this stays for offline/dev signing.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? true);
};

function die(msg) { console.error(msg); process.exit(1); }

if (flag('init')) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  console.log('# Private key — save OUTSIDE the repo (e.g. ~/.socialcue-license-key.pem, chmod 600) and BACK IT UP:');
  console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  console.log('# Public key — paste into PUBLIC_KEY_PEM in lib/license.js:');
  console.log(publicKey.export({ type: 'spki', format: 'pem' }));
  process.exit(0);
}

const email = flag('email');
if (!email || email === true) die('Usage: license-keygen.js --init | --email <buyer@example.com>');

const keyEnv = process.env.SOCIALCUE_LICENSE_PRIVATE_KEY
  || path.join(os.homedir(), '.socialcue-license-key.pem');
const keyPath = path.resolve(keyEnv.replace(/^~(?=$|\/)/, os.homedir()));
if (!fs.existsSync(keyPath)) {
  die(`No private key at ${keyPath} — run --init first, or set SOCIALCUE_LICENSE_PRIVATE_KEY.`);
}
// Never let the signing key live inside the repo tree (it would get committed).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!path.relative(repoRoot, keyPath).startsWith('..')) {
  die(`Refusing to use a private key inside the repo (${keyPath}) — move it outside, e.g. ~/.socialcue-license-key.pem.`);
}

const privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
const now = new Date();
const days = Number(flag('days'));
const payloadObj = {
  email,
  tier: 'pro',
  issued: now.toISOString().slice(0, 10),
};
if (Number.isFinite(days) && days > 0) {
  payloadObj.expires = new Date(now.getTime() + days * 864e5).toISOString().slice(0, 10);
}
const payload = Buffer.from(JSON.stringify(payloadObj));
const sig = crypto.sign(null, payload, privateKey);
console.log(`SC1-${payload.toString('base64url')}.${sig.toString('base64url')}`);
