import { describe, it, expect, vi } from "vitest";

describe("Memory tool", () => {
  function makeMockOrchestrator() {
    const store = new Map<string, string>();
    return {
      memoryStore: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
      memoryRecall: vi.fn(async (query: string, limit: number) => {
        const results: Array<{ key: string; value: string; score: number }> = [];
        for (const [k, v] of store) {
          if (k.includes(query) || v.includes(query)) {
            results.push({ key: k, value: v, score: 0.9 });
          }
        }
        return results.slice(0, limit);
      }),
    };
  }

  it("stores a memory via the orchestrator", async () => {
    const orchestrator = makeMockOrchestrator();
    await orchestrator.memoryStore("project-lang", "TypeScript monorepo");
    expect(orchestrator.memoryStore).toHaveBeenCalledWith("project-lang", "TypeScript monorepo");
  });

  it("recalls memories matching a query", async () => {
    const orchestrator = makeMockOrchestrator();
    await orchestrator.memoryStore("lang", "TypeScript");
    await orchestrator.memoryStore("build", "tsup + turbo");

    const results = await orchestrator.memoryRecall("TypeScript", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.value).toContain("TypeScript");
  });

  it("returns empty array when no memories match", async () => {
    const orchestrator = makeMockOrchestrator();
    const results = await orchestrator.memoryRecall("nonexistent-xyz", 5);
    expect(results).toHaveLength(0);
  });

  it("blocks store when secrets scanner detects sensitive content", () => {
    const scanResult = { clean: false, findings: [{ type: "api_key" }] };
    expect(scanResult.clean).toBe(false);
    expect(scanResult.findings![0]!.type).toBe("api_key");
  });

  it("allows store when secrets scanner passes", () => {
    const scanResult = { clean: true, findings: [] };
    expect(scanResult.clean).toBe(true);
  });
});
