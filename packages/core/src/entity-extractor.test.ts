import { describe, it, expect, vi } from "vitest";
import { EntityExtractor } from "./entity-extractor.js";
import type { ModelRouterImpl } from "./model-router.js";

describe("EntityExtractor", () => {
  it("extracts entities, summary, and category correctly from JSON response", async () => {
    const mockRouter = {
      generate: vi.fn().mockResolvedValue('{"summary":"Mock sum","entities":["e1","e2"],"category":"decision"}'),
    } as unknown as ModelRouterImpl;

    const extractor = new EntityExtractor(mockRouter);
    const result = await extractor.extract("Some raw text that contains a decision.");

    expect(result.summary).toBe("Mock sum");
    expect(result.entities).toEqual(["e1", "e2"]);
    expect(result.category).toBe("decision");
    expect(mockRouter.generate).toHaveBeenCalled();
  });

  it("falls back to heuristics if JSON parsing fails", async () => {
    const mockRouter = {
      generate: vi.fn().mockRejectedValue(new Error("Router error")),
    } as unknown as ModelRouterImpl;

    const extractor = new EntityExtractor(mockRouter);
    const result = await extractor.extract("We decided to fail fast.");

    expect(result.summary).toContain("We decided to fail fast.");
    expect(result.category).toBe("context");
    expect(result.entities.length).toBeGreaterThan(0);
  });
});
