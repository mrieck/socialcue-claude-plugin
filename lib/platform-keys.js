/**
 * Config platform keys ("reddit", "x", "hackernews") ↔ KNOWN_PLATFORMS domains.
 * Shared by the CLI brief, config handles and the activity log so the same
 * key always lands on the same descriptor.
 */
import { KNOWN_PLATFORMS } from '../vendor/shared/platforms.js';

export const PLATFORM_ALIASES = {
  reddit: 'reddit.com', twitter: 'x.com', x: 'x.com', linkedin: 'linkedin.com',
  facebook: 'facebook.com', instagram: 'instagram.com', youtube: 'youtube.com',
  hn: 'news.ycombinator.com', hackernews: 'news.ycombinator.com', producthunt: 'producthunt.com',
  indiehackers: 'indiehackers.com', threads: 'threads.com', mastodon: 'mastodon.social',
  bluesky: 'bsky.app', tiktok: 'tiktok.com', quora: 'quora.com', devto: 'dev.to',
};

// Domain → the canonical config key (first alias wins: x over twitter, hackernews over hn).
const CANONICAL_KEY = {};
for (const [key, domain] of Object.entries(PLATFORM_ALIASES)) {
  if (key === 'twitter' || key === 'hn') continue;
  if (!CANONICAL_KEY[domain]) CANONICAL_KEY[domain] = key;
}

/** Map a config platform key ("reddit") to a discovery platform descriptor. */
export function resolvePlatform(key) {
  const domain = key.includes('.') ? key : (PLATFORM_ALIASES[key.toLowerCase()] || `${key}.com`);
  const known = KNOWN_PLATFORMS[domain];
  if (known) {
    return { ...known, domain, key: canonicalKey(key), isKnown: true };
  }
  return {
    domain,
    key: key.toLowerCase(),
    name: key,
    homeUrl: `https://${domain}`,
    hints: ['Navigate to the homepage and explore', 'Find the search and community areas'],
    algorithmTips: [],
    isKnown: false,
  };
}

/** "twitter" → "x", "hn" → "hackernews", "reddit.com" → "reddit"; unknown keys pass through lowercased. */
export function canonicalKey(key) {
  const k = String(key ?? '').trim().toLowerCase();
  if (!k) return '';
  const domain = k.includes('.') ? k.replace(/^www\./, '') : PLATFORM_ALIASES[k];
  return (domain && CANONICAL_KEY[domain]) || k;
}

/** Config key for a KNOWN_PLATFORMS domain, or null when nothing maps to it. */
export function keyForDomain(domain) {
  const d = String(domain ?? '').toLowerCase().replace(/^www\./, '');
  if (d === 'twitter.com') return 'x';
  if (d === 'threads.net') return 'threads';
  if (d === 'ycombinator.com') return 'hackernews';
  return CANONICAL_KEY[d] ?? null;
}
