/**
 * Non-discriminative tokens that must NOT drive a match. The distiller often
 * emits condition / quality / quantity adjectives as tags ("used", "free",
 * "set-of-3"); without this filter a yoga mat and an iPad "match" on `used` and
 * a bulk seller (qty>1) sprays that false positive across the whole pool.
 * Keep this list to genuinely generic words - never item or brand names, and
 * never sizes ("56cm", "size-6") which ARE discriminative.
 */
export const STOPWORDS = new Set([
  // condition / quality
  "used", "new", "brand-new", "barely-used", "nearly-new", "secondhand", "second-hand",
  "preowned", "pre-owned", "refurbished", "vintage", "retro", "mint", "immaculate",
  "pristine", "clean", "working", "works", "functional", "good", "great", "decent",
  "nice", "quality", "fair", "old", "broken", "spare", "unused", "unopened", "sealed",
  // price / availability
  "free", "cheap", "bargain", "cash", "ono", "negotiable", "collection-only", "collection",
  "pickup", "pick-up", "delivered",
  // quantity / packaging
  "set", "set-of-2", "set-of-3", "set-of-4", "pair", "pairs", "bundle", "lot", "job-lot",
  "bulk", "batch", "box", "boxes", "stack", "loads", "assorted", "various", "misc",
  "miscellaneous", "multiple", "several", "collection-of",
  // vague qualifiers
  "any", "some", "thing", "things", "stuff", "item", "items", "etc", "ideally", "around",
  "approx", "about", "small", "large", "big", "medium",
]);

/** Drop stopwords from a token list (case-insensitive); keeps everything else. */
export const discriminative = (tokens: string[]): string[] =>
  tokens.filter((t) => t && !STOPWORDS.has(t.toLowerCase()));
