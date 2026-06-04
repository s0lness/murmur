import type { PrivateIntent } from "../core/intent";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { barterCycles, groupBuys, type Party } from "../multilateral/detect";
import { solve } from "../solver/solve";
import { type NormOut, normalizePool } from "./normalize";
import { type EvalScenario, SCENARIOS } from "./scenarios";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY not set."); process.exit(1); }
const distiller = new LLMDistiller();
const autoFix = process.argv.includes("--fix");

const pairKey = (a: string, b: string) => [a, b].sort().join("|");
const superset = (act: Set<string>, want: string[]) => want.every((id) => act.has(id));
const sameSet = (act: Set<string>, arr: string[]) => act.size === arr.length && arr.every((id) => act.has(id));

interface Failure { kind: "match" | "group" | "ring" | "unexpected"; ids: string[]; why?: string }

async function distillAll(sc: EvalScenario): Promise<Map<string, PrivateIntent>> {
  const map = new Map<string, PrivateIntent>();
  await Promise.all(sc.agents.map(async (a) => {
    const intents = await distiller.distill({ agentId: a.id, persona: "a user", utterances: [a.say] });
    const i = intents.find((x) => x.active !== false) ?? intents[0];
    if (i) map.set(a.id, i);
  }));
  return map;
}

function parties(map: Map<string, PrivateIntent>): Party[] {
  return [...map].map(([id, intent]) => ({ id, intent }));
}

function check(sc: EvalScenario, map: Map<string, PrivateIntent>): Failure[] {
  const ps = parties(map);
  const matches = new Set<string>();
  for (const t of solve(ps, "coverage").trades) if (t.kind === "commerce") matches.add(pairKey(t.buyer, t.seller));
  const groups = groupBuys(ps).map((g) => new Set([g.offer.id, ...g.buyers.map((b) => b.id)]));
  const rings = barterCycles(ps).filter((r) => r.members.length >= 3).map((r) => new Set(r.members.map((m) => m.id)));

  const out: Failure[] = [];
  for (const [a, b] of sc.expect.matches ?? []) if (!matches.has(pairKey(a, b))) out.push({ kind: "match", ids: [a, b] });
  for (const g of sc.expect.groups ?? []) if (!groups.some((act) => superset(act, g))) out.push({ kind: "group", ids: g });
  for (const r of sc.expect.rings ?? []) if (!rings.some((act) => sameSet(act, r))) out.push({ kind: "ring", ids: r });
  for (const [a, b] of sc.expect.noMatch ?? []) {
    const connected = matches.has(pairKey(a, b)) || groups.some((s) => s.has(a) && s.has(b)) || rings.some((s) => s.has(a) && s.has(b));
    if (connected) out.push({ kind: "unexpected", ids: [a, b] });
  }
  return out.map((f) => ({ ...f, why: diagnose(f, map) }));
}

function diagnose(f: Failure, map: Map<string, PrivateIntent>): string {
  if (f.kind === "unexpected") return "connected but should not have";
  const ins = f.ids.map((id) => map.get(id)).filter((x): x is PrivateIntent => !!x);
  const domains = new Set(ins.map((i) => i.domain));
  if (domains.size > 1) return `domain mismatch (${f.ids.map((id) => `${id}=${map.get(id)?.domain}`).join(", ")})`;
  if (f.kind === "ring") {
    const tok = (xs: string[] = []) => xs.flatMap((t) => t.toLowerCase().split(/[^a-z0-9]+/)).filter((w) => w.length >= 3);
    const allHave = new Set(ins.flatMap((i) => tok(i.have)));
    const unmet = ins.filter((i) => !tok(i.want).some((w) => allHave.has(w)));
    if (unmet.length) return `want/have token mismatch (e.g. ${unmet[0]?.id}: want [${(unmet[0]?.want ?? []).join(",")}])`;
  }
  return "no shared tokens / IR — check tags, valuation, fallback";
}

console.log(`\n▶ murmur eval (${SCENARIOS.length} scenarios, model ${process.env.MURMUR_MODEL ?? "haiku-4-5"}${autoFix ? ", auto-fix ON" : ""})\n`);
let passed = 0;
let fixed = 0;
for (const sc of SCENARIOS) {
  const map = await distillAll(sc);
  let failures = check(sc, map);

  let note = "";
  if (failures.length && autoFix) {
    const norm = await normalizePool([...map].map(([id, i]) => ({ id, kind: i.kind, domain: i.domain, tags: i.publicTags ?? i.tags, have: i.have ?? [], want: i.want ?? [] })));
    for (const [id, i] of map) {
      const n: NormOut | undefined = norm.get(id);
      if (n) map.set(id, { ...i, domain: n.domain, tags: n.tags, publicTags: n.tags, have: n.have.length ? n.have : undefined, want: n.want.length ? n.want : undefined });
    }
    const after = check(sc, map);
    if (after.length === 0) { note = "  → auto-fixed ✓"; failures = after; fixed++; }
    else { note = `  → auto-fix did not resolve`; failures = after; }
  }

  if (failures.length === 0) { console.log(`  ✓ ${sc.name}${note}`); passed++; }
  else {
    console.log(`  ✗ ${sc.name}${note}`);
    for (const f of failures) console.log(`      ${f.kind} [${f.ids.join(", ")}] — ${f.why}`);
  }
}
console.log(`\n  ${passed}/${SCENARIOS.length} passed${autoFix ? ` (${fixed} via auto-fix)` : ""}.\n`);
