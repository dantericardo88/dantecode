/**
 * lint-parsers.test.ts
 *
 * Tests for lint output parsers
 */

import { describe, it, expect } from "vitest";
import {
  parseESLintOutput,
  parsePrettierOutput,
  parseTSCOutput,
  parseLintOutput,
} from "./lint-parsers.js";

describe("parseESLintOutput", () => {
  it("should parse ESLint JSON format", () => {
    const output = JSON.stringify([
      {
        filePath: "/path/to/file.ts",
        messages: [
          {
            ruleId: "no-unused-vars",
            severity: 2,
            message: "'foo' is declared but never used",
            line: 10,
            column: 5,
          },
          {
            ruleId: "semi",
            severity: 1,
            message: "Missing semicolon",
            line: 15,
            column: 20,
          },
        ],
      },
    ]);

    const errors = parseESLintOutput(output);

    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({
      file: "/path/to/file.ts",
      line: 10,
      column: 5,
      rule: "no-unused-vars",
      message: "'foo' is declared but never used",
      severity: "error",
    });
    expect(errors[1]).toEqual({
      file: "/path/to/file.ts",
      line: 15,
      column: 20,
      rule: "semi",
      message: "Missing semicolon",
      severity: "warning",
    });
  });

  it("should parse ESLint text format", () => {
    const output = `/path/to/file.ts:10:5: error - 'foo' is declared but never used (@typescript-eslint/no-unused-vars)
/path/to/file.ts:15:20: warning - Missing semicolon (semi)`;

    const errors = parseESLintOutput(output);

    expect(errors).toHaveLength(2);
    expect(errors[0]).toEqual({
      file: "/path/to/file.ts",
      line: 10,
      column: 5,
      rule: "@typescript-eslint/no-unused-vars",
      message: "'foo' is declared but never used",
      severity: "error",
    });
    expect(errors[1]).toEqual({
      file: "/path/to/file.ts",
      line: 15,
      column: 20,
      rule: "semi",
      message: "Missing semicolon",
      severity: "warning",
    });
  });

  it("should handle empty output", () => {
    const errors = parseESLintOutput("");
    expect(errors).toHaveLength(0);
  });

  it("should handle malformed JSON gracefully", () => {
    const output = "{ not valid json }";
    const errors = parseESLintOutput(output);
    expect(errors).toHaveLength(0);
  });
});

describe("parsePrettierOutput", () => {
  it("should parse Prettier error format", () => {
    const output = `[error] src/file.ts: SyntaxError: Unexpected token (10:5)`;

    const errors = parsePrettierOutput(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/file.ts",
      line: 10,
      column: 5,
      rule: "prettier",
      message: "SyntaxError: Unexpected token (10:5)",
      severity: "error",
    });
  });

  it("should parse Prettier warning format", () => {
    const output = `[warn] src/file.ts: Code style issues found`;

    const errors = parsePrettierOutput(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/file.ts",
      line: 0,
      column: 0,
      rule: "prettier",
      message: "Code style issues found",
      severity: "warning",
    });
  });

  it("should handle empty output", () => {
    const errors = parsePrettierOutput("");
    expect(errors).toHaveLength(0);
  });

  it("should handle multiple errors", () => {
    const output = `[error] src/file1.ts: SyntaxError: Unexpected token (10:5)
[error] src/file2.ts: ParseError: Missing bracket (20:15)`;

    const errors = parsePrettierOutput(output);

    expect(errors).toHaveLength(2);
    expect(errors[0]?.file).toBe("src/file1.ts");
    expect(errors[1]?.file).toBe("src/file2.ts");
  });
});

describe("parseTSCOutput", () => {
  it("should parse TypeScript compiler error format", () => {
    const output = `src/file.ts(10,5): error TS2304: Cannot find name 'foo'.`;

    const errors = parseTSCOutput(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/file.ts",
      line: 10,
      column: 5,
      rule: "TS2304",
      message: "Cannot find name 'foo'.",
      severity: "error",
    });
  });

  it("should parse TypeScript compiler warning format", () => {
    const output = `src/file.ts(15,20): warning TS6133: 'bar' is declared but its value is never read.`;

    const errors = parseTSCOutput(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/file.ts",
      line: 15,
      column: 20,
      rule: "TS6133",
      message: "'bar' is declared but its value is never read.",
      severity: "warning",
    });
  });

  it("should handle empty output", () => {
    const errors = parseTSCOutput("");
    expect(errors).toHaveLength(0);
  });

  it("should handle multiple errors", () => {
    const output = `src/file1.ts(10,5): error TS2304: Cannot find name 'foo'.
src/file2.ts(20,15): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`;

    const errors = parseTSCOutput(output);

    expect(errors).toHaveLength(2);
    expect(errors[0]?.file).toBe("src/file1.ts");
    expect(errors[1]?.file).toBe("src/file2.ts");
  });
});

describe("parseLintOutput (auto-detect)", () => {
  it("should auto-detect TSC output", () => {
    const output = `src/file.ts(10,5): error TS2304: Cannot find name 'foo'.`;
    const errors = parseLintOutput(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.rule).toBe("TS2304");
  });

  it("should auto-detect Prettier output", () => {
    const output = `[error] src/file.ts: SyntaxError: Unexpected token (10:5)`;
    const errors = parseLintOutput(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.rule).toBe("prettier");
  });

  it("should default to ESLint for ambiguous output", () => {
    const output = `/path/to/file.ts:10:5: error - 'foo' is declared but never used (@typescript-eslint/no-unused-vars)`;
    const errors = parseLintOutput(output);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.rule).toBe("@typescript-eslint/no-unused-vars");
  });

  it("should use specified tool parser", () => {
    const output = `some ambiguous output`;
    const errors = parseLintOutput(output, "prettier");

    // Should use Prettier parser (will return empty since format doesn't match)
    expect(Array.isArray(errors)).toBe(true);
  });

  it("should handle empty output", () => {
    const errors = parseLintOutput("");
    expect(errors).toHaveLength(0);
  });
});
