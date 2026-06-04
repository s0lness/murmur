import { describe, expect, it } from "vitest";
import type { AgentSpec } from "../src/agent/agent";
import { buildWorld } from "../src/sim/build";
import { computeMetrics } from "../src/sim/metrics";

// Issue #1: when the SAME two agents have multiple intents in ONE domain, each
// match must get its own session. Before the fix the session key was just
// domain + the two pseudonyms, so the second match was suppressed as "already
// engaged" and the responder bound to the wrong (first-in-domain) intent.

function twoConsolesOneShop(): AgentSpec[] {
  return [
    {
      agentId: "shop",
      persona: "Shop selling two consoles",
      intents: [
        { id: "off-switch", kind: "offer", domain: "goods.games", tags: ["nintendo", "switch"], region: "*", valuation: 180 },
        { id: "off-ps5", kind: "offer", domain: "goods.games", tags: ["sony", "ps5"], region: "*", valuation: 350 },
      ],
    },
    {
      agentId: "buyer",
      persona: "Buyer wants both",
      intents: [
        { id: "seek-switch", kind: "seek", domain: "goods.games", tags: ["nintendo", "switch"], region: "*", valuation: 240 },
        { id: "seek-ps5", kind: "seek", domain: "goods.games", tags: ["sony", "ps5"], region: "*", valuation: 430 },
      ],
    },
  ];
}

describe("multi-intent agents in one domain (issue #1)", () => {
  const world = buildWorld(twoConsolesOneShop());
  world.run();
  const m = computeMetrics(world.log, world.agents);
  const prices = world.log.byType("deal_closed").map((d) => d.price ?? 0);

  it("closes BOTH deals instead of suppressing the second", () => {
    expect(m.deals).toBe(2);
  });

  it("opens two distinct sessions between the same pair", () => {
    const ids = new Set(world.log.byType("negotiation_opened").map((o) => o.sessionId));
    expect(ids.size).toBe(2);
  });

  it("binds each deal to the correct intent (exactly one in each ZOPA band)", () => {
    // Wrong binding (both to the first-in-domain intent) would put both prices
    // in one band. Correct binding => exactly one price in the switch ZOPA
    // [180,240] and exactly one in the ps5 ZOPA [350,430].
    expect(prices.filter((p) => p >= 180 && p <= 240)).toHaveLength(1);
    expect(prices.filter((p) => p >= 350 && p <= 430)).toHaveLength(1);
  });
});
