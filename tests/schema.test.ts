import { describe, expect, it } from "vitest";
import { DistilledIntent, score01 } from "../src/intake/schema";
import { Verdict } from "../src/matching/semanticMatcher";

// Issue #3: model-produced confidence/relevance scores must be bounded 0..1,
// even though the provider JSON schema stays permissive. Validated with no API.

const baseIntent = {
  kind: "seek", domain: "goods.games", tags: ["x"], publicTags: ["x"], region: "*",
  qty: 1, valuation: null, fallback: null, substitutes: [], have: [], want: [],
  confidence: 0.5, active: true, rationale: "r",
};

describe("score01 - clamp into [0,1]", () => {
  it("passes valid scores through", () => expect(score01.parse(0.7)).toBe(0.7));
  it("clamps above 1", () => expect(score01.parse(1.5)).toBe(1));
  it("clamps below 0", () => expect(score01.parse(-0.3)).toBe(0));
  it("coerces infinities to 0", () => {
    expect(score01.parse(Infinity)).toBe(0);
    expect(score01.parse(-Infinity)).toBe(0);
  });
  it("rejects NaN and non-numbers", () => {
    expect(() => score01.parse(NaN)).toThrow();
    expect(() => score01.parse("hi" as unknown as number)).toThrow();
  });
});

describe("DistilledIntent.confidence is bounded", () => {
  it("clamps an out-of-range model confidence", () => {
    expect(DistilledIntent.parse({ ...baseIntent, confidence: 4.2 }).confidence).toBe(1);
    expect(DistilledIntent.parse({ ...baseIntent, confidence: -1 }).confidence).toBe(0);
  });
  it("keeps a valid confidence", () => {
    expect(DistilledIntent.parse({ ...baseIntent, confidence: 0.83 }).confidence).toBe(0.83);
  });
});

describe("semantic-matcher Verdict.score is bounded", () => {
  const base = { signalId: "s", relevant: true, score: 0.5, reason: "r", clarify: "" };
  it("clamps an out-of-range relevance score", () => {
    expect(Verdict.parse({ ...base, score: 9 }).score).toBe(1);
    expect(Verdict.parse({ ...base, score: -2 }).score).toBe(0);
  });
});
