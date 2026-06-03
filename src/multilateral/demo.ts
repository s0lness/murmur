import type { PrivateIntent } from "../core/intent";
import { barterCycles, groupBuys, type Party } from "./detect";

const seek = (id: string, domain: string, tags: string[]): Party => ({ id, intent: { id, kind: "seek", domain, tags, region: "*" } as PrivateIntent });
const offer = (id: string, domain: string, tags: string[], qty: number): Party => ({ id, intent: { id, kind: "offer", domain, tags, region: "*", qty } as PrivateIntent });
const swap = (id: string, have: string[], want: string[]): Party => ({ id, intent: { id, kind: "swap", domain: "swap", tags: [...have, ...want], region: "*", have, want } as PrivateIntent });

console.log("\n▶ murmur — multilateral settlement (standalone)\n");

// ── group-buy: 1 seller of 10 t-shirts, several buyers ──
const market: Party[] = [
  offer("alice", "goods.clothing", ["tshirt", "cotton"], 10),
  seek("bob", "goods.clothing", ["tshirt"]),
  seek("carol", "goods.clothing", ["tshirt", "m-size"]),
  seek("dave", "goods.clothing", ["tshirt"]),
  seek("erin", "goods.bikes", ["bike"]), // unrelated — must NOT join
];
console.log("─ group-buy ──────────────────────────────────────");
for (const g of groupBuys(market)) {
  console.log(`  ${g.offer.id} sells ${g.qty}× ${(g.offer.intent.publicTags ?? g.offer.intent.tags)[0]}`);
  console.log(`    → group of ${g.buyers.length}: ${g.buyers.map((b) => b.id).join(", ")}`);
}

// ── barter ring: sword → shield → potion → sword ──
const ringPool: Party[] = [
  swap("p1", ["sword"], ["shield"]),
  swap("p2", ["shield"], ["potion"]),
  swap("p3", ["potion"], ["sword"]),
  swap("p4", ["map"], ["compass"]), // no counterpart — must NOT form a ring
];
console.log("\n─ barter cycles ──────────────────────────────────");
const rings = barterCycles(ringPool);
if (rings.length === 0) console.log("  (none)");
for (const r of rings) {
  const chain = r.members.map((m, i) => {
    const from = r.members[(i + 1) % r.members.length]!;
    return `${m.id} gets ${(m.intent.want ?? [])[0]} from ${from.id}`;
  });
  console.log(`  ${r.members.length}-way ring: ${r.members.map((m) => m.id).join(" → ")}`);
  for (const c of chain) console.log(`     · ${c}`);
}
console.log("");
