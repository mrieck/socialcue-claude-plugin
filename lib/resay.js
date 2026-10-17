/**
 * Resay: things the user already said (Content Library items, their own posts
 * and good comments, live product posts) that discovery places in new threads.
 * Sources come from the suggest digest; the answer bank (resay_sources) adds
 * the question each one answers, written once by the /socialdiscovery orchestrator.
 */
import fs from 'node:fs';
import * as db from './db.js';
import { buildSuggestBrief } from './suggest.js';
import { buildResaySection, buildOwnWritingSection } from '../vendor/shared/prompts.js';

const linkOf = s => s.releaseUrl || s.url || s.listingUrl || null;
const titleOf = s => s.title || s.subject || s.parentTitle || '';

/** Every resay source with its bank entry (if any). Newest content first. */
export async function resaySources(config, { days = 365 } = {}) {
  const brief = await buildSuggestBrief(config, { days, max: 60000 });
  return brief.sources.map(s => {
    const bank = db.getResaySource(s.key);
    return {
      ref: s.key,
      kind: s.kind,
      title: titleOf(s),
      excerpt: s.snippet || '',
      platform: s.platform || null,
      score: s.score ?? null,
      link: bank?.link || linkOf(s),
      covered: s.covered || [],
      question: bank?.question || null,
      points: bank?.points || [],
    };
  });
}

/** Sources with no answer-bank entry yet: the orchestrator writes question + points for these. */
export async function pendingResaySources(config, opts) {
  return (await resaySources(config, opts)).filter(s => !s.question);
}

/** Candidate threads from scouts: a JSON array of { url, sourceRef?, note? } (or { candidates: [...] }). */
export function readCandidates(file) {
  if (!file) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(data) ? data : data.candidates || [];
  return list.filter(c => c && typeof c.url === 'string' && !db.isUrlSeen(c.url));
}

/** The RESAY brief section; sources with a bank entry go first. */
export async function renderResaySection(config, { candidates = [], resayOnly = false } = {}) {
  const sources = (await resaySources(config)).sort((a, b) => Number(!!b.question) - Number(!!a.question));
  const section = buildResaySection(sources, { candidates });
  if (!section || !resayOnly) return section;
  return `${section}
**This run is resay only.** Collect only resay finds (kind "resay"). Skip fresh brand conversations.
`;
}

export function renderOwnWritingSection() {
  return buildOwnWritingSection(db.ownWritingSamples());
}

/** `--mode brand,resay` overrides config.discoveryModes for one run. */
export function runModes(config, flag) {
  const raw = flag ? String(flag).split(',') : config.discoveryModes || ['brand'];
  const modes = raw.map(m => m.trim()).filter(m => m === 'brand' || m === 'resay');
  return modes.length ? modes : ['brand'];
}
