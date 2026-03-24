import { describe, it, expect, vi } from "vitest";
import { EntityExtractor } from "./entity-extractor.js";
import type { ModelRouterImpl } from "./model-router.js";

function createMockRouter(response: string | Error): ModelRouterImpl {
  const generate = response instanceof Error
    ? vi.fn().mockRejectedValue(response)
    : vi.fn().mockResolvedValue(response);

  return { generate } as unknown as ModelRouterImpl;
}

describe("EntityExtractor — LLM-Based Extraction", () => {
  it("extracts entities, summary, and category from valid JSON", async () => {
    const router = createMockRouter(
      '{"summary":"User login fails on mobile","entities":["login","mobile","auth"],"category":"error"}',
    );
    const extractor = new EntityExtractor(router);
    const result = await extractor.extract("The user login fails on mobile devices due to auth.");

    expect(result.summary).toBe("User login fails on mobile");
    expect(result.entities).toEqual(["login", "mobile", "auth"]);
    expect(result.category).toBe("error");
  });

  it("handles JSON with extra whitespace/text around it", async () => {
    const router = createMockRouter(
      'Here is the result:\n{"summary":"Deploy plan","entities":["deploy","staging"],"category":"strategy"}\nDone.',
    );
    const extractor = new EntityExtractor(router);
    const result = await extractor.extract("Plan the deployment to staging.");

    expect(result.summary).toBe("Deploy plan");
    expect(result.entities).toContain("deploy");
    expect(result.category).toBe("strategy");
  });

  it("handles decision category", async () => {
    const router = createMockRouter(
      '{"summary":"Chose React over Vue","entities":["React","Vue","framework"],"category":"decision"}',
    );
    const extractor = new EntityExtractor(router);
    const result = await extractor.extract("We decided to use React instead of Vue.");

    expect(result.category).toBe("decision");
  });

  it("handles fact category", async () => {
    const router = createMockRouter(
      '{"summary":"Port 3000 is default","entities":["port","3000"],"category":"fact"}',
    );
    const extractor = new EntityExtractor(router);
    const result = await extractor.extract("The default port is 3000.");

    expect(result.category).toBe("fact");
  });

  it("caps entities at 10 items", async () => {
    const manyEntities = Array.from({ length: 15 }, (_, i) => `entity${i}`);
    const router = createMockRouter(
      JSON.stringify({ summary: "Many entities", entities: manyEntities, category: "context" }),
    );
    const extractor = new EntityExtractor(router);
    const result = await extractor.extract("Content with many entities.");

    expect(result.entities.length).toBeLessThanOrEqual(10);
  });

  it("defaults to 'context' when category is missing from response", async () => {
    const router = createMockRouter('{"summary":"No category","entities":["test"]}');
    const extractor = new EntityExtractor(router);
    const result = await extractor.extract("Some text without category.");

    expect(result.category).toBe("context");
  });
});

describe("EntityExtractor — Heuristic Fallback", () => {
  it("falls back to heuristics on router error", async () => {
    const router = createMockRouter(new Error("API unavailable"));
    const extractor = new EntityExtractor(router);
    const result = await extractor.extract("We decided to refactor the auth module.");

    expect(result.category).toBe("context");
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.summary).toContain("decided to refactor");
  });

  it("falls back to heuristics on malformed JSON", async () => {
    const router = createMockRouter("This is not valid JSON at all");
    const extractor = new EntityExtractor(router);
    const result = await extractor.extract("Fix the bug in production code.");

    expect(result.category).toBe("context");
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it("truncates long text in heuristic summary", async () => {
    const router = createMockRouter(new Error("fail"));
    const extractor = new EntityExtractor(router);
    const longText = "A".repeat(500);
    const result = await extractor.extract(longText);

    expect(result.summary.length).toBeLessThanOrEqual(204); // 200 chars + "..."
  });

  it("passes text to the router generate method", async () => {
    const router = createMockRouter(
      '{"summary":"ok","entities":[],"category":"context"}',
    );
    const extractor = new EntityExtractor(router);
    await extractor.extract("Specific text content here.");

    expect(router.generate).toHaveBeenCalledTimes(1);
    const callArgs = (router.generate as ReturnType<typeof vi.fn>).mock.calls[0]!;
    // First arg should be messages array
    expect(Array.isArray(callArgs[0])).toBe(true);
    // The user message content should contain our text
    const userMsg = callArgs[0][0];
    expect(userMsg.content).toContain("Specific text content here.");
  });
});
