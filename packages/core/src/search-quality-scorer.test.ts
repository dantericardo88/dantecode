import { describe, it, expect } from "vitest";
import { SearchQualityScorer } from "./search-quality-scorer.js";
import type { SearchResult } from "./search-providers.js";

const NOW = 1_700_000_000_000;
const scorer = new SearchQualityScorer({ nowFn: () => NOW });

function makeResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    title: "TypeScript Monorepo Guide with Turborepo",
    url: "https://github.com/example/repo",
    snippet:
      "A comprehensive guide to setting up TypeScript monorepos using turborepo and tsup for ESM builds with vitest for testing.",
    source: "web",
    ...overrides,
  };
}

describe("SearchQualityScorer", () => {
  it("authoritative sources rank higher than unknown domains", () => {
    const github = scorer.score(makeResult({ url: "https://github.com/example/repo" }));
    const unknown = scorer.score(makeResult({ url: "https://random-blog-42.example.com/post" }));
    expect(github.sourceAuthority).toBeGreaterThan(unknown.sourceAuthority);
  });

  it("filtering removes low-quality results", () => {
    const results: SearchResult[] = [
      makeResult({
        url: "https://github.com/repo",
        snippet:
          "Detailed guide to TypeScript monorepo patterns with turbo and pnpm workspaces for large-scale applications.",
      }),
      makeResult({
        url: "https://reddit.com/r/post",
        snippet: "ok",
        title: "x",
        publishedDate: new Date(NOW - 800 * 86_400_000).toISOString(),
      }),
    ];
    const filtered = scorer.filter(results, 40);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.url).toContain("github.com");
  });

  it("weightedSynthesis sorts by total score descending", () => {
    const results: SearchResult[] = [
      makeResult({ url: "https://random-unknown.example.com/page", snippet: "short" }),
      makeResult({
        url: "https://developer.mozilla.org/docs/guide",
        snippet:
          "Comprehensive MDN documentation about web APIs including `fetch`, `AbortController`, and detailed code examples.\n1. Step one\n2. Step two",
        publishedDate: new Date(NOW - 5 * 86_400_000).toISOString(),
      }),
    ];
    const sorted = scorer.weightedSynthesis(results);
    expect(sorted[0]!.url).toContain("mozilla.org");
    expect(sorted[0]!.qualityScore.total).toBeGreaterThan(sorted[1]!.qualityScore.total);
  });

  it("freshness dimension scores recent results higher", () => {
    const recent = scorer.score(
      makeResult({ publishedDate: new Date(NOW - 86_400_000).toISOString() }),
    );
    const old = scorer.score(
      makeResult({ publishedDate: new Date(NOW - 500 * 86_400_000).toISOString() }),
    );
    expect(recent.freshness).toBeGreaterThan(old.freshness);
  });

  it("citation-dense snippets score higher on citationDensity", () => {
    const dense = scorer.score(
      makeResult({
        snippet:
          "See https://example.com/api and https://example.com/docs for reference.\n```typescript\nconst x = 1;\n```\n1. First step\n2. Second step",
      }),
    );
    const sparse = scorer.score(makeResult({ snippet: "A simple sentence without references." }));
    expect(dense.citationDensity).toBeGreaterThan(sparse.citationDensity);
  });

  it("each dimension is clamped to 0-25", () => {
    const result = scorer.score(
      makeResult({
        url: "https://github.com/big-repo",
        publishedDate: new Date(NOW - 1000).toISOString(),
        snippet:
          "A very long snippet ".repeat(50) +
          "\n```code```\n1. list\n2. list\nhttps://a.com https://b.com https://c.com `inline` code",
      }),
    );
    expect(result.sourceAuthority).toBeLessThanOrEqual(25);
    expect(result.freshness).toBeLessThanOrEqual(25);
    expect(result.relevance).toBeLessThanOrEqual(25);
    expect(result.citationDensity).toBeLessThanOrEqual(25);
    expect(result.total).toBeLessThanOrEqual(100);
  });
});
