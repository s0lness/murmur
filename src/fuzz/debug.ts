import { type PrivateIntent } from "../core/intent";
import { normalizePool } from "../eval/normalize";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { type Party } from "../multilateral/detect";
import { solve } from "../solver/solve";
import { makePersonas } from "./persona";

loadDotenv();
const N = Number(process.argv[2]) || 30;
const NORM = process.argv.includes("norm");
const distiller = new LLMDistiller();
const tags = (i: PrivateIntent) => (i.publicTags ?? i.tags).map((t) => t.toLowerCase());

const personas = await makePersonas(N);
const nameOf = new Map<string, string>();
const all: PrivateIntent[] = [];
await Promise.all(personas.map(async (p) => {
  const ints = await distiller.distill({ agentId: p.id, persona: p.name, utterances: p.wants });
  for (const i of ints) { nameOf.set(i.id, p.name); all.push(i); }
}));

if (NORM) {
  const norm = await normalizePool(all.map((i) => ({ id: i.id, kind: i.kind, domain: i.domain, tags: i.publicTags ?? i.tags, have: i.have ?? [], want: i.want ?? [] })));
  for (const i of all) { const o = norm.get(i.id); if (o) { i.domain = o.domain; i.tags = o.tags; i.publicTags = o.tags; } }
}

const parties: Party[] = all.filter((i) => i.active !== false).map((i) => ({ id: i.id, intent: i }));
const byId = new Map(all.map((i) => [i.id, i]));

console.log(`\nCommerce trades (${NORM ? "norm" : "raw"}), with the overlapping token:\n`);
for (const t of solve(parties, "coverage").trades) {
  if (t.kind !== "commerce") continue;
  const b = byId.get(t.buyer)!, s = byId.get(t.seller)!;
  const bset = new Set([...tags(b), ...(b.substitutes ?? []).map((x) => x.toLowerCase())]);
  const overlap = tags(s).filter((x) => bset.has(x));
  console.log(`  ${nameOf.get(t.buyer)} (wants [${tags(b).join(",")}]) ⇄ ${nameOf.get(t.seller)} (offers [${tags(s).join(",")}])`);
  console.log(`      ↳ matched on: [${overlap.join(", ")}]\n`);
}
