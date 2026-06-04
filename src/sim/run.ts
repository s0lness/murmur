import { SCENARIOS } from "../scenarios";
import { buildWorld } from "./build";
import { computeMetrics, formatReport } from "./metrics";

const name = process.argv[2] ?? "switch-sale";
const build = SCENARIOS[name];
if (!build) {
  console.error(`unknown scenario: ${name}\noptions: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}

console.log(`\n▶ murmur - scenario: ${name}`);
const world = buildWorld(build());
world.run();
console.log(formatReport(computeMetrics(world.log, world.agents)));
