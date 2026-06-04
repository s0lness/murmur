import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSpec } from "../agent/agent";
import type { PersonaUtterances } from "../intake/distiller";
import { LLMDistiller } from "../intake/llmDistiller";
import { ambientJournal, ambientMarket } from "../intake/scenarios";
import { buildWorld } from "./build";
import { computeMetrics, formatReport } from "./metrics";

// Optional convenience: load murmur/.env if present. Never commit it (gitignored).
try {
  const env = readFileSync(join(process.cwd(), ".env"), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !process.env[m[1]]) {
      process.env[m[1]] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
} catch {
  /* no .env file - rely on the ambient environment */
}

const scenarios: Record<string, () => PersonaUtterances[]> = {
  "ambient-market": ambientMarket,
  "ambient-journal": ambientJournal,
};

const name = process.argv[2] ?? "ambient-market";
const build = scenarios[name];
if (!build) {
  console.error(`unknown scenario: ${name}\noptions: ${Object.keys(scenarios).join(", ")}`);
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "ANTHROPIC_API_KEY is not set.\n" +
      "Set it for this shell:  $env:ANTHROPIC_API_KEY = \"sk-ant-...\"\n" +
      "or drop it in murmur/.env as  ANTHROPIC_API_KEY=sk-ant-...  (gitignored).",
  );
  process.exit(1);
}

const personas = build();
const distiller = new LLMDistiller();

console.log(`\n▶ murmur - distilling ${personas.length} personas (${name})…\n`);

// Intake phase: words → structured intents, concurrently.
const specs: AgentSpec[] = await Promise.all(
  personas.map(async (p): Promise<AgentSpec> => {
    try {
      const intents = await distiller.distill(p);
      return { agentId: p.agentId, persona: p.persona, intents };
    } catch (err) {
      console.warn(`   ⚠ distill failed for ${p.agentId}: ${(err as Error).message}`);
      return { agentId: p.agentId, persona: p.persona, intents: [] };
    }
  }),
);

// Show the distillation funnel in the terminal (the viewer renders it richly).
for (const spec of specs) {
  console.log(`◆ ${spec.persona} (${spec.agentId})`);
  for (const i of spec.intents) {
    const flag = i.active === false ? "held " : "LIVE ";
    const price = i.valuation !== undefined ? ` · reserve ${i.valuation}` : "";
    console.log(
      `   ${flag} ${i.kind.toUpperCase()} ${i.domain} ` +
        `[${(i.publicTags ?? i.tags).join(", ")}] @ ${i.region}` +
        ` · conf ${Math.round((i.confidence ?? 1) * 100)}%${price}`,
    );
  }
  if (spec.intents.length === 0) console.log("   (no intent - correctly silent)");
}

// Run the (unchanged) sim on the distilled intents.
const world = buildWorld(specs);
world.run();

// Record with provenance for the viewer: raw utterances → distilled → broadcast.
const uttById = new Map(personas.map((p) => [p.agentId, p.utterances]));
const recording = {
  scenario: name,
  agents: world.agents.map((a) => ({
    id: a.id,
    persona: a.persona,
    pseudonym: a.pseudonym,
    utterances: uttById.get(a.id) ?? [],
    intents: a.getIntents(),
  })),
  events: world.log.all(),
  metrics: computeMetrics(world.log, world.agents),
};
const dir = join(process.cwd(), "viewer");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "recording.js"), `window.RECORDING = ${JSON.stringify(recording)};\n`);

console.log(formatReport(computeMetrics(world.log, world.agents)));
console.log(`recorded -> viewer/recording.js  ·  open the viewer to replay\n`);
