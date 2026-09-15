/**
 * Auto-UTM tagging for links in scheduled posts (config.utmTagging, default on).
 *
 * Only links to the user's own brand sites are tagged — a post that links to
 * someone else's article must not carry our campaign params. Tags:
 *   utm_source   the Postiz channel's platform (threads, tiktok, youtube, x, …)
 *   utm_medium   "social"
 *   utm_campaign the brand id of the content item (one campaign per product)
 *   utm_content  the content item id, so a visit maps back to this exact post
 * Links that already carry any utm_* param are left exactly as written.
 *
 * Pure text → text; applied only in the Postiz payload, never to the stored
 * body, so drafts stay clean and editable.
 */
import { normalizePlatform } from './goals.js';

export const UTM_MEDIUM = 'social';

/** Hostnames (without www.) of the user's own product sites, from every brand. */
export function ownHostsFromBrands(brands = []) {
  const hosts = new Set();
  for (const b of brands) {
    for (const u of [b?.url, b?.pricingUrl]) {
      const h = hostOf(u);
      if (h) hosts.add(h);
    }
  }
  return hosts;
}

function hostOf(u) {
  if (!u || typeof u !== 'string') return '';
  try {
    return new URL(u).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** utm_source for a Postiz integration identifier ("instagram-standalone" → "instagram"). */
export function utmSourceFor(identifier) {
  return normalizePlatform(identifier) || 'postiz';
}

// A URL runs until whitespace or a quote/bracket; trailing sentence
// punctuation (and a closing paren/bracket, for markdown links) is not part of it.
const URL_RE = /https?:\/\/[^\s<>"'`]+/g;
const TRAILING_RE = /[)\].,;:!?]+$/;

/**
 * Append UTM params to every own-site link in `text`.
 * @param {string} text
 * @param {{ source: string, campaign: string, content: string, ownHosts: Set<string>, medium?: string }} opts
 */
export function tagLinks(text, { source, campaign, content, ownHosts, medium = UTM_MEDIUM }) {
  if (!text || !ownHosts?.size) return text ?? '';
  return String(text).replace(URL_RE, raw => {
    const trailing = raw.match(TRAILING_RE)?.[0] ?? '';
    const link = trailing ? raw.slice(0, -trailing.length) : raw;
    let url;
    try {
      url = new URL(link);
    } catch {
      return raw;
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!ownHosts.has(host)) return raw;
    for (const k of url.searchParams.keys()) if (k.startsWith('utm_')) return raw;
    url.searchParams.set('utm_source', source);
    url.searchParams.set('utm_medium', medium);
    if (campaign) url.searchParams.set('utm_campaign', campaign);
    if (content) url.searchParams.set('utm_content', content);
    return url.toString() + trailing;
  });
}
