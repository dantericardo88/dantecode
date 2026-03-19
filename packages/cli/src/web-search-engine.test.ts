import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DuckDuckGoEngine,
  BraveSearchEngine,
  MultiEngineSearch,
  clearSearchCache,
  type SearchEngine,
  type SearchResult,
} from "./web-search-engine.js";

// ============================================================================
// DuckDuckGoEngine
// ============================================================================

describe("DuckDuckGoEngine", () => {
  const engine = new DuckDuckGoEngine();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is always available (no API key needed)", () => {
    expect(engine.available()).toBe(true);
  });

  it("parses DuckDuckGo HTML result blocks", async () => {
    const mockHtml = `
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="https://example.com/page">Example Title</a>
        <a class="result__snippet">This is a snippet about the result.</a>
      </div></div>
      <div class="result results_links results_links_deep web-result">
        <a class="result__a" href="https://other.com/page">Other Result</a>
        <a class="result__snippet">Another snippet here.</a>
      </div></div>
    `;

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => mockHtml,
    });

    const results = await engine.search("test query", 10);
    expect(results).toHaveLength(2);
    expect(results[0]!.title).toBe("Example Title");
    expect(results[0]!.url).toBe("https://example.com/page");
    expect(results[0]!.snippet).toContain("snippet about the result");
    expect(results[0]!.source).toBe("duckduckgo");
  });

  it("falls back to link extraction when structured parsing fails", async () => {
    const mockHtml = `
      <a href="https://fallback.com/page">Fallback Link Text</a>
      <a href="//duckduckgo.com/internal">Skip This</a>
      <a href="https://second.com/page">Second Result</a>
    `;

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => mockHtml,
    });

    const results = await engine.search("test", 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.url).toBe("https://fallback.com/page");
  });

  it("throws on HTTP error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
    });

    await expect(engine.search("test", 10)).rejects.toThrow("DuckDuckGo HTTP 503");
  });

  it("respects maxResults limit", async () => {
    const blocks = Array.from({ length: 5 }, (_, i) => `
      <div class="result results_links">
        <a class="result__a" href="https://example.com/${i}">Result ${i}</a>
        <a class="result__snippet">Snippet ${i}</a>
      </div></div>
    `).join("\n");

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      text: async () => blocks,
    });

    const results = await engine.search("test", 2);
    expect(results).toHaveLength(2);
  });
});

// ============================================================================
// BraveSearchEngine
// ============================================================================

describe("BraveSearchEngine", () => {
  const engine = new BraveSearchEngine();

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env["BRAVE_API_KEY"];
  });

  it("is not available without API key", () => {
    delete process.env["BRAVE_API_KEY"];
    expect(engine.available()).toBe(false);
  });

  it("is available with API key", () => {
    process.env["BRAVE_API_KEY"] = "test-key";
    expect(engine.available()).toBe(true);
  });

  it("returns empty array when no API key", async () => {
    delete process.env["BRAVE_API_KEY"];
    const results = await engine.search("test", 10);
    expect(results).toEqual([]);
  });

  it("parses Brave Search API JSON response", async () => {
    process.env["BRAVE_API_KEY"] = "test-key";

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        web: {
          results: [
            {
              title: "Brave Result",
              url: "https://brave-result.com",
              description: "Found via Brave",
            },
          ],
        },
      }),
    });

    const results = await engine.search("test query", 10);
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Brave Result");
    expect(results[0]!.url).toBe("https://brave-result.com");
    expect(results[0]!.snippet).toBe("Found via Brave");
    expect(results[0]!.source).toBe("brave");
  });
});

// ============================================================================
// MultiEngineSearch
// ============================================================================

describe("MultiEngineSearch", () => {
  beforeEach(() => {
    clearSearchCache();
  });

  function mockEngine(name: string, results: SearchResult[], isAvailable = true): SearchEngine {
    return {
      name,
      available: () => isAvailable,
      search: vi.fn().mockResolvedValue(results),
    };
  }

  it("searches single engine when only one available", async () => {
    const engine1 = mockEngine("test1", [
      { title: "R1", url: "https://a.com", snippet: "S1", source: "test1" },
    ]);
    const engine2 = mockEngine("test2", [], false);

    const search = new MultiEngineSearch([engine1, engine2]);
    const results = await search.search("single-engine-query", 10);

    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("R1");
    expect(engine1.search).toHaveBeenCalled();
    expect(engine2.search).not.toHaveBeenCalled();
  });

  it("merges and deduplicates results from multiple engines", async () => {
    const engine1 = mockEngine("eng1", [
      { title: "Same Page", url: "https://example.com/page", snippet: "Short", source: "eng1" },
      { title: "Unique A", url: "https://a.com", snippet: "Only eng1", source: "eng1" },
    ]);
    const engine2 = mockEngine("eng2", [
      { title: "Same Page", url: "https://www.example.com/page/", snippet: "Longer snippet here", source: "eng2" },
      { title: "Unique B", url: "https://b.com", snippet: "Only eng2", source: "eng2" },
    ]);

    const search = new MultiEngineSearch([engine1, engine2]);
    const results = await search.search("dedup-query", 10);

    // Should have 3 results (Same Page deduplicated)
    expect(results).toHaveLength(3);

    // The deduplicated result should keep the longer snippet
    const same = results.find((r) => r.url.includes("example.com"));
    expect(same).toBeDefined();
    expect(same!.snippet).toBe("Longer snippet here");
  });

  it("ranks results by reciprocal rank fusion", async () => {
    const engine1 = mockEngine("eng1", [
      { title: "Top Both", url: "https://top.com", snippet: "Top", source: "eng1" },
      { title: "Only Eng1 #2", url: "https://only1.com", snippet: "", source: "eng1" },
    ]);
    const engine2 = mockEngine("eng2", [
      { title: "Top Both", url: "https://top.com", snippet: "Top", source: "eng2" },
      { title: "Only Eng2 #2", url: "https://only2.com", snippet: "", source: "eng2" },
    ]);

    const search = new MultiEngineSearch([engine1, engine2]);
    const results = await search.search("rrf-query", 10);

    // Result appearing in both engines should rank first
    expect(results[0]!.url).toBe("https://top.com");
    expect(results[0]!.rank).toBe(1);
  });

  it("uses preferred engine when specified", async () => {
    const engine1 = mockEngine("duckduckgo", [
      { title: "DDG", url: "https://ddg.com", snippet: "", source: "duckduckgo" },
    ]);
    const engine2 = mockEngine("brave", [
      { title: "Brave", url: "https://brave.com", snippet: "", source: "brave" },
    ]);

    const search = new MultiEngineSearch([engine1, engine2]);
    const results = await search.search("preferred-query", 10, "brave");

    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("brave");
    expect(engine1.search).not.toHaveBeenCalled();
  });

  it("falls back to all engines when preferred not available", async () => {
    const engine1 = mockEngine("duckduckgo", [
      { title: "DDG", url: "https://ddg.com", snippet: "", source: "duckduckgo" },
    ]);
    const engine2 = mockEngine("brave", [], false); // not available

    const search = new MultiEngineSearch([engine1, engine2]);
    const results = await search.search("fallback-query", 10, "brave");

    // Brave not available, falls through to all-engine search with only duckduckgo
    expect(results).toHaveLength(1);
    expect(results[0]!.source).toBe("duckduckgo");
  });

  it("returns empty when no engines available and fallback fails", async () => {
    // Stub fetch to fail for the internal DuckDuckGo fallback
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const search = new MultiEngineSearch([
      mockEngine("e1", [], false),
      mockEngine("e2", [], false),
    ]);
    const results = await search.search("no-engines-query", 10);
    expect(results).toHaveLength(0);

    vi.restoreAllMocks();
  });

  it("handles engine failures gracefully", async () => {
    const failEngine: SearchEngine = {
      name: "fail",
      available: () => true,
      search: vi.fn().mockRejectedValue(new Error("Network error")),
    };
    const goodEngine = mockEngine("good", [
      { title: "Works", url: "https://good.com", snippet: "", source: "good" },
    ]);

    const search = new MultiEngineSearch([failEngine, goodEngine]);
    const results = await search.search("failure-test-query", 10);

    // Should still return results from the working engine
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Works");
  });

  it("chains follow-up searches with refinement function", async () => {
    let callCount = 0;
    const engine: SearchEngine = {
      name: "chain-test",
      available: () => true,
      search: vi.fn().mockImplementation(async (_query: string) => {
        callCount++;
        if (callCount === 1) {
          return [
            { title: "Initial", url: "https://initial.com", snippet: "", source: "chain-test" },
          ];
        }
        return [
          { title: "Refined", url: "https://refined.com", snippet: "", source: "chain-test" },
        ];
      }),
    };

    const search = new MultiEngineSearch([engine]);
    const results = await search.chainSearch(
      "initial query",
      (currentResults) => {
        if (currentResults.length < 2) return "refined query";
        return null;
      },
      2,
      10,
    );

    // Should have results from both initial and refined searches
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.some((r) => r.title === "Initial")).toBe(true);
    expect(results.some((r) => r.title === "Refined")).toBe(true);
  });

  it("stops chaining when refineFn returns null", async () => {
    const searchSpy = vi.fn().mockResolvedValue([
      { title: "Enough", url: "https://enough.com", snippet: "", source: "stop-test" },
    ]);
    const engine: SearchEngine = {
      name: "stop-test",
      available: () => true,
      search: searchSpy,
    };

    const search = new MultiEngineSearch([engine]);
    const results = await search.chainSearch(
      "stop-chain-query",
      () => null, // immediately satisfied
      5,
      10,
    );

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it("normalizes URLs for deduplication (www, trailing slash, protocol)", async () => {
    const engine = mockEngine("test", [
      { title: "A", url: "https://www.example.com/page/", snippet: "", source: "test" },
      { title: "B", url: "https://example.com/page", snippet: "", source: "test" },
      { title: "C", url: "http://example.com/page", snippet: "", source: "test" },
    ]);

    const search = new MultiEngineSearch([engine]);
    const results = await search.search("normalize-query", 10);

    // All 3 URLs normalize to the same — should deduplicate to 1
    expect(results).toHaveLength(1);
  });
});
