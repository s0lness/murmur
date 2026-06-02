import type { AgentSpec } from "../agent/agent";

/**
 * The non-commerce case that forces the abstraction to generalize past buy/sell.
 * Apartment swaps need a *double coincidence of wants* — the classic barter
 * problem — so most overlapping interest correctly fails to close. Exactly one
 * pair (NYC↔BER for June) reciprocates.
 */
export function apartmentSwap(): AgentSpec[] {
  const swap = (id: string, city: string, want: string): AgentSpec["intents"][number] => ({
    id,
    kind: "swap",
    domain: "housing.swap",
    tags: [`city:${city}`, `city:${want}`, "2026-06"],
    publicTags: [`city:${city}`, `city:${want}`, "2026-06"],
    region: "*",
    have: [`city:${city}`, "2026-06"],
    want: [`city:${want}`, "2026-06"],
  });

  return [
    { agentId: "alice-nyc", persona: "Alice — has NYC, wants Berlin (June)", intents: [swap("swap-1", "NYC", "BER")] },
    { agentId: "bjorn-ber", persona: "Björn — has Berlin, wants NYC (June)", intents: [swap("swap-2", "BER", "NYC")] },
    { agentId: "chloe-par", persona: "Chloé — has Paris, wants NYC (June)", intents: [swap("swap-3", "PAR", "NYC")] },
    { agentId: "dan-nyc", persona: "Dan — has NYC, wants Lisbon (June)", intents: [swap("swap-4", "NYC", "LIS")] },
  ];
}
