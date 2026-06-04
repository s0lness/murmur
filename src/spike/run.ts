import type { PrivateIntent } from "../core/intent";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { SYSTEM_PROMPT_VERBATIM } from "../intake/prompt";
import { keywordMatch } from "../matching/keywordMatcher";
import { SemanticMatcher, type Verdict } from "../matching/semanticMatcher";
import { GROUND_TRUTH, hardMarket } from "./scenario";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set (shell or murmur/.env).");
  process.exit(1);
}

const pairKey = (a: string, b: string) => [a, b].sort().join("  ⇄  ");
const gt = new Set(GROUND_TRUTH.map(([a, b]) => pairKey(a, b)));
const pct = (n: number) => `${Math.round(n * 100)}%`;

interface Sided { agentId: string; intent: PrivateIntent }
interface DistilledAgent { agentId: string; intents: PrivateIntent[] }

function score(pred: Set<string>) {
  const tp = [...pred].filter((p) => gt.has(p));
  const fp = [...pred].filter((p) => !gt.has(p));
  const fn = [...gt].filter((p) => !pred.has(p));
  const precision = pred.size ? tp.length / pred.size : 0;
  const recall = gt.size ? tp.length / gt.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, precision, recall, f1 };
}

const matcher = new SemanticMatcher();

async function evaluate(distilled: DistilledAgent[]) {
  const seeks: Sided[] = [];
  const offers: Sided[] = [];
  for (const d of distilled) {
    for (const i of d.intents) {
      if (i.kind === "seek") seeks.push({ agentId: d.agentId, intent: i });
      else if (i.kind === "offer") offers.push({ agentId: d.agentId, intent: i });
    }
  }
  const offerAgentByIntent = new Map(offers.map((o) => [o.intent.id, o.agentId]));

  // keyword baseline - swept to its BEST F1 (fairest shot)
  let bestKw = { t: 0, pairs: new Set<string>(), sc: score(new Set()) };
  for (const t of [0.05, 0.1, 0.15, 0.2, 0.25, 0.3]) {
    const pairs = new Set<string>();
    for (const s of seeks) for (const o of offers) {
      if (keywordMatch(s.intent, o.intent, t)) pairs.add(pairKey(s.agentId, o.agentId));
    }
    if (score(pairs).f1 > bestKw.sc.f1) bestKw = { t, pairs, sc: score(pairs) };
  }

  // semantic - over the same blurred signals
  const semPairs = new Set<string>();
  const semWhy: (Verdict & { pair: string })[] = [];
  for (const s of seeks) {
    const verdicts = await matcher.judge(s.intent, offers.map((o) => o.intent));
    for (const v of verdicts) {
      if (v.relevant && v.score >= 0.5) {
        const oa = offerAgentByIntent.get(v.signalId);
        if (oa) {
          const pk = pairKey(s.agentId, oa);
          semPairs.add(pk);
          semWhy.push({ ...v, pair: pk });
        }
      }
    }
  }
  return { keyword: bestKw, semantic: { pairs: semPairs, sc: score(semPairs), why: semWhy } };
}

console.log("\n▶ murmur spike v2 - isolating intake vs matcher (2×2)\n");

const normDistiller = new LLMDistiller();
const verbDistiller = new LLMDistiller({ system: SYSTEM_PROMPT_VERBATIM, cacheTag: "verbatim" });

const personas = hardMarket();
const [normalized, verbatim] = await Promise.all([
  Promise.all(personas.map(async (p) => ({ agentId: p.agentId, intents: await normDistiller.distill(p) }))),
  Promise.all(personas.map(async (p) => ({ agentId: p.agentId, intents: await verbDistiller.distill(p) }))),
]);

// Show how intake changed the tags for a few telling agents.
console.log("─ how intake re-tagged (normalized ⟵ verbatim) ───");
for (const id of ["sofa-seller-fr", "bike-buyer-fr", "drill-seller-de", "handheld-buyer"]) {
  const n = normalized.find((d) => d.agentId === id)?.intents[0];
  const v = verbatim.find((d) => d.agentId === id)?.intents[0];
  const tg = (i?: PrivateIntent) => (i ? (i.publicTags ?? i.tags).join(", ") : "-");
  console.log(`  ${id.padEnd(18)} norm:[${tg(n)}]\n  ${" ".padEnd(18)} verb:[${tg(v)}]`);
}

const [normEval, verbEval] = [await evaluate(normalized), await evaluate(verbatim)];

// ── 2×2 F1 table ──
console.log(`\n─ F1 (vs ${gt.size} ground-truth matches) ─────────────`);
console.log("                          keyword     semantic");
const row = (label: string, kw: number, sem: number) =>
  `  ${label.padEnd(22)} ${pct(kw).padStart(5)}       ${pct(sem).padStart(5)}`;
console.log(row("intake normalized", normEval.keyword.sc.f1, normEval.semantic.sc.f1));
console.log(row("intake verbatim", verbEval.keyword.sc.f1, verbEval.semantic.sc.f1));

// ── the decomposition ──
const intakeLift = normEval.keyword.sc.f1 - verbEval.keyword.sc.f1;
const matcherLift = verbEval.semantic.sc.f1 - verbEval.keyword.sc.f1;
console.log(`\n─ decomposition ──────────────────────────────────`);
console.log(`  intake's contribution   keyword: verbatim ${pct(verbEval.keyword.sc.f1)} → normalized ${pct(normEval.keyword.sc.f1)}   (+${pct(intakeLift)})`);
console.log(`  matcher's contribution  verbatim: keyword ${pct(verbEval.keyword.sc.f1)} → semantic ${pct(verbEval.semantic.sc.f1)}   (+${pct(matcherLift)})`);

// ── precision: did the traps fire? ──
console.log(`\n─ trap precision (false positives) ───────────────`);
const fpLine = (label: string, fps: string[]) =>
  `  ${label.padEnd(26)} ${fps.length === 0 ? "(clean)" : fps.join("  ·  ")}`;
console.log(fpLine("keyword / normalized", normEval.keyword.sc.fp));
console.log(fpLine("keyword / verbatim", verbEval.keyword.sc.fp));
console.log(fpLine("semantic / normalized", normEval.semantic.sc.fp));
console.log(fpLine("semantic / verbatim", verbEval.semantic.sc.fp));

// ── what semantic caught that verbatim-keyword missed (the matcher's real power) ──
console.log(`\n─ matches semantic caught with NO intake help ────`);
const caught = [...verbEval.semantic.pairs].filter((p) => gt.has(p) && !verbEval.keyword.pairs.has(p));
if (caught.length === 0) console.log("  (none)");
for (const p of caught) {
  const why = verbEval.semantic.why.find((w) => w.pair === p);
  console.log(`  ✓ ${p}\n      ↳ ${why?.reason ?? ""}`);
}

console.log(`\n─ verdict ─────────────────────────────────────────`);
console.log(`  intake (the distiller) carries ${intakeLift >= matcherLift ? "MORE" : "less"} of the semantic load than the matcher.`);
console.log(`  semantic matcher's standalone F1: normalized ${pct(normEval.semantic.sc.f1)}, verbatim ${pct(verbEval.semantic.sc.f1)}.`);
console.log("");
