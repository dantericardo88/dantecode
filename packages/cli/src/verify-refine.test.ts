// ============================================================================
// @dantecode/cli — Verify-Refine + Prompt Enhancement Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  tryQuickFix,
  buildTargetedFixPrompt,
  detectLanguageFromFiles,
  getLanguageBestPractices,
} from "./prompt-enhancements.js";
import type { PDSEViolation } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// tryQuickFix
// ----------------------------------------------------------------------------

describe("tryQuickFix", () => {
  it("removes a standalone console.log line", () => {
    const code = [
      "function add(a: number, b: number) {",
      "  console.log(a, b);",
      "  return a + b;",
      "}",
    ].join("\n");

    const violations: PDSEViolation[] = [
      {
        type: "console_log_leftover",
        severity: "soft",
        file: "math.ts",
        line: 2,
        message: "Leftover console.log statement",
      },
    ];

    const result = tryQuickFix(code, violations);
    expect(result).not.toBeNull();
    expect(result!.fixedCount).toBe(1);
    expect(result!.code).not.toContain("console.log");
    expect(result!.code).toContain("return a + b;");
  });

  it("removes multiple console.log lines", () => {
    const code = [
      "const x = 1;",
      "console.log(x);",
      "const y = 2;",
      "console.log(y);",
      "export { x, y };",
    ].join("\n");

    const violations: PDSEViolation[] = [
      {
        type: "console_log_leftover",
        severity: "soft",
        file: "test.ts",
        line: 2,
        message: "Leftover console.log",
      },
      {
        type: "console_log_leftover",
        severity: "soft",
        file: "test.ts",
        line: 4,
        message: "Leftover console.log",
      },
    ];

    const result = tryQuickFix(code, violations);
    expect(result).not.toBeNull();
    expect(result!.fixedCount).toBe(2);
    expect(result!.code).not.toContain("console.log");
    expect(result!.code).toContain("const x = 1;");
    expect(result!.code).toContain("const y = 2;");
    expect(result!.code).toContain("export { x, y };");
  });

  it("does not remove console.log embedded in expressions", () => {
    const code = [
      "const logger = console.log;",
      "doSomething();",
    ].join("\n");

    const violations: PDSEViolation[] = [
      {
        type: "console_log_leftover",
        severity: "soft",
        file: "test.ts",
        line: 1,
        message: "console.log reference",
      },
    ];

    const result = tryQuickFix(code, violations);
    // Should not fix because the line is not a pure console.log statement
    expect(result).toBeNull();
  });

  it("returns null when no violations can be fixed", () => {
    const code = "const x: any = {};";
    const violations: PDSEViolation[] = [
      {
        type: "type_any",
        severity: "soft",
        file: "test.ts",
        line: 1,
        message: "Use of 'any' type",
      },
    ];

    const result = tryQuickFix(code, violations);
    expect(result).toBeNull();
  });

  it("returns null for empty violations array", () => {
    const result = tryQuickFix("code", []);
    expect(result).toBeNull();
  });

  it("skips violations without line numbers", () => {
    const code = "console.log('hi');";
    const violations: PDSEViolation[] = [
      {
        type: "console_log_leftover",
        severity: "soft",
        file: "test.ts",
        message: "Leftover console.log",
        // no line number
      },
    ];

    const result = tryQuickFix(code, violations);
    expect(result).toBeNull();
  });

  it("handles import_unused type gracefully (no auto-fix)", () => {
    const code = "import { unused } from './utils';";
    const violations: PDSEViolation[] = [
      {
        type: "import_unused",
        severity: "soft",
        file: "test.ts",
        line: 1,
        message: "Unused import: unused",
      },
    ];

    const result = tryQuickFix(code, violations);
    expect(result).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// buildTargetedFixPrompt
// ----------------------------------------------------------------------------

describe("buildTargetedFixPrompt", () => {
  it("includes file path in the prompt", () => {
    const violations: PDSEViolation[] = [
      {
        type: "console_log_leftover",
        severity: "soft",
        file: "test.ts",
        line: 5,
        message: "Leftover console.log",
      },
    ];

    const result = buildTargetedFixPrompt("src/test.ts", violations, "line1\nline2\nline3\nline4\nconsole.log('x');\nline6");
    expect(result).toContain("src/test.ts");
  });

  it("lists all violations with severity and type", () => {
    const violations: PDSEViolation[] = [
      {
        type: "console_log_leftover",
        severity: "soft",
        file: "a.ts",
        line: 3,
        message: "Remove console.log",
      },
      {
        type: "stub_detected",
        severity: "hard",
        file: "a.ts",
        line: 10,
        message: "Stub detected",
      },
    ];

    const result = buildTargetedFixPrompt("a.ts", violations, "x\n".repeat(15));
    expect(result).toContain("[soft] console_log");
    expect(result).toContain("[hard] stub");
    expect(result).toContain("line 3");
    expect(result).toContain("line 10");
  });

  it("shows relevant code lines around violations", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const code = lines.join("\n");

    const violations: PDSEViolation[] = [
      {
        type: "console_log_leftover",
        severity: "soft",
        file: "test.ts",
        line: 10,
        message: "Remove it",
      },
    ];

    const result = buildTargetedFixPrompt("test.ts", violations, code);
    // Should include lines 7-13 (3 before and 3 after line 10)
    expect(result).toContain("7: line 7");
    expect(result).toContain("10: line 10");
    expect(result).toContain("13: line 13");
    // Should NOT include distant lines (use line-start anchoring to avoid substring matches)
    expect(result).not.toMatch(/^1: line 1$/m);
    expect(result).not.toMatch(/^20: line 20$/m);
  });

  it("instructs the model to use Edit tool", () => {
    const violations: PDSEViolation[] = [
      { type: "stub_detected", severity: "hard", file: "a.ts", message: "Found stub" },
    ];
    const result = buildTargetedFixPrompt("a.ts", violations, "code here");
    expect(result).toContain("Edit tool");
    expect(result).toContain("without changing unrelated code");
  });
});

// ----------------------------------------------------------------------------
// detectLanguageFromFiles
// ----------------------------------------------------------------------------

describe("detectLanguageFromFiles", () => {
  it("detects TypeScript from .ts files", () => {
    expect(detectLanguageFromFiles(["a.ts", "b.ts", "c.tsx"])).toBe("typescript");
  });

  it("detects Python from .py files", () => {
    expect(detectLanguageFromFiles(["main.py", "utils.py"])).toBe("python");
  });

  it("detects Go from .go files", () => {
    expect(detectLanguageFromFiles(["main.go"])).toBe("go");
  });

  it("returns empty string for no recognizable files", () => {
    expect(detectLanguageFromFiles(["readme.md", "data.json"])).toBe("");
  });

  it("returns empty string for empty array", () => {
    expect(detectLanguageFromFiles([])).toBe("");
  });

  it("picks the majority language", () => {
    const files = ["a.py", "b.ts", "c.ts", "d.ts"];
    expect(detectLanguageFromFiles(files)).toBe("typescript");
  });
});

// ----------------------------------------------------------------------------
// getLanguageBestPractices
// ----------------------------------------------------------------------------

describe("getLanguageBestPractices", () => {
  it("returns TypeScript best practices", () => {
    const result = getLanguageBestPractices("typescript");
    expect(result).toContain("strict types");
    expect(result).toContain("any");
  });

  it("returns Python best practices", () => {
    const result = getLanguageBestPractices("python");
    expect(result).toContain("type hints");
    expect(result).toContain("PEP 8");
  });

  it("returns Go best practices", () => {
    const result = getLanguageBestPractices("go");
    expect(result).toContain("errors explicitly");
  });

  it("is case insensitive", () => {
    expect(getLanguageBestPractices("TypeScript")).toContain("strict types");
    expect(getLanguageBestPractices("PYTHON")).toContain("type hints");
  });

  it("returns empty string for unknown languages", () => {
    expect(getLanguageBestPractices("cobol")).toBe("");
    expect(getLanguageBestPractices("")).toBe("");
  });

  it("returns Rust best practices", () => {
    const result = getLanguageBestPractices("rust");
    expect(result).toContain("Result<T, E>");
  });

  it("returns Java best practices", () => {
    const result = getLanguageBestPractices("java");
    expect(result).toContain("Optional<T>");
  });
});
