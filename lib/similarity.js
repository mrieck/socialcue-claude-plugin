/**
 * Near-duplicate check for resay drafts: Reddit, LinkedIn and Quora flag the
 * same comment pasted into several threads. Word-trigram Jaccard is enough.
 */
const grams = (text) => {
  const w = String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').match(/[a-z0-9']+/g) || [];
  const out = new Set();
  for (let i = 0; i + 2 < w.length; i++) out.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
  return out;
};

export function similarity(a, b) {
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** The closest earlier text at or above `threshold`, or null. */
export function closestMatch(text, others, threshold = 0.35) {
  let best = null;
  for (const o of others) {
    const score = similarity(text, o.text);
    if (score >= threshold && (!best || score > best.score)) best = { ...o, score: Math.round(score * 100) / 100 };
  }
  return best;
}
