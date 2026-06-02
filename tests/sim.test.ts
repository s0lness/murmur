import { describe, expect, it } from "vitest";
import { blur, type PrivateIntent } from "../src/core/intent";
import { apartmentSwap } from "../src/scenarios/apartment-swap";
import { switchSale } from "../src/scenarios/switch-sale";
import { buildWorld } from "../src/sim/build";
import { computeMetrics } from "../src/sim/metrics";

describe("blur (the privacy boundary)", () => {
  it("never leaks price, valuation, or have/want to the public signal", () => {
    const intent: PrivateIntent = {
      id: "x", kind: "offer", domain: "goods.games",
      tags: ["nintendo", "switch"], region: "FR-75", valuation: 180,
      have: ["secret"], want: ["secret"],
    };
    const signal = blur(intent, "anon-1");
    const json = JSON.stringify(signal);
    expect(json).not.toContain("180");
    expect(json).not.toContain("secret");
    expect(signal).not.toHaveProperty("valuation");
  });
});

describe("switch-sale scenario", () => {
  const world = buildWorld(switchSale());
  world.run();
  const m = computeMetrics(world.log, world.agents);

  it("closes the FR switch deal and the US ps5 deal", () => {
    expect(m.deals).toBe(2);
  });
  it("captures positive surplus", () => {
    expect(m.realizedSurplus).toBeGreaterThan(0);
  });
  it("surfaces a failed negotiation (lowball buyer, empty ZOPA)", () => {
    expect(m.failed).toBeGreaterThanOrEqual(1);
  });
  it("never contacts out-of-domain noise (iPhone buyer)", () => {
    const contactedPseudos = world.log.byType("interest").map((e) => e.towards);
    const iphone = world.agents.find((a) => a.id === "buyer-fr-iphone")!;
    expect(contactedPseudos).not.toContain(iphone.pseudonym);
  });
});

describe("apartment-swap scenario", () => {
  const world = buildWorld(apartmentSwap());
  world.run();
  const m = computeMetrics(world.log, world.agents);

  it("closes exactly the one reciprocal swap (NYC<->BER)", () => {
    expect(m.deals).toBe(1);
  });
  it("fails the non-reciprocal overlaps (double-coincidence problem)", () => {
    expect(m.failed).toBeGreaterThanOrEqual(1);
  });
});
