import { describe, expect, it } from "vitest";
import type { PrivateIntent } from "../src/core/intent";
import { clearer, ENRICH_THRESHOLD, needsEnrich } from "../src/intake/enrich";

const base = (over: Partial<PrivateIntent> = {}): PrivateIntent => ({
  id: "x", kind: "seek", domain: "goods.misc", tags: ["monitor"], region: "*",
  confidence: 0.4, active: true, ...over,
});

describe("needsEnrich", () => {
  it("fires on a low-confidence active intent", () => {
    expect(needsEnrich(base({ confidence: 0.3 }))).toBe(true);
  });
  it("skips a confident intent", () => {
    expect(needsEnrich(base({ confidence: 0.9 }))).toBe(false);
  });
  it("skips a held (active:false) intent regardless of confidence", () => {
    expect(needsEnrich(base({ confidence: 0.1, active: false }))).toBe(false);
  });
  it("treats missing confidence as fully confident (no spend)", () => {
    expect(needsEnrich(base({ confidence: undefined }))).toBe(false);
  });
  it("respects the threshold boundary", () => {
    expect(needsEnrich(base({ confidence: ENRICH_THRESHOLD }))).toBe(false);
    expect(needsEnrich(base({ confidence: ENRICH_THRESHOLD - 0.01 }))).toBe(true);
  });
});

describe("clearer", () => {
  it("keeps a candidate that raised confidence", () => {
    expect(clearer(base({ confidence: 0.4 }), base({ confidence: 0.6 }))).toBe(true);
  });
  it("rejects a candidate that notably dropped confidence", () => {
    expect(clearer(base({ confidence: 0.6 }), base({ confidence: 0.4 }))).toBe(false);
  });
  it("on a confidence tie, prefers the more-constrained candidate", () => {
    const orig = base({ confidence: 0.4, region: "*", tags: ["monitor"] });
    const cand = base({ confidence: 0.4, region: "FR-75", tags: ["monitor", "27-inch"], valuation: 80 });
    expect(clearer(orig, cand)).toBe(true);
  });
  it("on a tie with no added constraint, keeps the original", () => {
    const same = base({ confidence: 0.4 });
    expect(clearer(same, base({ confidence: 0.4 }))).toBe(false);
  });
  it("does not accept a candidate that is less constrained at equal confidence", () => {
    const orig = base({ confidence: 0.4, tags: ["monitor", "27-inch"], valuation: 80 });
    const cand = base({ confidence: 0.4, tags: ["monitor"], valuation: undefined });
    expect(clearer(orig, cand)).toBe(false);
  });
});
