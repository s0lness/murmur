import type { PrivateIntent } from "../core/intent";

/**
 * A fuzzy middle rung between the naive keyword control (token-set Jaccard) and
 * the expensive semantic judge. Where keyword overlap sees "vélos" and "velo" as
 * two unrelated tokens (Jaccard 0), this compares CHARACTER bigrams over the
 * normalized, diacritic-stripped tag text, so morphological / spelling / spacing
 * variants ("iphone 13" vs "iphone13", "sofa" vs "sofá") still score.
 *
 * It is a separate matcher, not a change to keywordMatcher.ts: that one is the
 * measured control in the spike/sim benchmarks and must stay naive. Use this to
 * widen a cheap PREFILTER's recall (see server/commons.ts) so a lexically-variant
 * but genuinely relevant candidate survives to the semantic judge, which still
 * does the real filtering.
 */

/** Lowercase, strip diacritics, collapse everything non-alphanumeric to spaces. */
export function normalize(tags: string[]): string {
  return tags
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const compact = s.replace(/ /g, ""); // bigrams over letters, so word boundaries don't dominate
  for (let i = 0; i < compact.length - 1; i++) {
    const g = compact.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** Sørensen-Dice coefficient over character bigrams of the tag text, 0..1. */
export function bigramScore(aTags: string[], bTags: string[]): number {
  const a = normalize(aTags);
  const b = normalize(bTags);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ba = bigrams(a);
  const bb = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const c of ba.values()) total += c;
  for (const [g, c] of bb) {
    total += c;
    overlap += Math.min(c, ba.get(g) ?? 0);
  }
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** Public tags only, mirroring keywordMatch: both operate on the blurred signal. */
export function bigramMatch(seek: PrivateIntent, offer: PrivateIntent, threshold: number): boolean {
  const a = seek.publicTags ?? seek.tags;
  const b = offer.publicTags ?? offer.tags;
  return bigramScore(a, b) >= threshold;
}
