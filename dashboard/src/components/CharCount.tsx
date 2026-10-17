import type { PostizChannel } from '../types';

/** Per-platform caption caps (Postiz rejects over-length posts at schedule time). */
const LIMITS: Record<string, CharLimit> = {
  x: { max: 280, label: 'X' },
  bluesky: { max: 300, label: 'Bluesky' },
  threads: { max: 500, label: 'Threads' },
  mastodon: { max: 500, label: 'Mastodon' },
  pinterest: { max: 500, label: 'Pinterest' },
  instagram: { max: 2200, label: 'Instagram' },
  'instagram-standalone': { max: 2200, label: 'Instagram' },
  tiktok: { max: 2200, label: 'TikTok' },
  linkedin: { max: 3000, label: 'LinkedIn' },
  'linkedin-page': { max: 3000, label: 'LinkedIn' },
};

export interface CharLimit { max: number; label: string }

/**
 * Tightest cap among the selected channels that will post the shared body
 * (channels with their own variant caption are skipped). Null when none apply.
 */
export function limitFor(
  selected: string[],
  channels: PostizChannel[] | null,
  variants?: Record<string, { content?: string }>,
): CharLimit | null {
  let best: CharLimit | null = null;
  for (const id of selected) {
    if (variants?.[id]?.content?.trim()) continue;
    const ch = channels?.find(c => c.id === id);
    const lim = ch ? LIMITS[ch.identifier] : undefined;
    if (lim && (!best || lim.max < best.max)) best = lim;
  }
  return best;
}

/** "349" or "349 / 280 · X", red once over the cap. */
export function CharCount({ text, limit }: { text: string; limit: CharLimit | null }) {
  const n = text.length;
  const over = limit != null && n > limit.max;
  return (
    <span
      className={`char-count${over ? ' over' : ''}`}
      title={limit ? `${limit.label} allows ${limit.max} characters` : 'Characters'}
    >
      {n}{limit && <> / {limit.max} · {limit.label}</>}
    </span>
  );
}
