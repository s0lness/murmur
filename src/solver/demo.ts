import type { PrivateIntent } from "../core/intent";
import type { Party } from "../multilateral/detect";
import { score, solve, type Strategy } from "./solve";

const seek = (id: string, tags: string[], max: number, opts: { subs?: string[]; fallback?: number } = {}): Party =>
  ({ id, intent: { id, kind: "seek", domain: "d", tags, region: "*", valuation: max, fallback: opts.fallback, substitutes: opts.subs } as PrivateIntent });
const offer = (id: string, tags: string[], min: number, qty = 1): Party =>
  ({ id, intent: { id, kind: "offer", domain: "d", tags, region: "*", valuation: min, qty } as PrivateIntent });
const swap = (id: string, have: string[], want: string[]): Party =>
  ({ id, intent: { id, kind: "swap", domain: "swap", tags: [...have, ...want], region: "*", have, want } as PrivateIntent });

const batch: Party[] = [
  offer("lamp", ["lamp"], 10),
  offer("rug", ["rug"], 10),
  seek("flex", ["lamp"], 120, { subs: ["rug"] }), // would take a lamp OR a rug
  seek("lampOnly", ["lamp"], 100), // only a lamp
  seek("poor", ["lamp"], 100, { fallback: 8 }), // can get one for 8 elsewhere → IR excludes it
  swap("p1", ["sword"], ["shield"]),
  swap("p2", ["shield"], ["potion"]),
  swap("p3", ["potion"], ["sword"]),
];

console.log("\n▶ murmur — batch solver + competition (standalone)\n");

const strategies: Strategy[] = ["surplus", "coverage", "baseline"];
const results = strategies.map((st) => {
  const s = solve(batch, st);
  const sc = score(s, batch);
  const lines = s.trades.map((t) =>
    t.kind === "commerce" ? `${t.buyer} ⇄ ${t.seller} (+${t.surplus})` : `ring ${t.members.join("→")}`,
  );
  return { st, s, sc, lines };
});

for (const r of results) {
  console.log(`─ ${r.st} ${"".padEnd(0)}`.padEnd(50, "─"));
  console.log(`  ${r.lines.join("   ") || "(no trades)"}`);
  console.log(`  surplus ${r.sc.surplus}   cleared ${r.sc.cleared}/${batch.length} (${Math.round(r.sc.coverage * 100)}%)\n`);
}

const bySurplus = [...results].sort((a, b) => b.sc.surplus - a.sc.surplus)[0]!;
const byCoverage = [...results].sort((a, b) => b.sc.coverage - a.sc.coverage)[0]!;
console.log("─ competition ────────────────────────────────────");
console.log(`  best surplus   → ${bySurplus.st} (${bySurplus.sc.surplus})`);
console.log(`  best coverage  → ${byCoverage.st} (${Math.round(byCoverage.sc.coverage * 100)}%)`);
console.log("  note: 'poor' is correctly never matched (its €8 fallback beats the seller's floor);");
console.log("        'flex' only clears because its substitute (rug) opens a second edge.\n");
