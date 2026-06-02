import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDotenv } from "../intake/env";
import { LLMDistiller } from "../intake/llmDistiller";
import { mixedMarket } from "../intake/scenarios";
import { type AgentInput, runPipeline } from "./charter-pipeline";

loadDotenv();
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY not set (shell or murmur/.env).");
  process.exit(1);
}

const distiller = new LLMDistiller();
const personas = mixedMarket();
const agents: AgentInput[] = await Promise.all(
  personas.map(async (p) => ({
    agentId: p.agentId,
    persona: p.persona,
    utterances: p.utterances,
    intents: await distiller.distill(p),
  })),
);

const result = runPipeline(agents);
const recording = { agents, ...result };

const dir = join(process.cwd(), "viewer");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "pipeline.js"), `window.PIPELINE = ${JSON.stringify(recording)};\n`);
console.log("recorded -> viewer/pipeline.js  ·  open /pipeline.html");
