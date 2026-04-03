import { describe, it, expect } from "vitest";
import { RelevanceScorer } from "./relevance-scorer.js";
import { Dedupe } from "./dedupe.js";

describe("RelevanceScorer", () => {
  const scorer = new RelevanceScorer();

  it("should score high overlap content highly", async () => {
    const goal = "Find information about climate change and carbon taxes.";
    const content =
      "Climate change is a global issue. Many countries are implementing carbon taxes to reduce emissions.";
    const score = await scorer.score(content, goal);
    expect(score).toBeGreaterThan(0.5);
  });

  it("should score low overlap content lowly", async () => {
    const goal = "Find information about climate change.";
    const content = "The recipe for chocolate cake includes flour, sugar, and cocoa.";
    const score = await scorer.score(content, goal);
    expect(score).toBeLessThan(0.1);
  });
});

describe("Dedupe", () => {
  const dedupeEngine = new Dedupe();

  it("should remove duplicate sections", () => {
    const markdown = "Section 1\n\nSection 1\n\nSection 2";
    const deduped = dedupeEngine.dedupe(markdown);
    expect(deduped).toBe("Section 1\n\nSection 2");
  });

  it("should keep unique sections", () => {
    const markdown = "Section 1\n\nSection 2\n\nSection 3";
    const deduped = dedupeEngine.dedupe(markdown);
    expect(deduped).toBe("Section 1\n\nSection 2\n\nSection 3");
  });
});
