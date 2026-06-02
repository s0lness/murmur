import type { AgentSpec } from "../agent/agent";

/**
 * The original clawlist case, generalized. A used Switch in Paris should find
 * its buyer; out-of-region and out-of-budget interest should surface and then
 * fail in negotiation; unrelated wants should never make contact at all.
 */
export function switchSale(): AgentSpec[] {
  return [
    {
      agentId: "seller-fr-switch",
      persona: "Paris — selling a used Switch",
      intents: [{ id: "sig-1", kind: "offer", domain: "goods.games", tags: ["nintendo", "switch", "console"], region: "FR-75", valuation: 180 }],
    },
    {
      agentId: "buyer-fr-switch",
      persona: "Lyon — wants a Switch",
      intents: [{ id: "sig-2", kind: "seek", domain: "goods.games", tags: ["nintendo", "switch", "console"], region: "FR", valuation: 240 }],
    },
    {
      agentId: "buyer-fr-lowball",
      persona: "Bargain hunter — hard ceiling at 150",
      intents: [{ id: "sig-3", kind: "seek", domain: "goods.games", tags: ["nintendo", "switch"], region: "FR", valuation: 150 }],
    },
    {
      agentId: "buyer-de-switch",
      persona: "Berlin — wants a Switch (out of region)",
      intents: [{ id: "sig-4", kind: "seek", domain: "goods.games", tags: ["nintendo", "switch", "console"], region: "DE", valuation: 260 }],
    },
    {
      agentId: "seller-us-ps5",
      persona: "NYC — selling a PS5",
      intents: [{ id: "sig-5", kind: "offer", domain: "goods.games", tags: ["sony", "ps5", "console"], region: "US-NY", valuation: 350 }],
    },
    {
      agentId: "buyer-us-ps5",
      persona: "US — wants a PS5",
      intents: [{ id: "sig-6", kind: "seek", domain: "goods.games", tags: ["sony", "ps5", "console"], region: "US", valuation: 430 }],
    },
    {
      agentId: "buyer-fr-iphone",
      persona: "Noise — wants an iPhone",
      intents: [{ id: "sig-7", kind: "seek", domain: "goods.phones", tags: ["apple", "iphone"], region: "FR", valuation: 600 }],
    },
  ];
}
