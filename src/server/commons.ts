import type { Kind } from "../core/intent";
import { keywordScore } from "../matching/keywordMatcher";
import { SemanticMatcher } from "../matching/semanticMatcher";
import type { StoredIntent } from "./store";

const COMPLEMENT: Record<Kind, Kind> = { seek: "offer", offer: "seek", swap: "swap", barter: "barter" };
const matcher = new SemanticMatcher();

/** Only this many candidates ever reach the (expensive) LLM judge. */
const SHORTLIST = 15;

/**
 * Cheap structural prefilter — the "solver's first pass". Keeps candidates in
 * the same domain (the distiller's semantic bucket) or with any tag overlap,
 * then ranks and caps. This is what keeps semantic matching affordable as the
 * pool grows: the LLM only judges a shortlist, never the whole room.
 */
function prefilter(fresh: StoredIntent, candidates: StoredIntent[]): StoredIntent[] {
  const ftags = fresh.intent.publicTags ?? fresh.intent.tags;
  return candidates
    .map((c) => {
      const sameDomain = c.intent.domain === fresh.intent.domain;
      const overlap = keywordScore(ftags, c.intent.publicTags ?? c.intent.tags);
      return { c, keep: sameDomain || overlap > 0, rank: (sameDomain ? 1 : 0) + overlap };
    })
    .filter((x) => x.keep)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, SHORTLIST)
    .map((x) => x.c);
}

/**
 * Match a fresh intent against the live pool. Tiered: complement+active filter →
 * cheap structural prefilter → semantic LLM judge on the shortlist only. The
 * judge sees just the blurred side of each candidate, so peer privacy holds.
 */
export async function matchAgainstPool(fresh: StoredIntent, pool: StoredIntent[]): Promise<StoredIntent[]> {
  const want = COMPLEMENT[fresh.intent.kind];
  const candidates = pool.filter(
    (p) => p.userId !== fresh.userId && p.intent.kind === want && p.intent.active !== false,
  );
  if (candidates.length === 0) return [];

  const shortlist = prefilter(fresh, candidates);
  if (shortlist.length === 0) return [];
  console.log(`[match] ${fresh.intent.id}: pool ${candidates.length} → shortlist ${shortlist.length} → 1 judge call`);

  const verdicts = await matcher.judge(fresh.intent, shortlist.map((c) => c.intent));
  const good = new Set(verdicts.filter((v) => v.relevant && v.score >= 0.6).map((v) => v.signalId));
  return shortlist.filter((c) => good.has(c.intent.id));
}
