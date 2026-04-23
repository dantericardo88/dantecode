// ============================================================================
// packages/core/src/__tests__/aider-pagerank.test.ts
//
// Unit tests for the upgraded PageRank functions in repo-map-ast.ts.
// Tests computeFileScores, formatRepoMap, and renderToTree.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  computeFileScores,
  formatRepoMap,
  renderToTree,
  type RankedFile,
  type ImportEdge,
} from "../repo-map-ast.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSymbol(
  name: string,
  kind: "function" | "class" | "interface" | "type" | "const" | "enum",
  line: number,
  filePath: string,
) {
  return { name, kind, signature: `${kind} ${name}`, filePath, line };
}

function makeRankedFile(
  filePath: string,
  score: number,
  symbolCount = 2,
): RankedFile {
  return {
    filePath,
    score,
    symbols: Array.from({ length: symbolCount }, (_, i) =>
      makeSymbol(`sym${i}`, "function", i + 1, filePath),
    ),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("computeFileScores", () => {
  // 1. chatFiles gives personalized file a higher score
  it("gives chatFiles a higher PageRank score than neutral files", () => {
    const files = ["a.ts", "b.ts", "c.ts"];
    const edges: ImportEdge[] = [];

    const scores = computeFileScores(edges, files, { chatFiles: ["a.ts"] });

    const aScore = scores.get("a.ts") ?? 0;
    const bScore = scores.get("b.ts") ?? 0;
    const cScore = scores.get("c.ts") ?? 0;

    expect(aScore).toBeGreaterThan(bScore);
    expect(aScore).toBeGreaterThan(cScore);
  });

  // 2. Empty personalization yields uniform scores (backward compat)
  it("distributes scores uniformly with no personalization", () => {
    const files = ["x.ts", "y.ts", "z.ts"];
    const edges: ImportEdge[] = [];

    const scores = computeFileScores(edges, files, {});

    const vals = files.map((f) => scores.get(f) ?? 0);
    const [first, ...rest] = vals;
    // All scores should be equal within floating-point tolerance
    for (const v of rest) {
      expect(Math.abs(v - first!)).toBeLessThan(1e-9);
    }
  });
});

describe("formatRepoMap", () => {
  // 3. Binary search returns output fitting within token budget
  it("returns output whose char length is within 4× the token budget", () => {
    const budget = 2000;
    // Create many files to force binary search to do real work
    const rankedFiles: RankedFile[] = Array.from({ length: 100 }, (_, i) =>
      makeRankedFile(`src/module${i}.ts`, 1 / (i + 1), 5),
    );

    const output = formatRepoMap(rankedFiles, budget);

    // Each token ≈ 4 chars, so output.length must be ≤ budget * 4
    expect(output.length).toBeLessThanOrEqual(budget * 4);
  });

  // 4. Output contains "(line " annotation
  it('output contains "(line " annotation for symbol lines', () => {
    const rankedFiles: RankedFile[] = [
      {
        filePath: "src/auth.ts",
        score: 1,
        symbols: [makeSymbol("authenticate", "function", 12, "src/auth.ts")],
      },
    ];

    const output = formatRepoMap(rankedFiles, 500);

    expect(output).toContain("(line ");
  });
});

describe("renderToTree", () => {
  // 5. Output has "filepath:\n" structure
  it('produces "filepath:\\n" structure for each file', () => {
    const rankedFiles: RankedFile[] = [
      makeRankedFile("src/service.ts", 1, 1),
    ];

    const output = renderToTree(rankedFiles);

    expect(output).toContain("src/service.ts:\n");
  });

  // 6. Output contains indented kind+name lines
  it('contains "  function" or "  class" indented lines', () => {
    const rankedFiles: RankedFile[] = [
      {
        filePath: "src/utils.ts",
        score: 1,
        symbols: [
          makeSymbol("doStuff", "function", 3, "src/utils.ts"),
          makeSymbol("MyClass", "class", 10, "src/utils.ts"),
        ],
      },
    ];

    const output = renderToTree(rankedFiles);

    // Should have indented function or class entries
    const hasFunction = output.includes("  function");
    const hasClass = output.includes("  class");
    expect(hasFunction || hasClass).toBe(true);
  });

  // 7. Binary search edge case: empty rankedFiles returns ""
  it("returns empty string for empty rankedFiles", () => {
    expect(renderToTree([], 2000)).toBe("");
  });

  // 8. renderToTree appends "... (" for truncated symbols when a file has > 30 symbols
  it('appends "... (" for truncated symbols when file has more than 30 symbols', () => {
    // Create a file with 35 symbols (> 30 max per file)
    const symbols = Array.from({ length: 35 }, (_, i) =>
      makeSymbol(`func${i}`, "function", i + 1, "src/big.ts"),
    );

    const rankedFiles: RankedFile[] = [
      {
        filePath: "src/big.ts",
        score: 1,
        symbols,
      },
    ];

    // Use a very large budget so the token cap doesn't interfere
    const output = renderToTree(rankedFiles, 99_999);

    // renderToTree slices to 30 and appends "... (N more)"
    expect(output).toContain("... (");
  });
});
