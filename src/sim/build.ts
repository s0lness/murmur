import { Agent, type AgentSpec } from "../agent/agent";
import { RuleBrain } from "../agent/ruleBrain";
import { makeIdentity } from "../core/identity";
import { World } from "./world";

/** Wire a set of agent specs into a runnable world. Shared by the CLI and tests. */
export function buildWorld(specs: AgentSpec[]): World {
  const world = new World();
  for (const spec of specs) {
    const identity = makeIdentity(spec.agentId);
    world.add(new Agent(identity, spec.persona, spec.intents, new RuleBrain(), world.bus, world.ctx));
  }
  return world;
}
