import type { PrivateIntent } from "../core/intent";

export interface Party { id: string; intent: PrivateIntent }

const tags = (i: PrivateIntent) => (i.publicTags ?? i.tags).map((t) => t.toLowerCase());
const overlap = (a: string[], b: string[]) => {
  const s = new Set(a.map((x) => x.toLowerCase()));
  return b.some((x) => s.has(x.toLowerCase()));
};

// ── Detector A: group-buy aggregation ──
export interface GroupBuy { offer: Party; buyers: Party[]; qty: number }

/** One offer that several seekers want — cluster them into a bulk deal. */
export function groupBuys(parties: Party[], minBuyers = 2): GroupBuy[] {
  const offers = parties.filter((p) => p.intent.kind === "offer");
  const seeks = parties.filter((p) => p.intent.kind === "seek");
  const out: GroupBuy[] = [];
  for (const o of offers) {
    const buyers = seeks.filter(
      (s) => s.id !== o.id && s.intent.domain === o.intent.domain && overlap(tags(s.intent), tags(o.intent)),
    );
    if (buyers.length >= minBuyers) out.push({ offer: o, buyers, qty: o.intent.qty ?? 1 });
  }
  return out;
}

// ── Detector B: barter cycles (ring trades) ──
export interface Ring { members: Party[] } // m0 receives from m1, m1 from m2, …, last from m0

/** Directed graph over swaps: edge i→j when i WANTS what j HAS. A cycle is a
 *  settleable ring where no pair has a double coincidence but the loop closes. */
export function barterCycles(parties: Party[], maxLen = 4): Ring[] {
  const swaps = parties.filter((p) => p.intent.kind === "swap" || p.intent.kind === "barter");
  const wants = (p: Party) => p.intent.want ?? [];
  const has = (p: Party) => p.intent.have ?? [];
  const adj = new Map<string, Party[]>();
  for (const i of swaps) adj.set(i.id, swaps.filter((j) => j.id !== i.id && overlap(wants(i), has(j))));

  const rings: Ring[] = [];
  const seen = new Set<string>();
  const canonical = (ids: string[]) => {
    let best: string | null = null;
    for (let k = 0; k < ids.length; k++) {
      const rot = ids.slice(k).concat(ids.slice(0, k)).join(">");
      if (best === null || rot < best) best = rot;
    }
    return best ?? "";
  };

  const dfs = (start: Party, current: Party, path: Party[]) => {
    for (const next of adj.get(current.id) ?? []) {
      if (next.id === start.id && path.length >= 2) {
        const key = canonical(path.map((p) => p.id));
        if (!seen.has(key)) { seen.add(key); rings.push({ members: [...path] }); }
        continue;
      }
      if (path.some((p) => p.id === next.id)) continue; // keep it simple
      if (path.length >= maxLen) continue;
      dfs(start, next, [...path, next]);
    }
  };
  for (const s of swaps) dfs(s, s, [s]);
  return rings;
}
