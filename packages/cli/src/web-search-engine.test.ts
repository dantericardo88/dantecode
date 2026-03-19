import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MultiEngineSearch,
  clearSearchCache,
  createSearchEngine,
} from "./web-search-engine.js";

// Mock the @dantecode/core module to avoid real provider initialization
vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Override createWebSearchOrchestrator to return a mock orchestrator
    createWebSearchOrchestrator: vi.fn(() => ({
      search: vi.fn().mockResolvedValue({
        results: [
          { title: "Mock Result", url: "https://mock.com/1", snippet: "Mock snippet", source: "mock", rank: 1 },
          { title: "Mock Result 2", url: "https://mock.com/2", snippet: "Another mock", source: "mock", rank: 2 },
        ],
        providersUsed: ["mock"],
        totalCost: 0.01,
        iterations: 1,
        fromCache: false,
        query: "test",
      }),
      chainSearch: vi.fn().mockResolvedValue({
        results: [
          { title: "Chain Result", url: "https://chain.com/1", snippet: "Chain snippet", source: "mock", rank: 1 },
        ],
        providersUsed: ["mock"],
        totalCost: 0.02,
        iterations: 2,
        fromCache: false,
        query: "chain test",
      }),
      agenticSearch: vi.fn().mockResolvedValue({
        results: [
          { title: "Agentic Result", url: "https://agentic.com/1", snippet: "Agentic snippet", source: "mock", rank: 1 },
        ],
        providersUsed: ["mock"],
        totalCost: 0.03,
        iterations: 3,
        fromCache: false,
        query: "agentic test",
      }),
      availableProviders: ["mock", "duckduckgo"],
      sessionCost: 0.05,
    })),
    clearOrchestratorCache: vi.fn(),
  };
});

// ============================================================================
// MultiEngineSearch (v2 — Orchestrator Wrapper)
// ============================================================================

describe("MultiEngineSearch v2", () => {
  beforeEach(() => {
    clearSearchCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates via factory function", () => {
    const engine = createSearchEngine();
    expect(engine).toBeInstanceOf(MultiEngineSearch);
  });

  it("returns search results via backward-compatible API", async () => {
    const engine = new MultiEngineSearch();
    const results = await engine.search("test query", 10);
    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Mock Result");
  });

  it("exposes available providers", () => {
    const engine = new MultiEngineSearch();
    expect(engine.availableProviders).toContain("mock");
    expect(engine.availableProviders).toContain("duckduckgo");
  });

  it("exposes session cost", () => {
    const engine = new MultiEngineSearch();
    expect(engine.sessionCost).toBe(0.05);
  });

  it("supports orchestrated search with full metadata", async () => {
    const engine = new MultiEngineSearch();
    const result = await engine.orchestratedSearch("test");
    expect(result.results).toHaveLength(2);
    expect(result.providersUsed).toContain("mock");
    expect(result.totalCost).toBe(0.01);
    expect(result.iterations).toBe(1);
  });

  it("supports search with citations", async () => {
    const engine = new MultiEngineSearch();
    const result = await engine.searchWithCitations("test query");
    expect(result.results).toHaveLength(2);
    expect(result.synthesized).toBeDefined();
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.providersUsed).toContain("mock");
    expect(result.totalCost).toBe(0.01);
  });

  it("supports chain search via backward-compatible API", async () => {
    const engine = new MultiEngineSearch();
    const results = await engine.chainSearch(
      "initial query",
      (results) => results.length < 5 ? "refined" : null,
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Chain Result");
  });

  it("supports agentic search", async () => {
    const engine = new MultiEngineSearch();
    const result = await engine.agenticSearch("agentic query");
    expect(result.results).toHaveLength(1);
    expect(result.iterations).toBe(3);
  });

  it("exposes underlying orchestrator", () => {
    const engine = new MultiEngineSearch();
    const orch = engine.getOrchestrator();
    expect(orch).toBeDefined();
    expect(orch.search).toBeDefined();
  });
});

// ============================================================================
// clearSearchCache
// ============================================================================

describe("clearSearchCache", () => {
  it("calls without error", () => {
    // clearSearchCache delegates to clearOrchestratorCache (mocked above)
    expect(() => clearSearchCache()).not.toThrow();
  });
});
