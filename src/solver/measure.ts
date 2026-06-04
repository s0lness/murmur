import type { PrivateIntent } from "../core/intent";
import type { Party } from "../multilateral/detect";
import { score, solve } from "./solve";

// One ground-truth population with FULL preferences. We then reveal more of each
// person's preference at each richness level and watch what the solver can do.
const seek = (id: string, tags: string[], max: number, subs?: string[]): Party =>
  ({ id, intent: { id, kind: "seek", domain: "d", tags, region: "*", valuation: max, substitutes: subs } as PrivateIntent });
const offer = (id: string, tags: string[], min: number): Party =>
  ({ id, intent: { id, kind: "offer", domain: "d", tags, region: "*", valuation: min, qty: 1 } as PrivateIntent });
const swap = (id: string, have: string[], want: string[]): Party =>
  ({ id, intent: { id, kind: "swap", domain: "swap", tags: [...have, ...want], region: "*", have, want } as PrivateIntent });

const truth: Party[] = [
  offer("S1", ["switch"], 150),
  offer("S3", ["switch"], 130),
  seek("B1", ["switch"], 240), // a real, viable buyer
  seek("B2", ["switch"], 120), // wants a switch but won't pay enough → no viable deal
  seek("B3", ["vita"], 200, ["switch"]), // would also take a switch (substitute)
  swap("p1", ["sword"], ["shield"]),
  swap("p2", ["shield"], ["potion"]),
  swap("p3", ["potion"], ["sword"]),
  swap("p4", ["map"], ["compass"]), // no counterpart - never clears
];

/** Reveal more of each person's order as the level rises. */
function view(p: Party, level: number): Party {
  const i = p.intent;
  const v: PrivateIntent = { id: i.id, kind: i.kind, domain: i.domain, tags: i.tags, region: i.region, qty: i.qty };
  if (level >= 1) v.valuation = i.valuation;
  if (level >= 2) v.substitutes = i.substitutes;
  if (level >= 3) { v.have = i.have; v.want = i.want; }
  return { id: p.id, intent: v };
}

const levels = ["tags only", "+ reservation", "+ substitutes", "+ barter"];

console.log("\n▶ murmur - does richer expression buy better settlements?\n");
console.log("  level            surplus   cleared   coverage   rings   note");
for (let lv = 0; lv < levels.length; lv++) {
  const expressed = truth.map((p) => view(p, lv));
  const s = solve(expressed, "coverage");
  const sc = score(s, expressed);
  const rings = s.trades.filter((t) => t.kind === "ring").length;
  const note = lv === 0 ? "(matches incl. non-viable deals)" : "";
  console.log(
    `  ${levels[lv]!.padEnd(15)}  ${String(sc.surplus).padStart(6)}   ${String(sc.cleared).padStart(3)}/${truth.length}    ${(`${Math.round(sc.coverage * 100)}%`).padStart(5)}     ${String(rings).padStart(3)}   ${note}`,
  );
}
console.log(`
  reading it: tags-only over-reports (matches with no agreeable price); reservation
  prunes to real deals; substitutes re-open edges and grow real matches; barter
  clears a whole subgroup that money matching never could.
`);
