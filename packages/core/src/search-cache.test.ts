import { describe, it, expect, vi, beforeEach } from "vitest";
import { SemanticSearchCache } from "./search-cache.js";
import type { SearchResult } from "./search-providers.js";

// Mock fs operations
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import { readFile, writeFile, mkdir } from "node:fs/promises";

const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as ReturnType<typeof vi.fn>;

const MOCK_RESULTS: SearchResult[] = [
  {
    title: "TypeScript Docs",
    url: "https://typescriptlang.org",
    snippet: "TypeScript is a strongly typed superset of JavaScript.",
    source: "tavily",
    rank: 1,
  },
  {
    title: "TypeScript Tutorial",
    url: "https://example.com/ts",
    snippet: "Learn TypeScript step by step.",
    source: "duckduckgo",
    rank: 2,
  },
];

describe("SemanticSearchCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
  });

  it("stores and retrieves results for exact query", async () => {
    const cache = new SemanticSearchCache("/project");
    await cache.put("typescript basics", MOCK_RESULTS, ["tavily"]);
    const retrieved = await cache.get("typescript basics");
    expect(retrieved).toHaveLength(2);
    expect(retrieved![0]!.title).toBe("TypeScript Docs");
  });

  it("matches semantically similar queries", async () => {
    const cache = new SemanticSearchCache("/project");
    await cache.put("typescript fundamentals tutorial basics guide", MOCK_RESULTS, ["tavily"]);

    // Nearly identical tokens should match at 0.8 threshold
    const retrieved = await cache.get("typescript fundamentals tutorial guide basics");
    expect(retrieved).not.toBeNull();
  });

  it("returns null for dissimilar queries", async () => {
    const cache = new SemanticSearchCache("/project");
    await cache.put("typescript basics", MOCK_RESULTS, ["tavily"]);

    const retrieved = await cache.get("python machine learning deep neural networks");
    expect(retrieved).toBeNull();
  });

  it("respects TTL", async () => {
    const cache = new SemanticSearchCache("/project", { ttlMs: 1000 });

    // Store with old timestamp
    await cache.put("test query", MOCK_RESULTS, ["test"]);

    // Manipulate internal timestamp
    vi.useFakeTimers();
    vi.advanceTimersByTime(2000);

    const retrieved = await cache.get("test query");
    expect(retrieved).toBeNull();

    vi.useRealTimers();
  });

  it("evicts old entries when over capacity", async () => {
    const cache = new SemanticSearchCache("/project", { maxEntries: 2 });

    await cache.put("query one", MOCK_RESULTS, ["a"]);
    await cache.put("query two completely different", MOCK_RESULTS, ["b"]);
    await cache.put("query three another topic", MOCK_RESULTS, ["c"]);

    expect(cache.size).toBeLessThanOrEqual(2);
  });

  it("clears all entries", async () => {
    const cache = new SemanticSearchCache("/project");
    await cache.put("test", MOCK_RESULTS, ["test"]);
    expect(cache.size).toBe(1);

    await cache.clear();
    expect(cache.size).toBe(0);
  });

  it("loads from disk on first access", async () => {
    const existingEntries = [
      {
        query: "existing query",
        queryTokens: ["existing", "query"],
        results: MOCK_RESULTS,
        cachedAt: new Date().toISOString(),
        providers: ["tavily"],
        hitCount: 5,
      },
    ];

    mockReadFile.mockResolvedValueOnce(JSON.stringify(existingEntries));

    const cache = new SemanticSearchCache("/project");
    const result = await cache.get("existing query");
    expect(result).not.toBeNull();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("saves to disk after put", async () => {
    const cache = new SemanticSearchCache("/project");
    await cache.put("test query", MOCK_RESULTS, ["tavily"]);
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it("skips disk operations when persistToDisk is false", async () => {
    const cache = new SemanticSearchCache("/project", { persistToDisk: false });
    await cache.put("test", MOCK_RESULTS, ["test"]);
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("returns cache statistics", async () => {
    const cache = new SemanticSearchCache("/project", { persistToDisk: false });
    await cache.put("query one", MOCK_RESULTS, ["a"]);
    await cache.put("query two different", MOCK_RESULTS, ["b"]);

    const stats = cache.getStats();
    expect(stats.entries).toBe(2);
    expect(stats.totalHits).toBe(0);
    expect(stats.oldestEntry).not.toBeNull();
  });

  it("increments hit count on cache hit", async () => {
    const cache = new SemanticSearchCache("/project", { persistToDisk: false });
    await cache.put("test query here", MOCK_RESULTS, ["a"]);

    // Hit it twice
    await cache.get("test query here");
    await cache.get("test query here");

    const stats = cache.getStats();
    expect(stats.totalHits).toBe(2);
  });

  it("updates existing entry for similar query", async () => {
    const cache = new SemanticSearchCache("/project", { persistToDisk: false });
    await cache.put("typescript guide basics tutorial", MOCK_RESULTS, ["a"]);

    const updatedResults = [{ ...MOCK_RESULTS[0]!, title: "Updated" }];
    await cache.put("typescript guide basics tutorial intro", updatedResults, ["b"]);

    // Should still be 1 entry (updated, not duplicated)
    expect(cache.size).toBe(1);
  });

  it("handles corrupted disk data gracefully", async () => {
    mockReadFile.mockResolvedValueOnce("not valid json {{{");

    const cache = new SemanticSearchCache("/project");
    const result = await cache.get("test");
    expect(result).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("handles write failures gracefully", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("EACCES"));

    const cache = new SemanticSearchCache("/project");
    // Should not throw
    await cache.put("test", MOCK_RESULTS, ["test"]);
    expect(cache.size).toBe(1);
  });

  it("configurable similarity threshold", async () => {
    // Low threshold = more cache hits (less precision)
    const cache = new SemanticSearchCache("/project", {
      similarityThreshold: 0.3,
      persistToDisk: false,
    });
    await cache.put("react hooks tutorial", MOCK_RESULTS, ["a"]);

    // More different query should still match with low threshold
    const result = await cache.get("react hooks guide examples");
    expect(result).not.toBeNull();
  });
});
