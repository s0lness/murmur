import type { PrivateIntent } from "../core/intent";
import { STOPWORDS } from "../core/stopwords";

export interface Party { id: string; intent: PrivateIntent }

const tags = (i: PrivateIntent) => (i.publicTags ?? i.tags).map((t) => t.toLowerCase());
/** Word-level overlap — tolerant of the distiller's token drift, so "ps5:forza"
 *  and "forza", or "tickets" and "ticket" via "concert"/"friday", still connect.
 *  Stopwords ("used", "free") are dropped so they can't create false overlaps. */
const words = (xs: string[]) => new Set(xs.flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
const overlap = (a: string[], b: string[]) => {
  const wa = words(a);
  for (const w of words(b)) if (wa.has(w)) return true;
  return false;
};

// ── Detector A: group-buy aggregation ──
export interface GroupBuy { offer: Party; buyers: Party[]; qty: number }

/** One BULK offer (qty ≥ 2) that several seekers want — cluster them into a
 *  group buy. A single-unit offer with many buyers is NOT a group buy; it's
 *  contention for one item, handled by the pairwise allocation. */
export function groupBuys(parties: Party[], minBuyers = 2): GroupBuy[] {
  const offers = parties.filter((p) => p.intent.kind === "offer");
  const seeks = parties.filter((p) => p.intent.kind === "seek");
  const out: GroupBuy[] = [];
  for (const o of offers) {
    if ((o.intent.qty ?? 1) < 2) continue; // need real bulk to distribute
    const buyers = seeks.filter(
      (s) => s.id !== o.id && overlap(tags(s.intent), tags(o.intent)), // tag overlap, not strict same-domain
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
