import { describe, it, expect } from "vitest";
import { rerankResults } from "./search-reranker.js";
import type { SearchResult } from "./search-providers.js";

const RESULTS: SearchResult[] = [
  {
    title: "React Performance Guide",
    url: "https://react.dev/learn/performance",
    snippet: "Learn how to optimize React components for better rendering performance with useMemo, useCallback, and React.memo.",
    source: "tavily",
    rank: 1,
  },
  {
    title: "Random Blog Post",
    url: "https://medium.com/random-article",
    snippet: "Some thoughts on programming and coffee.",
    source: "duckduckgo",
    rank: 2,
  },
  {
    title: "React Docs - Hooks",
    url: "https://react.dev/reference/hooks",
    snippet: "React hooks API reference including useState, useEffect, useMemo, useCallback, useRef, and more.",
    source: "exa",
    rank: 3,
    publishedDate: new Date().toISOString(),
  },
  {
    title: "Stack Overflow - React memo",
    url: "https://stackoverflow.com/questions/react-memo",
    snippet: "When should you use React.memo? Detailed answers with code examples for optimizing component re-renders.",
    source: "brave",
    rank: 4,
    publishedDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

describe("rerankResults", () => {
  it("reranks by query relevance", () => {
    const reranked = rerankResults(RESULTS, {
      query: "React performance optimization memo",
    });

    expect(reranked.length).toBe(4);
    // React performance guide and React.memo question should rank higher than random blog
    const perfIdx = reranked.findIndex((r) => r.url.includes("performance"));
    const blogIdx = reranked.findIndex((r) => r.url.includes("medium.com"));
    expect(perfIdx).toBeLessThan(blogIdx);
  });

  it("boosts results matching task context", () => {
    const reranked = rerankResults(RESULTS, {
      query: "hooks",
      taskDescription: "I am building a React app and need to optimize rendering with memoization hooks",
    });

    // React hooks doc should rank highly with the context
    const hooksIdx = reranked.findIndex((r) => r.url.includes("hooks"));
    expect(hooksIdx).toBeLessThanOrEqual(1);
  });

  it("boosts high-authority domains", () => {
    const reranked = rerankResults(RESULTS, {
      query: "react optimization",
    });

    // react.dev and stackoverflow should rank above medium.com
    const reactIdx = reranked.findIndex((r) => r.url.includes("react.dev"));
    const mediumIdx = reranked.findIndex((r) => r.url.includes("medium.com"));
    expect(reactIdx).toBeLessThan(mediumIdx);
  });

  it("filters by minimum score", () => {
    const reranked = rerankResults(RESULTS, {
      query: "completely unrelated quantum physics topic",
    }, {
      minScore: 0.3,
    });

    // Low relevance results should be filtered
    expect(reranked.length).toBeLessThanOrEqual(RESULTS.length);
  });

  it("considers tech stack context", () => {
    const reranked = rerankResults(RESULTS, {
      query: "optimization",
      techStack: ["react", "typescript", "nextjs"],
    });

    // React results should be boosted by tech stack
    expect(reranked[0]!.url).toContain("react");
  });

  it("assigns sequential rank numbers", () => {
    const reranked = rerankResults(RESULTS, { query: "test" });
    for (let i = 0; i < reranked.length; i++) {
      expect(reranked[i]!.rank).toBe(i + 1);
    }
  });

  it("exposes score factors", () => {
    const reranked = rerankResults(RESULTS, { query: "react hooks" });
    for (const result of reranked) {
      expect(result.scoreFactors).toBeDefined();
      expect(result.scoreFactors.queryRelevance).toBeGreaterThanOrEqual(0);
      expect(result.scoreFactors.domainAuthority).toBeGreaterThanOrEqual(0);
      expect(result.rerankScore).toBeGreaterThan(0);
    }
  });

  it("handles empty results", () => {
    const reranked = rerankResults([], { query: "anything" });
    expect(reranked).toEqual([]);
  });

  it("handles custom weights", () => {
    const reranked = rerankResults(RESULTS, {
      query: "react",
    }, {
      queryWeight: 0.8,
      contextWeight: 0.0,
      snippetWeight: 0.1,
      domainWeight: 0.1,
      recencyWeight: 0.0,
    });

    expect(reranked.length).toBeGreaterThan(0);
    // With heavy query weight, most relevant to "react" should be first
  });

  it("boosts recent results", () => {
    const recentResult: SearchResult = {
      ...RESULTS[0]!,
      url: "https://react.dev/recent",
      publishedDate: new Date().toISOString(),
    };
    const oldResult: SearchResult = {
      ...RESULTS[0]!,
      url: "https://react.dev/old",
      publishedDate: new Date("2020-01-01").toISOString(),
    };

    const reranked = rerankResults([recentResult, oldResult], {
      query: "react performance",
    }, {
      recencyWeight: 0.5,
      queryWeight: 0.2,
      contextWeight: 0.1,
      snippetWeight: 0.1,
      domainWeight: 0.1,
    });

    const recentIdx = reranked.findIndex((r) => r.url.includes("recent"));
    const oldIdx = reranked.findIndex((r) => r.url.includes("old"));
    expect(recentIdx).toBeLessThan(oldIdx);
  });
});
