import { describe, it, expect, vi } from "vitest";
import { DuckDuckGoProvider } from "./search/duckduckgo.js";
import { WebFetcher } from "./fetch/fetcher.js";
import { generateCacheKey } from "./cache/cache-key.js";

describe("Web Research MVP", () => {
  describe("DuckDuckGoProvider", () => {
    it("should be defined", () => {
      const provider = new DuckDuckGoProvider();
      expect(provider.name).toBe("duckduckgo");
    });

    // Integration-style test (skipped by default or mocked)
    it("should have a search method", () => {
      const provider = new DuckDuckGoProvider();
      expect(typeof provider.search).toBe("function");
    });
  });

  describe("WebFetcher", () => {
    it("should clean text content", () => {
      const fetcher = new (WebFetcher as any)();
      const raw = "  Hello   \n\n  World  ";
      const cleaned = fetcher.cleanText(raw);
      expect(cleaned).toBe("Hello World");
    });
  });

  describe("Cache Keys", () => {
    it("should generate deterministic keys", () => {
      const q = "test query";
      const key1 = generateCacheKey(q);
      const key2 = generateCacheKey(q);
      expect(key1).toBe(key2);
    });

    it("should normalize queries", () => {
      const key1 = generateCacheKey("Test Query!");
      const key2 = generateCacheKey("test query");
      expect(key1).toBe(key2);
    });
  });
});
