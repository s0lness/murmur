import type { AgentSpec } from "../agent/agent";
import { apartmentSwap } from "./apartment-swap";
import { switchSale } from "./switch-sale";

export const SCENARIOS: Record<string, () => AgentSpec[]> = {
  "switch-sale": switchSale,
  "apartment-swap": apartmentSwap,
};
