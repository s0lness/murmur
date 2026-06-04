import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type PrivateIntent } from "../core/intent";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { barterCycles, groupBuys, type Party } from "../multilateral/detect";
import { score, solve } from "../solver/solve";
import { decideMatch, decidePrice } from "./human";
import { makePersonas, type Persona } from "./persona";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY not set."); process.exit(1); }

const N = Number(process.argv[2]) || 12;
const distiller = new LLMDistiller();
const item = (i: PrivateIntent) => (i.publicTags ?? i.tags).slice(0, 3).join(" ");
const irPrice = (b: PrivateIntent, s: PrivateIntent): number | null => {
  if (b.valuation == null || s.valuation == null) return null;
  const floor = Math.max(s.valuation, s.fallback ?? 0);
  const ceil = Math.min(b.valuation, b.fallback ?? Infinity);
  return ceil >= floor ? Math.round((floor + ceil) / 2) : null;
};

console.log(`\n▶ murmur fuzz — ${N} LLM-humans on the real pipeline (model ${process.env.MURMUR_MODEL ?? "haiku-4-5"})\n`);

const personas = await makePersonas(N);
const personaOf = new Map<string, Persona>(); // intentId → persona
const all: PrivateIntent[] = [];
await Promise.all(personas.map(async (p) => {
  const ints = await distiller.distill({ agentId: p.id, persona: p.name, utterances: p.wants });
  for (const i of ints) { personaOf.set(i.id, p); all.push(i); }
}));
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

// ── report ──
const clearedPeople = new Set(deals.flatMap((d) => d.who));
console.log(`\n─ deals (${deals.length}) ─────────────────────────────────`);
for (const d of deals) console.log(`  ✓ ${d.kind.padEnd(6)} ${d.who.join(" ⇄ ")} — ${d.detail}`);
console.log(`\n─ fell through (${declines.length}) ──────────────────────`);
for (const x of declines) console.log(`  ✗ ${x}`);
const unmatched = personas.filter((p) => !clearedPeople.has(p.name));
console.log(`\n─ unmatched people (${unmatched.length}/${N}) ────────────────`);
for (const p of unmatched) console.log(`  · ${p.name}: ${p.wants.join(" / ")}`);

const sc = score(settlement, parties);
console.log(`\n─ metrics ─────────────────────────────────────────`);
console.log(`  people with a deal   ${clearedPeople.size}/${N}`);
console.log(`  solver coverage      ${Math.round(sc.coverage * 100)}% of intents   surplus ${sc.surplus}`);
console.log(`  groups ${groups.length}   rings ${rings.length}`);

// ── run log ── compact one-liner to a raw index; curated findings live in log.md
mkdirSync(join(process.cwd(), "runs"), { recursive: true });
const stamp = new Date().toISOString();
appendFileSync(join(process.cwd(), "runs", "index.md"),
  `${stamp} N=${N} ${process.env.MURMUR_MODEL ?? "haiku-4-5"} — deals ${deals.length} [${deals.map((d) => d.kind).join(",") || "none"}], cleared ${clearedPeople.size}/${N}, coverage ${Math.round(sc.coverage * 100)}%, groups ${groups.length}, rings ${rings.length}, fell ${declines.length}\n`);
console.log(`\n  logged to runs/index.md\n`);
