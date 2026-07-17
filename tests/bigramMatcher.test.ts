import { describe, expect, it } from "vitest";
import { bigramScore, normalize } from "../src/matching/bigramMatcher";
import { keywordScore } from "../src/matching/keywordMatcher";

describe("bigramMatcher", () => {
  it("normalizes diacritics and punctuation", () => {
    expect(normalize(["Vélos", "de course!"])).toBe("velos de course");
  });

  it("scores identical tag sets 1", () => {
    expect(bigramScore(["road bike"], ["road bike"])).toBe(1);
  });

  it("rescues morphological variants that token Jaccard misses", () => {
    // Different tokens -> keyword Jaccard is 0, yet they are the same thing.
    expect(keywordScore(["velo"], ["vélos"])).toBe(0);
    expect(bigramScore(["velo"], ["vélos"])).toBeGreaterThan(0.5);
  });

  it("rescues spacing variants", () => {
    expect(keywordScore(["iphone 13"], ["iphone13"])).toBe(0);
    expect(bigramScore(["iphone 13"], ["iphone13"])).toBeGreaterThan(0.7);
  });

  it("stays low for unrelated tags", () => {
    expect(bigramScore(["road bike"], ["kitchen table"])).toBeLessThan(0.3);
  });

  it("returns 0 when either side is empty", () => {
    expect(bigramScore([], ["anything"])).toBe(0);
    expect(bigramScore(["anything"], [])).toBe(0);
  });
});
