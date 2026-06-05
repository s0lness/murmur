import type { PrivateIntent } from "../core/intent";

/**
 * Vague-intent enrichment gate (ported, in spirit, from Index Network's
 * enrich-then-recheck loop). Their pipeline scores a "felicity" triplet and a
 * "semantic entropy" via an LLM, then, if an intent reads vague, re-injects the
 * user's profile and re-verifies, keeping the result only if it became clearer.
 *
 * murmur has no separate scoring agent - the distiller already emits a single
 * `confidence`. So the one genuinely useful piece is: when a fresh active intent
 * is low-confidence, try ONE sharpening pass against the user's standing context
 * (their other wants = their de-facto profile), and keep it only if it improved.
 * These two predicates are the whole gate; the LLM call lives in the distiller.
 */

/** Default confidence below which an active intent is worth a sharpening pass. */
export const ENRICH_THRESHOLD = 0.5;

/** Only spend an enrichment call on intents that will actually broadcast and
 *  read as under-specified. Held (active:false) and confident intents are left
 *  alone - enriching them buys nothing and just burns tokens. */
export function needsEnrich(i: PrivateIntent, threshold = ENRICH_THRESHOLD): boolean {
  if (i.active === false) return false;
  return (i.confidence ?? 1) < threshold;
}

/** Cheap proxy for "how constrained is this intent" - the murmur analogue of
 *  Index Network's inverse semantic-entropy. More tags / substitutes, a real
 *  region, and a stated price all make an intent easier to route. */
function specificity(i: PrivateIntent): number {
  return (
    (i.tags?.length ?? 0) +
    (i.substitutes?.length ?? 0) +
    (i.region && i.region !== "*" ? 1 : 0) +
    (i.valuation != null ? 1 : 0)
  );
}

/**
 * Keep the enriched candidate only if it genuinely sharpened the original
 * (their `becameClear` gate). A confidence bump wins outright; a confidence drop
 * of any note rejects (enrichment must never make an intent worse); on a tie we
 * prefer the more-constrained version.
 */
export function clearer(original: PrivateIntent, candidate: PrivateIntent): boolean {
  const dConf = (candidate.confidence ?? 0) - (original.confidence ?? 0);
  if (dConf > 0.001) return true;
  if (dConf < -0.05) return false;
  return specificity(candidate) > specificity(original);
}
