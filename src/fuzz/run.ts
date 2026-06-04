import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { money } from "../core/currency";
import { type PrivateIntent } from "../core/intent";
import { costUSD, usageSummary, usageTotal } from "../core/usage";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { normalizePool } from "../eval/normalize";
import { barterCycles, groupBuys, type Party } from "../multilateral/detect";
import { buildAliases, proposeEdges, type ResidualIntent } from "../solver/helper";
import { score, solve } from "../solver/solve";
import { decideMatch as rawMatch, decidePrice as rawPrice, decideRefine } from "./human";
import { makePersonas, type Persona } from "./persona";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY not set."); process.exit(1); }

const N = Number(process.argv[2]) || 12;
const NORM = process.argv.includes("norm"); // canonicalize the pool (domains/tokens) before detection
const HELP = process.argv.includes("help"); // run the LLM matchmaker failover on the residual
const REFINE = process.argv.includes("refine"); // agents ask unmatched users a clarifying question, then re-match
const WATCH = process.argv.includes("watch"); // pace the run so the dashboard can animate it
const PLANT = process.argv.includes("ring"); // inject a deterministic 3-way swap cycle to exercise the ring path
const CRING = process.argv.includes("cring"); // inject a ring that closes semantically but breaks on one lexical gap
const REFDEMO = process.argv.includes("refdemo"); // inject a flexible seeker + near-substitute offer to exercise refine

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
// Refine demo: a FLEXIBLE seeker whose want ("games console") the keyword matcher
// can't link to the offer ("PS5"), but the helper can (ps5≈games console). The
// flexible human accepts when asked → broadcast refined → deal recovered.
const REFINE_DEMO: Persona[] = [
  { id: "f1", name: "Pat Flex", brief: "Easy-going, flexible, not brand-loyal — just wants the kids entertained.", wants: ["Looking for a games console for the kids, any kind is totally fine, around $200"] },
  { id: "f2", name: "Quinn Sell", brief: "Straightforward seller.", wants: ["Selling my PlayStation 5, mint, $190"] },
  // Note: the distiller usually tags both with "console", so they match deterministically
  // rather than via refine — which is itself the finding (see runs/log.md Session 8).
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

const personas = [...(await makePersonas(N)), ...(PLANT ? RING : []), ...(CRING ? SWAP_RING : []), ...(REFDEMO ? REFINE_DEMO : [])];
const POP = personas.length;

// ── live dashboard feed: write a snapshot the viewer polls (viewer/fuzz.html) ──
const LIVE = join(process.cwd(), "viewer", "fuzz-live.json");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const live = {
  startedAt: new Date().toISOString(), n: POP, model: process.env.MURMUR_MODEL ?? "haiku-4-5",
  flags: [NORM && "norm", HELP && "help", REFINE && "refine", PLANT && "ring", CRING && "cring"].filter(Boolean),
  phase: "distilling wants…", population: [] as { name: string; brief: string; intents: string[] }[],
  deals: [] as { kind: string; who: string[]; detail: string }[], declines: [] as string[],
  edges: [] as { a: string; b: string; confidence: number; question: string }[],
  metrics: null as null | { cleared: number; pop: number; coveragePct: number; surplus: number; groups: number; rings: number; helper: string },
  cost: null as null | { calls: number; inputTokens: number; outputTokens: number; usd: number },
  conversations: [] as { persona: string; agent: string; human: string; ok: boolean }[],
};
const MODEL = process.env.MURMUR_MODEL ?? "haiku-4-5";
async function tick(phase?: string, pace = true) {
  if (phase) live.phase = phase;
  const u = usageTotal();
  live.cost = { calls: u.calls, inputTokens: u.input + u.cacheWrite + u.cacheRead, outputTokens: u.output, usd: costUSD(MODEL) };
  writeFileSync(LIVE, JSON.stringify(live));
  if (WATCH && pace) await sleep(450);
}
await tick();

// Logging wrappers: capture each agent→human exchange (the question murmur put to
// the user's LLM stand-in, and how they answered) so the dashboard can show it.
async function decideMatch(p: Persona, prompt: string) {
  const r = await rawMatch(p, prompt);
  live.conversations.push({ persona: p.name, agent: prompt, human: `${r.connect ? "✅ connect" : "❌ pass"} — ${r.reason}`, ok: r.connect });
  return r;
}
async function decidePrice(p: Persona, item: string, price: number, side: "buy" | "sell") {
  const r = await rawPrice(p, item, price, side);
  live.conversations.push({ persona: p.name, agent: `💬 Price for "${item}": ${money(price)} (you ${side})`, human: `${r.action}${r.newLimit != null ? ` → ${money(r.newLimit)}` : ""} — ${r.reason}`, ok: r.action === "approve" });
  return r;
}

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
  live.population.push({ name: p.name, brief: p.brief, intents: mine.map((i) => `${i.kind}:${item(i)}`) });
}
await tick("population broadcast");

// ── settle ──
const settlement = solve(parties, "coverage");
const groups = groupBuys(parties);
const rings = barterCycles(parties).filter((r) => r.members.length >= 3);

interface Deal { kind: string; who: string[]; detail: string }
const deals: Deal[] = [];
const declines: string[] = [];
live.deals = deals; live.declines = declines; // share refs so ticks reflect live contents
const tried = new Set<string>(); // name-pairs already proposed deterministically — don't let the helper re-surface them
const pairKey = (a: string, b: string) => [a, b].sort().join("|");
await tick("deterministic matching");

// One commerce trade through the human gate: both connect, then both approve the
// price. Reused by the deterministic pass and the post-refinement re-match.
async function settleCommerce(buyerId: string, sellerId: string, label = "deal"): Promise<boolean> {
  const bI = intentById.get(buyerId)!, sI = intentById.get(sellerId)!;
  const bP = personaOf.get(buyerId)!, sP = personaOf.get(sellerId)!;
  if (bP === sP || tried.has(pairKey(bP.name, sP.name))) return false;
  tried.add(pairKey(bP.name, sP.name));
  const bConn = await decideMatch(bP, `Your agent found a seller offering "${item(sI)}". Connect?`);
  const sConn = await decideMatch(sP, `Your agent found a buyer who wants "${item(bI)}". Connect?`);
  if (!bConn.connect || !sConn.connect) {
    const who = !bConn.connect ? bP : sP, reason = !bConn.connect ? bConn.reason : sConn.reason;
    declines.push(`${bP.name}⇄${sP.name} (${item(sI)}): ${who.name} passed — "${reason}"`);
    await tick(); return false;
  }
  const price = irPrice(bI, sI);
  if (price == null) { deals.push({ kind: label, who: [bP.name, sP.name], detail: `${item(sI)} (no price)` }); await tick(); return true; }
  const bA = await decidePrice(bP, item(sI), price, "buy");
  const sA = await decidePrice(sP, item(sI), price, "sell");
  const ok = bA.action === "approve" && sA.action === "approve";
  if (ok) deals.push({ kind: label, who: [bP.name, sP.name], detail: `${item(sI)} @ ${money(price)}` });
  else declines.push(`${bP.name}⇄${sP.name} (${item(sI)} @ ${money(price)}): ${bA.action}/${sA.action} — buyer:"${bA.reason}" seller:"${sA.reason}"`);
  await tick(); return ok;
}

// pairwise commerce: both must connect, then both approve the price
for (const t of settlement.trades) {
  if (t.kind !== "commerce") continue;
  await settleCommerce(t.buyer, t.seller);
}

// group buys: seller + buyers all decide to join
for (const g of groups) {
  const members = [g.offer, ...g.buyers].map((p) => personaOf.get(p.id)!);
  const votes = await Promise.all(members.map((m, idx) =>
    decideMatch(m, idx === 0 ? `${g.buyers.length} people want your "${item(g.offer.intent)}". Sell as a batch?` : `A group buy is forming for "${item(g.offer.intent)}". Join?`)));
  const joined = votes.filter((v) => v.connect).length;
  if (votes[0]?.connect && joined >= 2) deals.push({ kind: "group", who: members.map((m) => m.name), detail: `${item(g.offer.intent)} ×${g.qty} group buy` });
  else declines.push(`group ${item(g.offer.intent)}: only ${joined} joined`);
  await tick("multilateral (group-buys & rings)");
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
  await tick("multilateral (group-buys & rings)");
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
  await tick("helper failover — LLM proposing fuzzy edges");
  const edges = await proposeEdges(residual);
  live.edges = edges;
  await tick("helper failover — closing over augmented graph");
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
    await tick();
  }

  // 2-party commerce/substitute surfaced only by the augmented graph
  for (const t of solve(aug, "coverage").trades) {
    if (t.kind !== "commerce") continue;
    const bP = personaOf.get(t.buyer)!, sP = personaOf.get(t.seller)!;
    if (bP === sP || cleared0.has(bP.name) || cleared0.has(sP.name)) continue;
    if (tried.has(pairKey(bP.name, sP.name))) continue; // already proposed & declined deterministically
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

// ── refinement: agents ask unmatched users a clarifying question; an accepted
//    answer REFINES the broadcast (persists a substitute) so it can re-match ──
let refineStats = "";
if (REFINE) {
  await tick("refinement — agents asking clarifying questions");
  let asked = 0, refined = 0, recovered = 0;
  const clearedR = () => new Set(deals.flatMap((d) => d.who));
  // Edge-grounded: only ask about offers the helper says are genuine near-substitutes
  // (same canonical token after fuzzy aliasing) but that the keyword matcher missed.
  const residual: ResidualIntent[] = parties.filter((p) => !clearedR().has(personaOf.get(p.id)!.name))
    .map((p) => ({ id: p.id, who: personaOf.get(p.id)!.name, kind: p.intent.kind, item: item(p.intent), have: p.intent.have ?? [], want: p.intent.want ?? [] }));
  const { canon } = buildAliases(await proposeEdges(residual));
  const offerParties = parties.filter((p) => p.intent.kind === "offer");
  const toks = (i: PrivateIntent) => (i.publicTags ?? i.tags).map((t) => t.toLowerCase());
  for (const s of parties.filter((p) => p.intent.kind === "seek" && !clearedR().has(personaOf.get(p.id)!.name))) {
    const sP = personaOf.get(s.id)!;
    const wantCanon = new Set(toks(s.intent).map(canon)), wantRaw = new Set(toks(s.intent));
    // an offer is a near-substitute if it shares a CANONICAL token but no RAW token
    const cand = offerParties.find((o) => personaOf.get(o.id) !== sP && !tried.has(pairKey(sP.name, personaOf.get(o.id)!.name))
      && toks(o.intent).some((t) => wantCanon.has(canon(t)) && !wantRaw.has(t)));
    if (!cand) continue;
    asked++;
    const question = `There's "${item(cand.intent)}" available — would that work for your "${item(s.intent)}"?`;
    const ans = await decideRefine(sP, question);
    live.conversations.push({ persona: sP.name, agent: `💡 ${question}`, human: `${ans.accept ? "✅ yes" : "❌ no"} — ${ans.reason}`, ok: ans.accept });
    if (ans.accept) { // refine the broadcast: persist the offered item as a substitute
      s.intent.substitutes = [...new Set([...(s.intent.substitutes ?? []), ...toks(cand.intent)])];
      refined++;
    }
    await tick();
  }
  // re-match the refined pool; settleCommerce skips pairs already tried
  if (refined) {
    for (const t of solve(parties, "coverage").trades) {
      if (t.kind !== "commerce") continue;
      const bP = personaOf.get(t.buyer)!, sP = personaOf.get(t.seller)!;
      if (clearedR().has(bP.name) || clearedR().has(sP.name)) continue;
      if (await settleCommerce(t.buyer, t.seller, "↻deal")) recovered++;
    }
  }
  refineStats = `  refine: ${asked} asked → ${refined} accepted → ${recovered} recovered`;
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
const u = usageTotal();
console.log(`\n─ metrics ─────────────────────────────────────────`);
console.log(`  people with a deal   ${clearedPeople.size}/${POP}`);
console.log(`  solver coverage      ${Math.round(sc.coverage * 100)}% of intents   surplus ${sc.surplus}`);
console.log(`  groups ${groups.length}   rings ${rings.length}`);
if (helperStats) console.log(helperStats);
if (refineStats) console.log(refineStats);
console.log(`  cost (this run)      ${usageSummary(MODEL)}${u.calls === 0 ? "  (fully cached — replay was free)" : ""}`);

live.metrics = {
  cleared: clearedPeople.size, pop: POP, coveragePct: Math.round(sc.coverage * 100),
  surplus: sc.surplus, groups: groups.length, rings: rings.length, helper: helperStats.trim(),
};
await tick("done", false);

// ── run log ── compact one-liner to a raw index; curated findings live in log.md
mkdirSync(join(process.cwd(), "runs"), { recursive: true });
const stamp = new Date().toISOString();
appendFileSync(join(process.cwd(), "runs", "index.md"),
  `${stamp} N=${POP}${PLANT ? "+ring" : ""}${CRING ? "+cring" : ""}${NORM ? "+norm" : ""}${HELP ? "+help" : ""}${REFINE ? "+refine" : ""} ${MODEL} — deals ${deals.length} [${deals.map((d) => d.kind).join(",") || "none"}], cleared ${clearedPeople.size}/${POP}, coverage ${Math.round(sc.coverage * 100)}%, groups ${groups.length}, rings ${rings.length}, fell ${declines.length}, cost ~$${costUSD(MODEL).toFixed(4)} (${u.calls} calls)\n`);
console.log(`\n  logged to runs/index.md\n`);
