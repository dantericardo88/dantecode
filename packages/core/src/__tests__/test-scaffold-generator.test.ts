// packages/core/src/__tests__/test-scaffold-generator.test.ts
import { describe, it, expect } from "vitest";
import {
  detectFrameworkFromIssue,
  generateTestNames,
  extractReproductionCode,
  generateTestScaffold,
  generateTestScaffolds,
  formatScaffoldSummary,
} from "../test-scaffold-generator.js";
import type { AnalyzedIssue } from "../issue-analyzer.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeIssue(overrides: Partial<AnalyzedIssue> = {}): AnalyzedIssue {
  return {
    type: "bug",
    severity: "high",
    problemStatement: "The parseGitLog function throws TypeError when passed an empty string",
    errorSignatures: [
      { type: "TypeError", message: "Cannot read properties of undefined" },
    ],
    fileHints: [
      { path: "src/git-context-provider.ts", confidence: 0.9, reason: "backtick" },
    ],
    symbols: ["parseGitLog", "captureGitContext"],
    reproductionSteps: [
      { step: 1, action: 'Call parseGitLog("") with empty string argument' },
    ],
    searchQueries: ["parseGitLog TypeError empty string"],
    ...overrides,
  };
}

// ─── detectFrameworkFromIssue ─────────────────────────────────────────────────

describe("detectFrameworkFromIssue", () => {
  it("detects pytest from python text", () => {
    const issue = makeIssue({ fileHints: [{ path: "parser.py", confidence: 0.9, reason: "backtick" }] });
    expect(detectFrameworkFromIssue(issue)).toBe("pytest");
  });

  it("detects cargo from Rust text", () => {
    const issue = makeIssue({ fileHints: [{ path: "src/lib.rs", confidence: 0.9, reason: "backtick" }] });
    expect(detectFrameworkFromIssue(issue)).toBe("cargo");
  });

  it("detects go-test from Go text", () => {
    const issue = makeIssue({ fileHints: [{ path: "main.go", confidence: 0.8, reason: "backtick" }] });
    expect(detectFrameworkFromIssue(issue)).toBe("go-test");
  });

  it("detects vitest from vitest keyword", () => {
    const issue = makeIssue({ problemStatement: "vitest test fails" });
    expect(detectFrameworkFromIssue(issue)).toBe("vitest");
  });

  it("detects jest from jest keyword", () => {
    const issue = makeIssue({ problemStatement: "jest runner crashes" });
    expect(detectFrameworkFromIssue(issue)).toBe("jest");
  });

  it("defaults to vitest for TypeScript files", () => {
    const issue = makeIssue({ fileHints: [{ path: "src/util.ts", confidence: 0.9, reason: "backtick" }] });
    expect(detectFrameworkFromIssue(issue)).toBe("vitest");
  });

  it("defaults to vitest when no signals", () => {
    const issue = makeIssue({ fileHints: [], problemStatement: "generic error" });
    expect(detectFrameworkFromIssue(issue)).toBe("vitest");
  });
});

// ─── generateTestNames ────────────────────────────────────────────────────────

describe("generateTestNames", () => {
  it("generates at least one test name", () => {
    const names = generateTestNames(makeIssue(), 3);
    expect(names.length).toBeGreaterThanOrEqual(1);
  });

  it("respects maxTests limit", () => {
    const names = generateTestNames(makeIssue(), 2);
    expect(names.length).toBeLessThanOrEqual(2);
  });

  it("first test includes issue problem statement content", () => {
    const names = generateTestNames(makeIssue({ problemStatement: "Bug: parse fails with empty input" }), 3);
    expect(names[0]).toContain("parse");
  });

  it("includes symbol-based test when symbols present", () => {
    const issue = makeIssue({ symbols: ["parseGitLog"] });
    const names = generateTestNames(issue, 5);
    const hasSymbolTest = names.some((n) => n.includes("parseGitLog"));
    expect(hasSymbolTest).toBe(true);
  });

  it("includes error type test when error signatures present", () => {
    const issue = makeIssue({ errorSignatures: [{ type: "TypeError", message: "Cannot read" }] });
    const names = generateTestNames(issue, 5);
    const hasErrorTest = names.some((n) => n.includes("TypeError"));
    expect(hasErrorTest).toBe(true);
  });

  it("all test names are non-empty strings", () => {
    const names = generateTestNames(makeIssue(), 3);
    for (const name of names) {
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(0);
    }
  });
});

// ─── extractReproductionCode ──────────────────────────────────────────────────

describe("extractReproductionCode", () => {
  it("extracts first code block from reproduction steps", () => {
    const issue = makeIssue({
      reproductionSteps: [
        { step: 1, action: 'parseGitLog("")' },
      ],
    });
    const code = extractReproductionCode(issue);
    expect(code).toContain("parseGitLog");
  });

  it("returns null when no code blocks", () => {
    const issue = makeIssue({
      reproductionSteps: [
        { step: 1, action: "Install" },
      ],
    });
    expect(extractReproductionCode(issue)).toBeNull();
  });

  it("returns null for empty reproduction steps", () => {
    const issue = makeIssue({ reproductionSteps: [] });
    expect(extractReproductionCode(issue)).toBeNull();
  });

  it("skips code blocks shorter than 10 chars", () => {
    const issue = makeIssue({
      reproductionSteps: [
        { step: 1, action: "x()" },
        { step: 2, action: 'parseGitLog("")' },
      ],
    });
    const code = extractReproductionCode(issue);
    expect(code).toContain("parseGitLog");
  });
});

// ─── generateTestScaffold ─────────────────────────────────────────────────────

describe("generateTestScaffold", () => {
  it("generates a vitest scaffold for TS files", () => {
    const issue = makeIssue();
    const scaffold = generateTestScaffold(issue, {
      projectRoot: "/project",
      framework: "vitest",
    });
    expect(scaffold.framework).toBe("vitest");
    expect(scaffold.content).toContain("vitest");
    expect(scaffold.content).toContain("describe");
    expect(scaffold.content).toContain("it(");
  });

  it("generates a pytest scaffold for Python", () => {
    const issue = makeIssue({ fileHints: [{ path: "parser.py", confidence: 0.9, reason: "backtick" }] });
    const scaffold = generateTestScaffold(issue, {
      projectRoot: "/project",
      framework: "pytest",
    });
    expect(scaffold.framework).toBe("pytest");
    expect(scaffold.content).toContain("import pytest");
    expect(scaffold.content).toContain("def test_");
  });

  it("generates a cargo scaffold for Rust", () => {
    const scaffold = generateTestScaffold(makeIssue(), {
      projectRoot: "/project",
      framework: "cargo",
    });
    expect(scaffold.framework).toBe("cargo");
    expect(scaffold.content).toContain("#[test]");
    expect(scaffold.content).toContain("#[cfg(test)]");
  });

  it("scaffold includes the problem statement as a comment", () => {
    const issue = makeIssue({ problemStatement: "Bug: parse fails with empty input" });
    const scaffold = generateTestScaffold(issue, { projectRoot: "/project", framework: "vitest" });
    expect(scaffold.content).toContain("Bug: parse fails");
  });

  it("scaffold includes extracted symbols", () => {
    const issue = makeIssue({ symbols: ["parseGitLog"] });
    const scaffold = generateTestScaffold(issue, { projectRoot: "/project", framework: "vitest" });
    expect(scaffold.content).toContain("parseGitLog");
  });

  it("scaffold includes reproduction code when present", () => {
    const issue = makeIssue({
      reproductionSteps: [{ step: 1, action: 'parseGitLog("")' }],
    });
    const scaffold = generateTestScaffold(issue, { projectRoot: "/project", framework: "vitest" });
    expect(scaffold.content).toContain('parseGitLog("")');
  });

  it("isRegression is always true", () => {
    const scaffold = generateTestScaffold(makeIssue(), { projectRoot: "/project" });
    expect(scaffold.isRegression).toBe(true);
  });

  it("testNames contains the generated test names", () => {
    const scaffold = generateTestScaffold(makeIssue(), { projectRoot: "/project", maxTests: 2 });
    expect(scaffold.testNames.length).toBeGreaterThanOrEqual(1);
    expect(scaffold.testNames.length).toBeLessThanOrEqual(2);
  });

  it("filePath ends with .test.ts for vitest", () => {
    const scaffold = generateTestScaffold(makeIssue(), { projectRoot: "/project", framework: "vitest" });
    expect(scaffold.filePath).toMatch(/\.test\.ts$/);
  });
});

// ─── generateTestScaffolds ────────────────────────────────────────────────────

describe("generateTestScaffolds", () => {
  it("returns at least one scaffold", () => {
    const scaffolds = generateTestScaffolds(makeIssue(), { projectRoot: "/project" });
    expect(scaffolds.length).toBeGreaterThanOrEqual(1);
  });

  it("deduplicates scaffolds by filePath", () => {
    // Two fileHints mapping to the same test file
    const issue = makeIssue({
      fileHints: [
        { path: "src/git.ts", confidence: 0.9, reason: "backtick" },
        { path: "src/git.ts", confidence: 0.8, reason: "import" },
      ],
    });
    const scaffolds = generateTestScaffolds(issue, { projectRoot: "/project", framework: "vitest" });
    const paths = scaffolds.map((s) => s.filePath);
    const uniquePaths = [...new Set(paths)];
    expect(paths.length).toBe(uniquePaths.length);
  });

  it("limits to 3 scaffolds max", () => {
    const issue = makeIssue({
      fileHints: [
        { path: "src/a.ts", confidence: 0.9, reason: "backtick" },
        { path: "src/b.ts", confidence: 0.8, reason: "backtick" },
        { path: "src/c.ts", confidence: 0.7, reason: "backtick" },
        { path: "src/d.ts", confidence: 0.6, reason: "backtick" },
      ],
    });
    const scaffolds = generateTestScaffolds(issue, { projectRoot: "/project" });
    expect(scaffolds.length).toBeLessThanOrEqual(3);
  });
});

// ─── formatScaffoldSummary ────────────────────────────────────────────────────

describe("formatScaffoldSummary", () => {
  it("returns 'No scaffolds generated' for empty array", () => {
    expect(formatScaffoldSummary([])).toContain("No scaffolds");
  });

  it("includes file paths", () => {
    const scaffold = generateTestScaffold(makeIssue(), { projectRoot: "/project", framework: "vitest" });
    const summary = formatScaffoldSummary([scaffold]);
    expect(summary).toContain(scaffold.filePath);
  });

  it("includes framework", () => {
    const scaffold = generateTestScaffold(makeIssue(), { projectRoot: "/project", framework: "vitest" });
    const summary = formatScaffoldSummary([scaffold]);
    expect(summary).toContain("vitest");
  });

  it("includes test names", () => {
    const scaffold = generateTestScaffold(makeIssue(), { projectRoot: "/project", framework: "vitest" });
    const summary = formatScaffoldSummary([scaffold]);
    for (const name of scaffold.testNames) {
      expect(summary).toContain(name);
    }
  });

  it("includes header", () => {
    const scaffold = generateTestScaffold(makeIssue(), { projectRoot: "/project", framework: "vitest" });
    const summary = formatScaffoldSummary([scaffold]);
    expect(summary).toContain("## Generated Test Scaffolds");
  });
});
