import type { PrivateIntent } from "../core/intent";
import { discriminative } from "../core/stopwords";
import { barterCycles, type Party } from "../multilateral/detect";

/** What a seeker will accept = its own item tags ∪ its substitutes, minus
 *  non-discriminative words ("used", "free") that would create false matches. */
const accepts = (i: PrivateIntent) =>
  new Set(discriminative([...(i.publicTags ?? i.tags), ...(i.substitutes ?? [])]).map((t) => t.toLowerCase()));
const provides = (i: PrivateIntent) => discriminative(i.publicTags ?? i.tags).map((t) => t.toLowerCase());

/** Compatible if the offer provides something the seeker accepts, a ZOPA exists,
 *  and the deal beats both outside options (individual rationality via fallback). */
export function commerceCompatible(seek: PrivateIntent, offer: PrivateIntent): boolean {
  if (!provides(offer).some((t) => accepts(seek).has(t))) return false;
  const buyerCeil = Math.min(seek.valuation ?? Infinity, seek.fallback ?? Infinity);
  const sellerFloor = Math.max(offer.valuation ?? 0, offer.fallback ?? 0);
  return buyerCeil >= sellerFloor; // a feasible, IR-respecting price exists
}

/** Gains from trade if both priced; 0 otherwise (still matchable for coverage). */
export const surplus = (seek: PrivateIntent, offer: PrivateIntent): number =>
  seek.valuation != null && offer.valuation != null ? Math.max(0, seek.valuation - offer.valuation) : 0;

export interface Trade { kind: "commerce"; buyer: string; seller: string; surplus: number }
export interface Ring { kind: "ring"; members: string[] }
export interface Settlement { trades: (Trade | Ring)[] }
export type Strategy = "surplus" | "coverage" | "baseline";

const caps = (offers: Party[]) => new Map(offers.map((o) => [o.id, o.intent.qty ?? 1]));

/** Commerce matching under a strategy (qty-aware, each seeker used once). */
function commerce(seeks: Party[], offers: Party[], strategy: Strategy): Trade[] {
  const cap = caps(offers);
  const trades: Trade[] = [];
  const take = (s: Party, o: Party) => {
    cap.set(o.id, (cap.get(o.id) ?? 0) - 1);
    trades.push({ kind: "commerce", buyer: s.id, seller: o.id, surplus: surplus(s.intent, o.intent) });
  };

  if (strategy === "coverage") {
    // most-constrained seekers first → maximize how many get cleared
    const compat = (s: Party) => offers.filter((o) => commerceCompatible(s.intent, o.intent));
    for (const s of [...seeks].sort((a, b) => compat(a).length - compat(b).length)) {
      const opts = compat(s).filter((o) => (cap.get(o.id) ?? 0) > 0);
      if (opts.length) take(s, opts.sort((x, y) => surplus(s.intent, y.intent) - surplus(s.intent, x.intent))[0]!);
    }
    return trades;
  }

  // surplus = greedy by highest gains-from-trade; baseline = input order
  const pairs: { s: Party; o: Party; v: number }[] = [];
  for (const s of seeks) for (const o of offers) {
    if (commerceCompatible(s.intent, o.intent)) pairs.push({ s, o, v: surplus(s.intent, o.intent) });
  }
  if (strategy === "surplus") pairs.sort((a, b) => b.v - a.v);
  const used = new Set<string>();
  for (const p of pairs) {
    if (used.has(p.s.id) || (cap.get(p.o.id) ?? 0) <= 0) continue;
    used.add(p.s.id);
    take(p.s, p.o);
  }
  return trades;
}

/** Greedily pick node-disjoint barter rings. */
function rings(parties: Party[]): Ring[] {
  const used = new Set<string>();
  const out: Ring[] = [];
  for (const r of barterCycles(parties).filter((c) => c.members.length >= 3).sort((a, b) => b.members.length - a.members.length)) {
    if (r.members.some((m) => used.has(m.id))) continue;
    r.members.forEach((m) => used.add(m.id));
    out.push({ kind: "ring", members: r.members.map((m) => m.id) });
  }
  return out;
}

export function solve(parties: Party[], strategy: Strategy): Settlement {
  const seeks = parties.filter((p) => p.intent.kind === "seek");
  const offers = parties.filter((p) => p.intent.kind === "offer");
  return { trades: [...commerce(seeks, offers, strategy), ...rings(parties)] };
}

export interface Score { surplus: number; cleared: number; coverage: number }
export function score(s: Settlement, parties: Party[]): Score {
  const cleared = new Set<string>();
  let surplusTotal = 0;
  for (const t of s.trades) {
    if (t.kind === "commerce") { cleared.add(t.buyer); cleared.add(t.seller); surplusTotal += t.surplus; }
    else for (const m of t.members) cleared.add(m);
  }
  return { surplus: surplusTotal, cleared: cleared.size, coverage: parties.length ? cleared.size / parties.length : 0 };
}
