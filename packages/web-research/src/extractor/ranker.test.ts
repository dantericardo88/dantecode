import { describe, it, expect } from "vitest";
import { RelevanceRanker } from "./ranker.js";
import type { SearchResult } from "../types.js";

function makeResult(url: string, title: string, snippet: string, position = 1): SearchResult {
  return { url, title, snippet, position };
}

describe("RelevanceRanker", () => {
  const ranker = new RelevanceRanker();

  describe("BM25 basic ranking", () => {
    it("ranks more relevant results higher", () => {
      const results = [
        makeResult("https://example.com/irrelevant", "Something Unrelated", "cats and dogs", 1),
        makeResult("https://example.com/relevant", "TypeScript Guide", "typescript monorepo workspace packages", 2),
      ];
      const ranked = ranker.rank(results, "typescript monorepo");
      expect(ranked[0]!.url).toBe("https://example.com/relevant");
    });

    it("returns empty array for empty input", () => {
      expect(ranker.rank([], "typescript")).toHaveLength(0);
    });

    it("returns results unchanged if query has no terms > 2 chars", () => {
      const results = [makeResult("https://a.com", "A", "a b c", 1)];
      const ranked = ranker.rank(results, "a b");
      expect(ranked).toHaveLength(1);
    });
  });

  describe("authority scoring", () => {
    it("ranks github.com higher than reddit.com for equal relevance", () => {
      const query = "typescript best practices";
      const results = [
        makeResult(
          "https://reddit.com/r/typescript/comments/abc",
          "TypeScript best practices discussion",
          "typescript best practices community discussion",
          1,
        ),
        makeResult(
          "https://github.com/microsoft/TypeScript/wiki",
          "TypeScript best practices wiki",
          "typescript best practices official wiki",
          2,
        ),
      ];
      const ranked = ranker.rank(results, query);
      expect(ranked[0]!.url).toContain("github.com");
    });

    it("stackoverflow.com ranks higher than reddit.com", () => {
      const query = "javascript async await";
      const results = [
        makeResult(
          "https://reddit.com/r/javascript",
          "JavaScript async await help",
          "javascript async await question answer",
          1,
        ),
        makeResult(
          "https://stackoverflow.com/questions/12345",
          "JavaScript async await explained",
          "javascript async await answer explanation",
          2,
        ),
      ];
      const ranked = ranker.rank(results, query);
      expect(ranked[0]!.url).toContain("stackoverflow.com");
    });

    it("respects authorityOverrides from opts", () => {
      const query = "internal documentation";
      const results = [
        makeResult("https://docs.internal.company.com/api", "Internal API Docs", "internal documentation api reference", 1),
        makeResult("https://github.com/internal/repo", "GitHub Internal", "internal documentation github", 2),
      ];
      const ranked = ranker.rank(results, query, {
        authorityOverrides: { "docs.internal.company.com": 15 }, // Higher than github's 10
      });
      expect(ranked[0]!.url).toContain("docs.internal.company.com");
    });

    it("unknown domains get 0 authority bonus (no error)", () => {
      const results = [
        makeResult("https://obscure-blog.xyz/post", "Blog Post", "typescript guide", 1),
      ];
      expect(() => ranker.rank(results, "typescript")).not.toThrow();
    });

    it("handles invalid URL without throwing", () => {
      const results = [
        makeResult("not-a-url", "Bad URL", "some content", 1),
      ];
      expect(() => ranker.rank(results, "content")).not.toThrow();
    });
  });
});
