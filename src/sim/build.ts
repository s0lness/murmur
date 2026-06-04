import { Agent, type AgentSpec } from "../agent/agent";
import { RuleBrain } from "../agent/ruleBrain";
import { makeIdentity } from "../core/identity";
import { World } from "./world";

/** Wire a set of agent specs into a runnable world. Shared by the CLI and tests. */
export function buildWorld(specs: AgentSpec[]): World {
  // Session identity binds on signal id (= intent id), so an agent's intent ids
  // MUST be unique - a duplicate would make two listings indistinguishable and
  // route a negotiation to the wrong one. Store-generated ids are always unique;
  // this guards hand-authored scenarios/tests.
  for (const spec of specs) {
    const ids = spec.intents.map((i) => i.id);
    const dupe = ids.find((id, k) => ids.indexOf(id) !== k);
    if (dupe) throw new Error(`buildWorld: agent "${spec.agentId}" has duplicate intent id "${dupe}"`);
  }

  const world = new World();
  for (const spec of specs) {
    const identity = makeIdentity(spec.agentId);
    world.add(new Agent(identity, spec.persona, spec.intents, new RuleBrain(), world.bus, world.ctx));
  }
  return world;
}
