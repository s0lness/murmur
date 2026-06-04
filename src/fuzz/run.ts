import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type PrivateIntent } from "../core/intent";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { normalizePool } from "../eval/normalize";
import { barterCycles, groupBuys, type Party } from "../multilateral/detect";
import { buildAliases, proposeEdges, type ResidualIntent } from "../solver/helper";
import { score, solve } from "../solver/solve";
import { decideMatch, decidePrice } from "./human";
import { makePersonas, type Persona } from "./persona";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY not set."); process.exit(1); }

const N = Number(process.argv[2]) || 12;
const NORM = process.argv.includes("norm"); // canonicalize the pool (domains/tokens) before detection
const HELP = process.argv.includes("help"); // run the LLM matchmaker failover on the residual
const PLANT = process.argv.includes("ring"); // inject a deterministic 3-way swap cycle to exercise the ring path
const CRING = process.argv.includes("cring"); // inject a ring that closes semantically but breaks on one lexical gap

// A→B→C→A: Ada wants what Ben has, Ben wants what Cleo has, Cleo wants what Ada has.
const RING: Persona[] = [
  { id: "r1", name: "Ada Plant", brief: "Decisive, just wants to swap and be done.", wants: ["Swap: I have a mountain bike, want a sewing machine — straight trade"] },
  { id: "r2", name: "Ben Plant", brief: "Easy-going, happy to barter.", wants: ["Swap: I have a sewing machine, want an acoustic guitar — straight trade"] },
  { id: "r3", name: "Cleo Plant", brief: "Keen swapper, no cash involved.", wants: ["Swap: I have an acoustic guitar, want a mountain bike — straight trade"] },
];

// No-cash ring whose loop closes (PS5→bike→camera→PS5) but breaks deterministically:
// "games console" ≠ "ps5" by word overlap, so barterCycles can't see it. The helper can.
const SWAP_RING: Persona[] = [
  { id: "s1", name: "Gus Trade", brief: "Only swaps, never takes cash.", wants: ["I want to swap my PS5 with 2 controllers for a decent commuter bike — trade only, not selling for cash"] },
  { id: "s2", name: "Ivy Trade", brief: "Trades, never sells.", wants: ["Swap my road bike for a good camera — happy to trade, not after cash"] },
  { id: "s3", name: "Jo Trade", brief: "Barter type, no money involved.", wants: ["I'll trade my mirrorless camera for a games console for the kids — swap only"] },
];
const distiller = new LLMDistiller();
const item = (i: PrivateIntent) => (i.publicTags ?? i.tags).slice(0, 3).join(" ");
const irPrice = (b: PrivateIntent, s: PrivateIntent): number | null => {
  if (b.valuation == null || s.valuation == null) return null;
  const floor = Math.max(s.valuation, s.fallback ?? 0);
  const ceil = Math.min(b.valuation, b.fallback ?? Infinity);
  return ceil >= floor ? Math.round((floor + ceil) / 2) : null;
};

console.log(`\n▶ murmur fuzz — ${N} LLM-humans on the real pipeline (model ${process.env.MURMUR_MODEL ?? "haiku-4-5"})\n`);

const personas = [...(await makePersonas(N)), ...(PLANT ? RING : []), ...(CRING ? SWAP_RING : [])];
const POP = personas.length;
const personaOf = new Map<string, Persona>(); // intentId → persona
const all: PrivateIntent[] = [];
await Promise.all(personas.map(async (p) => {
  const ints = await distiller.distill({ agentId: p.id, persona: p.name, utterances: p.wants });
  for (const i of ints) { personaOf.set(i.id, p); all.push(i); }
}));

if (NORM) {
  const norm = await normalizePool(all.map((i) => ({
    id: i.id, kind: i.kind, domain: i.domain,
    tags: i.publicTags ?? i.tags, have: i.have ?? [], want: i.want ?? [],
  })));
  for (const i of all) {
    const o = norm.get(i.id);
    if (!o) continue;
    i.domain = o.domain; i.tags = o.tags; i.publicTags = o.tags;
    i.have = o.have; i.want = o.want;
  }
  console.log(`  (pool normalized: ${norm.size} intents canonicalized)\n`);
}

const parties: Party[] = all.filter((i) => i.active !== false).map((i) => ({ id: i.id, intent: i }));
const intentById = new Map(all.map((i) => [i.id, i]));

console.log("─ population ──────────────────────────────────────");
for (const p of personas) {
  const mine = all.filter((i) => personaOf.get(i.id) === p);
  console.log(`  ${p.name.padEnd(14)} ${mine.map((i) => `${i.kind}:${item(i)}`).join(" · ") || "(no intent)"}`);
}

// ── settle ──
const settlement = solve(parties, "coverage");
const groups = groupBuys(parties);
const rings = barterCycles(parties).filter((r) => r.members.length >= 3);

interface Deal { kind: string; who: string[]; detail: string }
const deals: Deal[] = [];
const declines: string[] = [];

// pairwise commerce: both must connect, then both approve the price
for (const t of settlement.trades) {
  if (t.kind !== "commerce") continue;
  const bI = intentById.get(t.buyer)!, sI = intentById.get(t.seller)!;
  const bP = personaOf.get(t.buyer)!, sP = personaOf.get(t.seller)!;
  if (bP === sP) continue;
  const bConn = await decideMatch(bP, `Your agent found a seller offering "${item(sI)}". Connect?`);
  const sConn = await decideMatch(sP, `Your agent found a buyer who wants "${item(bI)}". Connect?`);
  if (!bConn.connect || !sConn.connect) {
    const who = !bConn.connect ? bP : sP, reason = !bConn.connect ? bConn.reason : sConn.reason;
    declines.push(`${bP.name}⇄${sP.name} (${item(sI)}): ${who.name} passed — "${reason}"`);
    continue;
  }
  const price = irPrice(bI, sI);
  if (price == null) { deals.push({ kind: "deal", who: [bP.name, sP.name], detail: `${item(sI)} (no price)` }); continue; }
  const bA = await decidePrice(bP, item(sI), price, "buy");
  const sA = await decidePrice(sP, item(sI), price, "sell");
  if (bA.action === "approve" && sA.action === "approve") deals.push({ kind: "deal", who: [bP.name, sP.name], detail: `${item(sI)} @ €${price}` });
  else declines.push(`${bP.name}⇄${sP.name} (${item(sI)} @ €${price}): ${bA.action}/${sA.action} — buyer:"${bA.reason}" seller:"${sA.reason}"`);
}

// group buys: seller + buyers all decide to join
for (const g of groups) {
  const members = [g.offer, ...g.buyers].map((p) => personaOf.get(p.id)!);
  const votes = await Promise.all(members.map((m, idx) =>
    decideMatch(m, idx === 0 ? `${g.buyers.length} people want your "${item(g.offer.intent)}". Sell as a batch?` : `A group buy is forming for "${item(g.offer.intent)}". Join?`)));
  const joined = votes.filter((v) => v.connect).length;
  if (votes[0]?.connect && joined >= 2) deals.push({ kind: "group", who: members.map((m) => m.name), detail: `${item(g.offer.intent)} ×${g.qty} group buy` });
  else declines.push(`group ${item(g.offer.intent)}: only ${joined} joined`);
}

// barter rings: all members must join
for (const r of rings) {
  const members = r.members.map((m) => personaOf.get(m.id)!);
  const votes = await Promise.all(r.members.map((m) => {
    const mi = intentById.get(m.id)!;
    return decideMatch(personaOf.get(m.id)!, `A ${r.members.length}-way swap: you give "${(mi.have ?? []).join("+")}" and get "${(mi.want ?? []).join("+")}". Join?`);
  }));
  if (votes.every((v) => v.connect)) deals.push({ kind: "ring", who: members.map((m) => m.name), detail: `${r.members.length}-way swap` });
  else declines.push(`ring ${members.map((m) => m.name).join("→")}: someone passed`);
}

// ── helper failover (hybrid): LLM emits fuzzy edges, the deterministic detector
//    closes cycles/matches over the token-augmented residual, human gate confirms ──
let helperStats = "";
if (HELP) {
  const cleared0 = new Set(deals.flatMap((d) => d.who));
  const residualParties = parties.filter((p) => !cleared0.has(personaOf.get(p.id)!.name));
  const residual: ResidualIntent[] = residualParties.map((p) => ({
    id: p.id, who: personaOf.get(p.id)!.name, kind: p.intent.kind, item: item(p.intent),
    have: p.intent.have ?? [], want: p.intent.want ?? [],
  }));
  const edges = await proposeEdges(residual);
  const { canon, questionFor } = buildAliases(edges);
  // augment: rewrite every token to its equivalence-class canonical, then re-detect
  const aug: Party[] = residualParties.map((p) => {
    const tags = (p.intent.publicTags ?? p.intent.tags).map(canon);
    return { id: p.id, intent: { ...p.intent, tags, publicTags: tags, have: (p.intent.have ?? []).map(canon), want: (p.intent.want ?? []).map(canon) } };
  });
  const augRings = barterCycles(aug).filter((r) => r.members.length >= 3);
  let recovered = 0, attempts = 0;

  // rings: deterministic loop over the augmented graph; frame each leg in ORIGINAL terms
  for (const r of augRings) {
    attempts++;
    const orig = r.members.map((m) => intentById.get(m.id)!);
    const ps = r.members.map((m) => personaOf.get(m.id)!);
    const n = r.members.length;
    const q = orig.flatMap((o) => (o.want ?? []).map(questionFor)).find((x) => x) ?? "";
    const votes = await Promise.all(r.members.map((_, k) => {
      const gives = (orig[k]!.have ?? []).join("+"), gets = (orig[(k + 1) % n]!.have ?? []).join("+");
      return decideMatch(ps[k]!, `Your agent found a swap ring the main solver missed: you give "${gives}" and receive "${gets}". ${q} Interested?`);
    }));
    if (votes.every((v) => v.connect)) { deals.push({ kind: "~ring", who: ps.map((p) => p.name), detail: `${n}-way swap (helper edges)` }); recovered++; }
    else { const i = votes.findIndex((v) => !v.connect); declines.push(`helper ring (${ps.map((p) => p.name).join("→")}): ${ps[i]?.name} passed — "${votes[i]?.reason}"`); }
  }

  // 2-party commerce/substitute surfaced only by the augmented graph
  for (const t of solve(aug, "coverage").trades) {
    if (t.kind !== "commerce") continue;
    const bP = personaOf.get(t.buyer)!, sP = personaOf.get(t.seller)!;
    if (bP === sP || cleared0.has(bP.name) || cleared0.has(sP.name)) continue;
    const sI = intentById.get(t.seller)!;
    const q = (sI.tags ?? []).map(questionFor).find((x) => x) ?? "";
    if (!q && canon(item(sI)) === item(sI)) continue; // no fuzzy edge involved → not a helper recovery
    attempts++;
    const bC = await decideMatch(bP, `Your agent found a near-match the main solver missed: buy "${item(sI)}". ${q} Interested?`);
    const sC = await decideMatch(sP, `Your agent found a buyer for your "${item(sI)}" the main solver missed. Interested?`);
    if (bC.connect && sC.connect) { deals.push({ kind: "~sub", who: [bP.name, sP.name], detail: `${item(sI)} (helper edges)` }); recovered++; }
    else { const who = !bC.connect ? bP : sP, reason = !bC.connect ? bC.reason : sC.reason; declines.push(`helper sub (${bP.name}⇄${sP.name}, ${item(sI)}): ${who.name} passed — "${reason}"`); }
  }
  helperStats = `  helper(hybrid): ${edges.length} edges → ${augRings.length} rings+subs; ${attempts} attempts → ${recovered} recovered`;
}

// ── report ──
const clearedPeople = new Set(deals.flatMap((d) => d.who));
console.log(`\n─ deals (${deals.length}) ─────────────────────────────────`);
for (const d of deals) console.log(`  ✓ ${d.kind.padEnd(6)} ${d.who.join(" ⇄ ")} — ${d.detail}`);
console.log(`\n─ fell through (${declines.length}) ──────────────────────`);
for (const x of declines) console.log(`  ✗ ${x}`);
const unmatched = personas.filter((p) => !clearedPeople.has(p.name));
console.log(`\n─ unmatched people (${unmatched.length}/${POP}) ────────────────`);
for (const p of unmatched) console.log(`  · ${p.name}: ${p.wants.join(" / ")}`);

const sc = score(settlement, parties);
console.log(`\n─ metrics ─────────────────────────────────────────`);
console.log(`  people with a deal   ${clearedPeople.size}/${POP}`);
console.log(`  solver coverage      ${Math.round(sc.coverage * 100)}% of intents   surplus ${sc.surplus}`);
console.log(`  groups ${groups.length}   rings ${rings.length}`);
if (helperStats) console.log(helperStats);

// ── run log ── compact one-liner to a raw index; curated findings live in log.md
mkdirSync(join(process.cwd(), "runs"), { recursive: true });
const stamp = new Date().toISOString();
appendFileSync(join(process.cwd(), "runs", "index.md"),
  `${stamp} N=${POP}${PLANT ? "+ring" : ""}${CRING ? "+cring" : ""}${NORM ? "+norm" : ""}${HELP ? "+help" : ""}${process.env.MURMUR_MODEL ?? "haiku-4-5"} — deals ${deals.length} [${deals.map((d) => d.kind).join(",") || "none"}], cleared ${clearedPeople.size}/${POP}, coverage ${Math.round(sc.coverage * 100)}%, groups ${groups.length}, rings ${rings.length}, fell ${declines.length}\n`);
console.log(`\n  logged to runs/index.md\n`);
