import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCENARIOS } from "../scenarios";
import { buildWorld } from "./build";
import { computeMetrics } from "./metrics";

const name = process.argv[2] ?? "switch-sale";
const build = SCENARIOS[name];
if (!build) {
  console.error(`unknown scenario: ${name}\noptions: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}

const world = buildWorld(build());
world.run();

/** Includes the agents' *private* intents — the viewer hides the sensitive
 *  fields unless you flip on god mode, which is the whole point of the demo. */
const recording = {
  scenario: name,
  agents: world.agents.map((a) => ({
    id: a.id,
    persona: a.persona,
    pseudonym: a.pseudonym,
    intents: a.getIntents(),
  })),
  events: world.log.all(),
  metrics: computeMetrics(world.log, world.agents),
};

const dir = join(process.cwd(), "viewer");
mkdirSync(dir, { recursive: true });
const out = join(dir, "recording.js");
writeFileSync(out, `window.RECORDING = ${JSON.stringify(recording)};\n`);

console.log(`recorded ${recording.events.length} events (${name}) -> viewer/recording.js`);
console.log(`open viewer/index.html in a browser to replay it`);
