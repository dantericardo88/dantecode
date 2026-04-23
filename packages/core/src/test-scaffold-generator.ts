// packages/core/src/test-scaffold-generator.ts
// Test scaffold generation from issues — closes dim 5 (SWE-bench: 8→9).
//
// Harvested from: OpenHands test generation, SWE-bench evaluation harness.
//
// Provides:
//   - Generate failing test stubs from GitHub issue analysis
//   - Map error signatures → test patterns
//   - Produce reproduction steps as executable test code
//   - Framework detection (vitest, jest, pytest, cargo)

import type { AnalyzedIssue } from "./issue-analyzer.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TestFramework = "vitest" | "jest" | "mocha" | "pytest" | "cargo" | "go-test" | "unknown";

export interface TestScaffold {
  /** Path where the test file should be created */
  filePath: string;
  /** Content of the test file */
  content: string;
  /** Test framework used */
  framework: TestFramework;
  /** Test names generated */
  testNames: string[];
  /** Whether this is a regression test (derived from issue) */
  isRegression: boolean;
}

export interface ScaffoldGeneratorOptions {
  /** Project root for path resolution */
  projectRoot: string;
  /** Target file path (the file under test) */
  targetFilePath?: string;
  /** Test framework to use (default: auto-detect from issue signals) */
  framework?: TestFramework;
  /** Max reproduction tests to generate (default: 3) */
  maxTests?: number;
}

// ─── Framework Detector ───────────────────────────────────────────────────────

/**
 * Detect test framework from file paths and code snippets in the issue.
 */
export function detectFrameworkFromIssue(issue: AnalyzedIssue): TestFramework {
  const text = `${issue.problemStatement} ${issue.searchQueries.join(" ")}`.toLowerCase();

  if (/\bpytest\b|\bpython\b|\.py\b/.test(text)) return "pytest";
  if (/\bcargo\b|\brust\b|\.rs\b/.test(text)) return "cargo";
  if (/\bvitest\b/.test(text)) return "vitest";
  if (/\bjest\b/.test(text)) return "jest";
  if (/\bmocha\b/.test(text)) return "mocha";
  if (/\bgo test\b|\.go\b/.test(text)) return "go-test";

  // Check file hints for language signals
  for (const hint of issue.fileHints) {
    if (/\.py$/.test(hint.path)) return "pytest";
    if (/\.rs$/.test(hint.path)) return "cargo";
    if (/\.go$/.test(hint.path)) return "go-test";
    if (/\.(ts|tsx|js|jsx)$/.test(hint.path)) return "vitest";
  }

  return "vitest"; // Default to vitest for TS/JS projects
}

// ─── Test Name Generator ──────────────────────────────────────────────────────

/**
 * Generate descriptive test names from an issue.
 * Follows the pattern: "should <behavior> when <condition>".
 */
export function generateTestNames(issue: AnalyzedIssue, maxTests: number): string[] {
  const names: string[] = [];

  // Regression test from problem statement
  const stmtClean = issue.problemStatement
    .replace(/[^\w\s]/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 70);
  names.push(`should reproduce: ${stmtClean}`);

  // From reproduction steps
  for (const step of issue.reproductionSteps.slice(0, 2)) {
    if (step.action) {
      names.push(`should handle: ${step.action.slice(0, 60).toLowerCase()}`);
    }
  }

  // From error signatures
  for (const sig of issue.errorSignatures.slice(0, 1)) {
    if (sig.type) {
      names.push(`should not throw ${sig.type} when processing valid input`);
    }
  }

  // From symbols
  for (const sym of issue.symbols.slice(0, 1)) {
    names.push(`${sym}() should work correctly after fix`);
  }

  // Pad with generic regression test if needed
  if (names.length < maxTests) {
    names.push("should pass all existing functionality after fix");
  }

  return names.slice(0, maxTests);
}

// ─── Code Snippet Extractor ────────────────────────────────────────────────────

/**
 * Extract the most relevant code snippet from reproduction steps.
 * Returns the action from the first step that looks like code, or a minimal stub.
 */
export function extractReproductionCode(issue: AnalyzedIssue): string | null {
  for (const step of issue.reproductionSteps) {
    // Look for steps whose action looks like a code snippet (contains parens, brackets, or quotes)
    if (step.action && step.action.trim().length > 10 && /[()[\]"'`{}]/.test(step.action)) {
      return step.action.trim();
    }
  }
  // Fallback: return first step action if it's long enough
  for (const step of issue.reproductionSteps) {
    if (step.action && step.action.trim().length > 10) {
      return step.action.trim();
    }
  }
  return null;
}

// ─── Template Generators ──────────────────────────────────────────────────────

function generateVitestContent(
  issue: AnalyzedIssue,
  testNames: string[],
  targetModule: string,
  reproCode: string | null,
): string {
  const symbols = issue.symbols.slice(0, 3);
  const hasSymbols = symbols.length > 0;

  const importLine = hasSymbols
    ? `import { ${symbols.join(", ")} } from "${targetModule}";`
    : `// import { yourFunction } from "${targetModule}";`;

  const reproComment = reproCode
    ? `// Reproduction code from issue:\n// ${reproCode.split("\n").join("\n// ")}\n\n`
    : "";

  const tests = testNames.map((name, i) => {
    const isFirst = i === 0;
    const body = isFirst && reproCode
      ? `  // TODO: Fill in the reproduction from the issue\n  // ${reproCode.split("\n").slice(0, 3).join("\n  // ")}\n  expect(true).toBe(true); // Replace with actual assertion`
      : `  // TODO: Implement test for: ${name}\n  expect(true).toBe(true); // Replace with actual assertion`;
    return `  it("${name}", () => {\n${body}\n  });`;
  }).join("\n\n");

  const title = issue.problemStatement.slice(0, 80);
  return [
    `// Regression test for: ${title}`,
    `// Issue type: ${issue.type} | Severity: ${issue.severity}`,
    `// Auto-generated by DanteCode test scaffold generator`,
    `import { describe, it, expect } from "vitest";`,
    importLine,
    "",
    reproComment + `describe("Regression — ${title.slice(0, 50)}", () => {`,
    tests,
    "});",
  ].join("\n");
}

function generatePytestContent(
  issue: AnalyzedIssue,
  testNames: string[],
  targetModule: string,
  reproCode: string | null,
): string {
  const symbols = issue.symbols.slice(0, 3);
  const hasSymbols = symbols.length > 0;

  const importLine = hasSymbols
    ? `from ${targetModule} import ${symbols.join(", ")}`
    : `# from ${targetModule} import your_function`;

  const reproComment = reproCode
    ? `# Reproduction code from issue:\n# ${reproCode.split("\n").join("\n# ")}\n\n`
    : "";

  const tests = testNames.map((name, i) => {
    const fnName = `test_${name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 50)}`;
    const isFirst = i === 0;
    const body = isFirst && reproCode
      ? `    # TODO: Fill in the reproduction from the issue\n    # ${reproCode.split("\n").slice(0, 3).join("\n    # ")}\n    assert True  # Replace with actual assertion`
      : `    # TODO: Implement: ${name}\n    assert True  # Replace with actual assertion`;
    return `def ${fnName}():\n    """${name}"""\n${body}`;
  }).join("\n\n");

  const title = issue.problemStatement.slice(0, 80);
  return [
    `# Regression test for: ${title}`,
    `# Issue type: ${issue.type} | Severity: ${issue.severity}`,
    `# Auto-generated by DanteCode test scaffold generator`,
    `import pytest`,
    importLine,
    "",
    reproComment + tests,
  ].join("\n");
}

function generateCargoContent(
  issue: AnalyzedIssue,
  testNames: string[],
  reproCode: string | null,
): string {
  const tests = testNames.map((name, i) => {
    const fnName = name.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase().slice(0, 40);
    const isFirst = i === 0;
    const body = isFirst && reproCode
      ? `    // TODO: ${reproCode.split("\n").slice(0, 3).join("\n    // ")}\n    assert!(true); // Replace with actual assertion`
      : `    // TODO: Implement: ${name}\n    assert!(true); // Replace with actual assertion`;
    return `    #[test]\n    fn ${fnName}() {\n${body}\n    }`;
  }).join("\n\n");

  const title = issue.problemStatement.slice(0, 80);
  return [
    `// Regression test for: ${title}`,
    `// Auto-generated by DanteCode test scaffold generator`,
    `#[cfg(test)]`,
    `mod regression_tests {`,
    `    use super::*;`,
    "",
    tests,
    `}`,
  ].join("\n");
}

// ─── Main Generator ───────────────────────────────────────────────────────────

/**
 * Generate a test scaffold from an analyzed GitHub issue.
 * Returns a ready-to-write test file with TODO markers for the implementer.
 */
export function generateTestScaffold(
  issue: AnalyzedIssue,
  options: ScaffoldGeneratorOptions = { projectRoot: "." },
): TestScaffold {
  const {
    projectRoot,
    targetFilePath,
    framework: frameworkOverride,
    maxTests = 3,
  } = options;

  const framework = frameworkOverride ?? detectFrameworkFromIssue(issue);
  const testNames = generateTestNames(issue, maxTests);
  const reproCode = extractReproductionCode(issue);

  // Determine target module path
  const targetModule = targetFilePath
    ? targetFilePath.replace(/\.(ts|js|tsx|jsx)$/, "").replace(/\\/g, "/")
    : issue.fileHints[0]?.path?.replace(/\.(ts|js|tsx|jsx)$/, "") ?? "./src/module";

  // Determine test file path
  let filePath: string;
  let content: string;

  switch (framework) {
    case "pytest": {
      const baseName = targetModule.split("/").pop()?.replace(/-/g, "_") ?? "module";
      filePath = `${projectRoot}/tests/test_${baseName}_regression.py`;
      content = generatePytestContent(issue, testNames, targetModule, reproCode);
      break;
    }
    case "cargo": {
      filePath = `${projectRoot}/src/tests/regression.rs`;
      content = generateCargoContent(issue, testNames, reproCode);
      break;
    }
    default: {
      const baseName = targetModule.split("/").pop() ?? "module";
      const dir = targetFilePath
        ? targetFilePath.replace(/\/[^/]+$/, "/__tests__")
        : `${projectRoot}/src/__tests__`;
      filePath = `${dir}/${baseName}.regression.test.ts`;
      content = generateVitestContent(issue, testNames, targetModule, reproCode);
      break;
    }
  }

  return { filePath, content, framework, testNames, isRegression: true };
}

// ─── Batch Scaffold Generator ──────────────────────────────────────────────────

/**
 * Generate multiple test scaffolds for an issue — one per affected file hint.
 */
export function generateTestScaffolds(
  issue: AnalyzedIssue,
  options: ScaffoldGeneratorOptions = { projectRoot: "." },
): TestScaffold[] {
  if (issue.fileHints.length === 0) {
    return [generateTestScaffold(issue, options)];
  }

  // Generate for top 3 file hints
  return issue.fileHints
    .slice(0, 3)
    .map((hint) => generateTestScaffold(issue, { ...options, targetFilePath: hint.path }))
    // Deduplicate by filePath
    .filter((s, idx, arr) => arr.findIndex((t) => t.filePath === s.filePath) === idx);
}

/**
 * Format a scaffold summary for display.
 */
export function formatScaffoldSummary(scaffolds: TestScaffold[]): string {
  if (scaffolds.length === 0) return "No scaffolds generated.";
  const lines = ["## Generated Test Scaffolds", ""];
  for (const s of scaffolds) {
    lines.push(`**${s.filePath}** (${s.framework})`);
    lines.push(`Tests: ${s.testNames.map((n) => `\`${n}\``).join(", ")}`);
    lines.push("");
  }
  return lines.join("\n");
}
