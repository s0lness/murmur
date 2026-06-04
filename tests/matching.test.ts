import { describe, expect, it } from "vitest";
import type { PrivateIntent } from "../src/core/intent";
import { barterCycles, groupBuys, type Party } from "../src/multilateral/detect";
import { score, solve } from "../src/solver/solve";

const seek = (id: string, tags: string[], max?: number, opts: { subs?: string[]; fallback?: number } = {}): Party =>
  ({ id, intent: { id, kind: "seek", domain: "d", tags, region: "*", valuation: max, fallback: opts.fallback, substitutes: opts.subs } as PrivateIntent });
const offer = (id: string, tags: string[], min?: number, qty = 1): Party =>
  ({ id, intent: { id, kind: "offer", domain: "d", tags, region: "*", valuation: min, qty } as PrivateIntent });
const swap = (id: string, have: string[], want: string[]): Party =>
  ({ id, intent: { id, kind: "swap", domain: "swap", tags: [...have, ...want], region: "*", have, want } as PrivateIntent });

const buyers = (s: ReturnType<typeof groupBuys>, sellerId: string) =>
  s.find((g) => g.offer.id === sellerId)?.buyers.map((b) => b.id) ?? null;
const ringIds = (rs: ReturnType<typeof barterCycles>) => rs.filter((r) => r.members.length >= 3).map((r) => new Set(r.members.map((m) => m.id)));
const matchedPairs = (ps: Party[]) =>
  new Set(solve(ps, "coverage").trades.flatMap((t) => (t.kind === "commerce" ? [[t.buyer, t.seller].sort().join("|")] : [])));

describe("group-buys", () => {
  it("does NOT group a single-unit offer with multiple buyers", () => {
    const ps = [offer("s", ["switch"], 100, 1), seek("a", ["switch"], 200), seek("b", ["switch"], 200)];
    expect(groupBuys(ps)).toHaveLength(0);
  });
  it("groups a bulk offer (qty>=2) with >=2 buyers", () => {
    const ps = [offer("s", ["tshirt"], 10, 5), seek("a", ["tshirt"]), seek("b", ["tshirt"]), seek("c", ["tshirt"])];
    expect(buyers(groupBuys(ps), "s")).toEqual(expect.arrayContaining(["a", "b", "c"]));
  });
  it("clusters across domain drift via tag overlap (seller vs buyer different domain labels)", () => {
    const ps = [
      { id: "s", intent: { id: "s", kind: "offer", domain: "goods.misc", tags: ["concert", "tickets", "friday"], region: "*", qty: 8 } as PrivateIntent },
      { id: "a", intent: { id: "a", kind: "seek", domain: "social.event_companion", tags: ["concert", "ticket", "friday"], region: "*" } as PrivateIntent },
      { id: "b", intent: { id: "b", kind: "seek", domain: "social.event_companion", tags: ["concert", "ticket", "friday"], region: "*" } as PrivateIntent },
    ];
    expect(buyers(groupBuys(ps), "s")).toEqual(expect.arrayContaining(["a", "b"]));
  });
});

describe("barter rings", () => {
  it("detects a 3-cycle", () => {
    const ps = [swap("p1", ["sword"], ["shield"]), swap("p2", ["shield"], ["potion"]), swap("p3", ["potion"], ["sword"])];
    const rs = ringIds(barterCycles(ps));
    expect(rs.some((s) => s.size === 3)).toBe(true);
  });
  it("tolerates token drift (ps5:forza vs forza)", () => {
    const ps = [swap("p1", ["ps5:spider-man"], ["ps5:forza"]), swap("p2", ["forza"], ["call-of-duty"]), swap("p3", ["call-of-duty"], ["spider-man"])];
    expect(ringIds(barterCycles(ps)).some((s) => s.size === 3)).toBe(true);
  });
  it("does NOT invent a ring when the loop does not close", () => {
    const ps = [swap("p1", ["map"], ["compass"]), swap("p2", ["compass"], ["torch"])];
    expect(ringIds(barterCycles(ps))).toHaveLength(0);
  });
});

describe("solver: IR, substitutes, coverage", () => {
  it("excludes a buyer whose fallback beats the seller floor (IR)", () => {
    const ps = [offer("s", ["switch"], 200), seek("b", ["switch"], 300, { fallback: 150 })];
    expect(matchedPairs(ps).has("b|s")).toBe(false);
  });
  it("matches via a substitute edge", () => {
    const ps = [offer("s", ["vita"], 100), seek("b", ["switch"], 200, { subs: ["vita"] })];
    expect(matchedPairs(ps).has("b|s")).toBe(true);
  });
  it("coverage strategy clears more than greedy-by-surplus", () => {
    const ps = [offer("lamp", ["lamp"], 10), offer("rug", ["rug"], 10), seek("flex", ["lamp"], 120, { subs: ["rug"] }), seek("only", ["lamp"], 100)];
    const cov = score(solve(ps, "coverage"), ps);
    const sur = score(solve(ps, "surplus"), ps);
    expect(cov.cleared).toBeGreaterThan(sur.cleared);
  });
});
