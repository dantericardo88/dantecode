import { describe, it, expect } from "vitest";
import {
  synthesizeResults,
  buildSynthesisPrompt,
  formatCitationBlock,
  formatSynthesizedResult,
} from "./search-synthesizer.js";
import type { SearchResult } from "./search-providers.js";

const MOCK_RESULTS: SearchResult[] = [
  {
    title: "TypeScript Handbook",
    url: "https://typescriptlang.org/docs",
    snippet:
      "TypeScript is a strongly typed programming language that builds on JavaScript, giving you better tooling at any scale.",
    source: "tavily",
    rank: 1,
    relevanceScore: 0.95,
  },
  {
    title: "TypeScript Tutorial - W3Schools",
    url: "https://w3schools.com/typescript",
    snippet: "TypeScript tutorial for beginners. Learn TypeScript with examples and exercises.",
    source: "duckduckgo",
    rank: 2,
  },
  {
    title: "TypeScript Deep Dive",
    url: "https://basarat.gitbook.io/typescript",
    snippet:
      "A comprehensive guide to TypeScript covering advanced patterns, configuration, and best practices for production applications.",
    source: "exa",
    rank: 3,
    rawContent:
      "TypeScript is a superset of JavaScript. It adds optional types, classes, and modules. TypeScript compiles to plain JavaScript. It supports every browser, host, or OS.",
    relevanceScore: 0.85,
  },
];

// ============================================================================
// synthesizeResults
// ============================================================================

describe("synthesizeResults", () => {
  it("returns empty synthesis for no results", () => {
    const result = synthesizeResults([], "test query");
    expect(result.summary).toContain("No results found");
    expect(result.citations).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it("creates summary with inline citations", () => {
    const result = synthesizeResults(MOCK_RESULTS, "TypeScript basics");
    expect(result.summary).toContain("[1]");
    expect(result.citations).toHaveLength(3);
    expect(result.citations[0]!.url).toBe("https://typescriptlang.org/docs");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("includes raw content key points when available", () => {
    const result = synthesizeResults(MOCK_RESULTS, "TypeScript", { useRawContent: true });
    // Should extract key points from rawContent
    expect(result.summary.length).toBeGreaterThan(50);
  });

  it("respects maxCitations option", () => {
    const result = synthesizeResults(MOCK_RESULTS, "test", { maxCitations: 2 });
    expect(result.citations).toHaveLength(2);
  });

  it("preserves raw results", () => {
    const result = synthesizeResults(MOCK_RESULTS, "test");
    expect(result.rawResults).toHaveLength(3);
    expect(result.query).toBe("test");
  });

  it("calculates confidence based on relevance scores", () => {
    const highRelevance = MOCK_RESULTS.map((r) => ({ ...r, relevanceScore: 0.95 }));
    const result = synthesizeResults(highRelevance, "TypeScript");
    expect(result.confidence).toBeGreaterThan(0.5);
  });
});

// ============================================================================
// buildSynthesisPrompt
// ============================================================================

describe("buildSynthesisPrompt", () => {
  it("generates system + user prompt pair", () => {
    const { system, user } = buildSynthesisPrompt(MOCK_RESULTS, "TypeScript basics");
    expect(system).toContain("research assistant");
    expect(system).toContain("citations");
    expect(user).toContain("TypeScript basics");
    expect(user).toContain("[1]");
    expect(user).toContain("[2]");
  });

  it("includes raw content when available", () => {
    const { user } = buildSynthesisPrompt(MOCK_RESULTS, "test", 10);
    expect(user).toContain("Full text:");
  });

  it("respects maxCitations", () => {
    const { user } = buildSynthesisPrompt(MOCK_RESULTS, "test", 1);
    expect(user).toContain("[1]");
    expect(user).not.toContain("[2]");
  });
});

// ============================================================================
// formatCitationBlock
// ============================================================================

describe("formatCitationBlock", () => {
  it("returns empty string for no citations", () => {
    expect(formatCitationBlock([])).toBe("");
  });

  it("formats citations with URLs", () => {
    const citations = [
      { index: 1, url: "https://example.com", title: "Example", snippet: "Snippet" },
      { index: 2, url: "https://other.com", title: "Other", snippet: "More" },
    ];
    const block = formatCitationBlock(citations);
    expect(block).toContain("Sources:");
    expect(block).toContain("[1] Example — https://example.com");
    expect(block).toContain("[2] Other — https://other.com");
  });
});

// ============================================================================
// formatSynthesizedResult
// ============================================================================

describe("formatSynthesizedResult", () => {
  it("combines summary and citation block", () => {
    const result = synthesizeResults(MOCK_RESULTS, "TypeScript");
    const formatted = formatSynthesizedResult(result);
    expect(formatted).toContain(result.summary);
    expect(formatted).toContain("Sources:");
  });
});
