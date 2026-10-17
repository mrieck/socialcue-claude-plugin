/**
 * Voice guidance (`.socialdiscovery/voice-guidance.md`) — the user-editable
 * record of how draft replies should sound: distilled voice rules plus golden
 * before→after examples of the user's own rewrites. Lives on the config side
 * of the two-tier split (user truth, not generated state). Injected into every
 * discovery brief via buildVoiceGuidanceSection; curated by the review-notes
 * skill (cap examples ~10, fold old lessons into rules).
 *
 * Layout: `## Voice rules` (global), optional `## Brand: <name>` rule sections,
 * `## Golden examples` with one `### <date — platform — brand>` block each.
 * Examples always live under the single global heading — the label carries the
 * brand — so counting and insertion stay dumb string operations.
 */
import fs from 'node:fs';
import { voiceGuidancePath, ensureBaseDir } from './paths.js';

const SCAFFOLD = `# Voice guidance
<!-- Read at the start of every discovery run and given priority over the
     generic draft rules. Edit freely — this file is yours. The review-notes
     skill distills feedback into rules and promotes confirmed rewrites into
     golden examples (keep those to ~10; fold old lessons into rules).
     Brand-specific rules go in an optional "## Brand: <name>" section. -->

## Voice rules

## Golden examples
`;

export function guidanceExists() {
  return fs.existsSync(voiceGuidancePath());
}

/** Raw markdown, or '' when the file doesn't exist yet. */
export function loadGuidance() {
  if (!guidanceExists()) return '';
  return fs.readFileSync(voiceGuidancePath(), 'utf8');
}

/** Create the scaffold if missing. Returns { created, path }. */
export function ensureGuidance() {
  if (guidanceExists()) return { created: false, path: voiceGuidancePath() };
  ensureBaseDir();
  fs.writeFileSync(voiceGuidancePath(), SCAFFOLD);
  return { created: true, path: voiceGuidancePath() };
}

export function saveGuidance(markdown) {
  ensureBaseDir();
  fs.writeFileSync(voiceGuidancePath(), markdown.endsWith('\n') ? markdown : markdown + '\n');
}

/** Count golden-example blocks (### headings under the Golden examples heading). */
export function countExamples(markdown = loadGuidance()) {
  let count = 0;
  let inExamples = false;
  for (const line of markdown.split('\n')) {
    if (/^##\s(?!#)/.test(line)) inExamples = /^##\s+golden examples/i.test(line.trim());
    else if (inExamples && /^###\s/.test(line)) count++;
  }
  return count;
}

/**
 * Append a golden example (newest-first) under `## Golden examples`, creating
 * the file/heading as needed. Returns { path, examples }.
 */
export function appendExample({ brandName = '', platform = '', before = '', after = '', why = '' }) {
  ensureGuidance();
  let md = loadGuidance();

  const date = new Date().toISOString().slice(0, 10);
  const label = [date, platform, brandName].filter(Boolean).join(' — ');
  const block = [
    `### ${label}`,
    `**Before:** ${String(before).trim() || '(none)'}`,
    `**After:** ${String(after).trim()}`,
    ...(String(why).trim() ? [`**Why:** ${String(why).trim()}`] : []),
  ].join('\n');

  const lines = md.split('\n');
  const idx = lines.findIndex(l => /^##\s+golden examples/i.test(l.trim()));
  if (idx === -1) {
    md = md.trimEnd() + '\n\n## Golden examples\n\n' + block + '\n';
  } else {
    lines.splice(idx + 1, 0, '', block);
    md = lines.join('\n');
  }

  saveGuidance(md);
  return { path: voiceGuidancePath(), examples: countExamples(md) };
}
