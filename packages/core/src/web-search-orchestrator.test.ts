import { describe, it, expect, vi, afterEach } from "vitest";
import {
  WebSearchOrchestrator,
  createWebSearchOrchestrator,
  clearOrchestratorCache,
} from "./web-search-orchestrator.js";
import type { SearchProvider, SearchResult } from "./search-providers.js";

// ============================================================================
// Mock Providers
// ============================================================================

function createMockProvider(
  name: string,
  results: SearchResult[],
  isAvailable = true,
  cost = 0.01,
): SearchProvider {
  return {
    name,
    costPerQuery: cost,
    available: () => isAvailable,
    search: vi.fn(async () => results),
  };
}

const RESULT_A: SearchResult = {
  title: "Result A",
  url: "https://example.com/a",
  snippet: "Snippet A describes a detailed concept that is highly relevant to the query",
  source: "provider-a",
  rank: 1,
};

const RESULT_B: SearchResult = {
  title: "Result B",
  url: "https://example.com/b",
  snippet: "Snippet B about another topic",
  source: "provider-b",
  rank: 1,
};

const RESULT_C: SearchResult = {
  title: "Result C",
  url: "https://other.com/c",
  snippet: "Snippet C with different content",
  source: "provider-a",
  rank: 2,
};

// ============================================================================
// WebSearchOrchestrator
// ============================================================================

describe("WebSearchOrchestrator", () => {
  afterEach(() => {
    clearOrchestratorCache();
    vi.restoreAllMocks();
  });

  it("searches with a single provider", async () => {
    const provider = createMockProvider("test", [RESULT_A, RESULT_B]);
    const orch = new WebSearchOrchestrator({}, [provider]);

    const result = await orch.search("test query");
    expect(result.results).toHaveLength(2);
    expect(result.providersUsed).toContain("test");
    expect(result.totalCost).toBe(0.01);
    expect(result.fromCache).toBe(false);
  });

  it("returns cached results on second call", async () => {
    const provider = createMockProvider("test", [RESULT_A]);
    const orch = new WebSearchOrchestrator({}, [provider]);

    await orch.search("same query");
    const second = await orch.search("same query");
    expect(second.fromCache).toBe(true);
    expect(provider.search).toHaveBeenCalledTimes(1);
  });

  it("merges results from multiple providers via RRF", async () => {
    const providerA = createMockProvider("a", [RESULT_A, RESULT_C], true, 0);
    const providerB = createMockProvider("b", [RESULT_B], true, 0);
    const orch = new WebSearchOrchestrator({}, [providerA, providerB]);

    const result = await orch.search("multi query");
    expect(result.results.length).toBeGreaterThanOrEqual(2);
    expect(result.providersUsed).toContain("a");
    expect(result.providersUsed).toContain("b");
  });

  it("deduplicates results by normalized URL", async () => {
    const resultDup: SearchResult = { ...RESULT_A, source: "b", url: "https://www.example.com/a/" };
    const providerA = createMockProvider("a", [RESULT_A], true, 0);
    const providerB = createMockProvider("b", [resultDup], true, 0);
    const orch = new WebSearchOrchestrator({}, [providerA, providerB]);

    const result = await orch.search("dedup test");
    const urls = result.results.map((r) => r.url);
    // Should have deduplicated to 1 result
    expect(urls.length).toBe(1);
  });

  it("respects preferred provider", async () => {
    const tavily = createMockProvider("tavily", [RESULT_A]);
    const ddg = createMockProvider("duckduckgo", [RESULT_B], true, 0);
    const orch = new WebSearchOrchestrator({}, [tavily, ddg]);

    const result = await orch.search("pref query", { preferredProvider: "tavily" });
    expect(result.providersUsed).toEqual(["tavily"]);
    expect(ddg.search).not.toHaveBeenCalled();
  });

  it("falls back when preferred provider fails", async () => {
    const failing: SearchProvider = {
      name: "failing",
      costPerQuery: 0,
      available: () => true,
      search: vi.fn(async () => { throw new Error("fail"); }),
    };
    const ddg = createMockProvider("duckduckgo", [RESULT_B], true, 0);
    const orch = new WebSearchOrchestrator({}, [failing, ddg]);

    const result = await orch.search("fallback test", { preferredProvider: "failing" });
    // Should fall through to multi-provider search
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  it("respects cost cap", async () => {
    const expensive = createMockProvider("expensive", [RESULT_A], true, 0.10);
    const cheap = createMockProvider("cheap", [RESULT_B], true, 0.01);
    const orch = new WebSearchOrchestrator({ costCapPerCall: 0.05 }, [expensive, cheap]);

    const result = await orch.search("budget test");
    // Should skip expensive provider
    expect(result.providersUsed).not.toContain("expensive");
    expect(result.providersUsed).toContain("cheap");
  });

  it("returns empty when no providers available", async () => {
    const unavailable = createMockProvider("unavail", [], false);
    const orch = new WebSearchOrchestrator({}, [unavailable]);

    const result = await orch.search("no providers");
    expect(result.results).toEqual([]);
    expect(result.providersUsed).toEqual([]);
  });

  it("tracks session cost", async () => {
    const provider = createMockProvider("test", [RESULT_A], true, 0.01);
    const orch = new WebSearchOrchestrator({}, [provider]);

    expect(orch.sessionCost).toBe(0);
    await orch.search("q1");
    expect(orch.sessionCost).toBe(0.01);
    clearOrchestratorCache();
    await orch.search("q2");
    expect(orch.sessionCost).toBe(0.02);
  });
});

// ============================================================================
// Chain Search
// ============================================================================

describe("WebSearchOrchestrator.chainSearch", () => {
  afterEach(() => {
    clearOrchestratorCache();
  });

  it("chains queries with refinement", async () => {
    let callCount = 0;
    const provider: SearchProvider = {
      name: "chain",
      costPerQuery: 0,
      available: () => true,
      search: vi.fn(async () => {
        callCount++;
        return callCount === 1 ? [RESULT_A] : [RESULT_A, RESULT_B, RESULT_C];
      }),
    };
    const orch = new WebSearchOrchestrator({}, [provider]);

    const result = await orch.chainSearch("initial query", {
      refineFn: (results) => results.length < 3 ? "refined query" : null,
    });

    expect(result.results.length).toBeGreaterThanOrEqual(2);
    expect(result.iterations).toBe(1);
  });
});

// ============================================================================
// Agentic Search
// ============================================================================

describe("WebSearchOrchestrator.agenticSearch", () => {
  afterEach(() => {
    clearOrchestratorCache();
  });

  it("iterates when confidence is low", async () => {
    let callCount = 0;
    const provider: SearchProvider = {
      name: "agentic",
      costPerQuery: 0,
      available: () => true,
      search: vi.fn(async () => {
        callCount++;
        if (callCount === 1) return []; // empty → low confidence
        return [RESULT_A, RESULT_B, RESULT_C]; // good results
      }),
    };
    const orch = new WebSearchOrchestrator({}, [provider]);

    const result = await orch.agenticSearch("agentic query");
    expect(result.iterations).toBeGreaterThanOrEqual(2);
    expect(result.results.length).toBeGreaterThanOrEqual(1);
  });

  it("stops after max iterations", async () => {
    const provider: SearchProvider = {
      name: "slow",
      costPerQuery: 0,
      available: () => true,
      search: vi.fn(async () => []), // always empty
    };
    const orch = new WebSearchOrchestrator({}, [provider]);

    const result = await orch.agenticSearch("never found");
    expect(result.iterations).toBeLessThanOrEqual(3);
  });
});

// ============================================================================
// Confidence Evaluation
// ============================================================================

describe("WebSearchOrchestrator.evaluateResultConfidence", () => {
  it("returns 0 for empty results", () => {
    const orch = new WebSearchOrchestrator({}, []);
    expect(orch.evaluateResultConfidence([], "test")).toBe(0);
  });

  it("returns higher confidence for many relevant results", () => {
    const orch = new WebSearchOrchestrator({}, []);
    const results = [RESULT_A, RESULT_B, RESULT_C, { ...RESULT_A, url: "https://x.com/1" }, { ...RESULT_B, url: "https://y.com/2" }];
    const confidence = orch.evaluateResultConfidence(results, "test query");
    expect(confidence).toBeGreaterThan(0.3);
  });
});

// ============================================================================
// RRF
// ============================================================================

describe("WebSearchOrchestrator.reciprocalRankFusion", () => {
  it("merges and ranks results from multiple sources", () => {
    const orch = new WebSearchOrchestrator({}, []);
    const fused = orch.reciprocalRankFusion([
      [RESULT_A, RESULT_C],
      [RESULT_B, RESULT_A], // A appears in both
    ]);

    expect(fused.length).toBeGreaterThanOrEqual(2);
    // Result A should be boosted (appears in both lists)
    const resultA = fused.find((r) => r.url.includes("example.com/a"));
    expect(resultA).toBeDefined();
    expect(resultA!.rank).toBe(1); // Should be #1 due to appearing in both
  });
});

// ============================================================================
// Factory
// ============================================================================

describe("createWebSearchOrchestrator", () => {
  it("creates orchestrator with default config", () => {
    const orch = createWebSearchOrchestrator();
    expect(orch).toBeInstanceOf(WebSearchOrchestrator);
    // DuckDuckGo should always be available
    expect(orch.availableProviders).toContain("duckduckgo");
  });
});
