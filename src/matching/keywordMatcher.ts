import type { PrivateIntent } from "../core/intent";

/**
 * The baseline: what a naive keyword marketplace does - tokenize the listings,
 * match on word overlap, ignore meaning. No model, no understanding. This is the
 * control we measure murmur's semantic matcher against. It sees the *same blurred
 * signals* - only its matching logic differs.
 */
export function tokenize(tags: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of tags) {
    for (const w of t.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length > 1) out.add(w);
    }
  }
  return out;
}

export function keywordScore(aTags: string[], bTags: string[]): number {
  const a = tokenize(aTags);
  const b = tokenize(bTags);
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

/** Public tags only - both matchers operate on the blurred signal, never private fields. */
export function keywordMatch(seek: PrivateIntent, offer: PrivateIntent, threshold: number): boolean {
  const a = seek.publicTags ?? seek.tags;
  const b = offer.publicTags ?? offer.tags;
  return keywordScore(a, b) >= threshold;
}
