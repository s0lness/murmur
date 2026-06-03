import type { Kind } from "../core/intent";
import { SemanticMatcher } from "../matching/semanticMatcher";
import type { StoredIntent } from "./store";

const COMPLEMENT: Record<Kind, Kind> = { seek: "offer", offer: "seek", swap: "swap", barter: "barter" };
const matcher = new SemanticMatcher();

/**
 * Match a fresh intent against the live pool using the semantic matcher (robust
 * to the messy, multilingual wants real people type). The matcher only sees the
 * blurred public side of each candidate — peer privacy holds.
 */
export async function matchAgainstPool(fresh: StoredIntent, pool: StoredIntent[]): Promise<StoredIntent[]> {
  const want = COMPLEMENT[fresh.intent.kind];
  const candidates = pool.filter(
    (p) => p.userId !== fresh.userId && p.intent.kind === want && p.intent.active !== false,
  );
  if (candidates.length === 0) return [];
  const verdicts = await matcher.judge(fresh.intent, candidates.map((c) => c.intent));
  const good = new Set(verdicts.filter((v) => v.relevant && v.score >= 0.6).map((v) => v.signalId));
  return candidates.filter((c) => good.has(c.intent.id));
}
