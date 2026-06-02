import type { Ctx } from "../core/ctx";
import type { Kind, PrivateIntent, PublicSignal } from "../core/intent";

export interface Match {
  intent: PrivateIntent;
  score: number;
}

/** Which signal kind is interesting given one of my intent kinds. */
const COMPLEMENT: Record<Kind, Kind> = {
  seek: "offer",
  offer: "seek",
  swap: "swap",
  barter: "barter",
};

/**
 * Matching ladder, rung 1: cleartext predicate match over the blurred signal.
 * Deliberately permissive — it routes *interest*, and lets the private
 * negotiation do the real filtering (price/ZOPA, double-coincidence, trust).
 * Later rungs replace the tag overlap with bloom filters -> PSI -> MPC scoring.
 */
export function evaluate(
  signal: PublicSignal,
  intents: PrivateIntent[],
  ctx: Ctx,
): Match | null {
  if (ctx.trust.scoreFor(signal.pseudonymId) < signal.trustGate) return null;

  let best: Match | null = null;
  for (const intent of intents) {
    if (COMPLEMENT[intent.kind] !== signal.kind) continue;
    if (intent.domain !== signal.domain) continue;
    if (!regionCompatible(signal.region, intent.region)) continue;

    const mine = intent.want ?? intent.tags;
    const score = jaccard(mine, signal.tags);
    if (score <= 0) continue;
    if (!best || score > best.score) best = { intent, score };
  }
  return best;
}

/** "*" is anywhere; otherwise equal or one a prefix of the other (FR ⊇ FR-75). */
function regionCompatible(a: string, b: string): boolean {
  if (a === "*" || b === "*") return true;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}
