import { describe, expect, it } from "vitest";
import {
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
} from "./error-parser.js";

describe("parseVerificationErrors", () => {
  it("parses TypeScript errors in parenthesized format", () => {
    const output = `src/foo.ts(12,5): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`;
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/foo.ts",
      line: 12,
      column: 5,
      message: "Argument of type 'string' is not assignable to parameter of type 'number'.",
      errorType: "typescript",
      code: "TS2345",
    });
  });

  it("parses TypeScript errors in colon format (tsc --pretty false)", () => {
    const output = `src/bar.tsx:42:10 - error TS7006: Parameter 'x' implicitly has an 'any' type.`;
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/bar.tsx",
      line: 42,
      column: 10,
      message: "Parameter 'x' implicitly has an 'any' type.",
      errorType: "typescript",
      code: "TS7006",
    });
  });

  it("parses multiple TypeScript errors", () => {
    const output = [
      `src/a.ts(1,1): error TS2304: Cannot find name 'foo'.`,
      `src/b.ts(5,10): error TS2551: Property 'bar' does not exist on type 'Baz'.`,
    ].join("\n");
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0]!.file).toBe("src/a.ts");
    expect(errors[1]!.file).toBe("src/b.ts");
  });

  it("parses ESLint error lines", () => {
    const output = `src/foo.ts:12:5  error  Unexpected console statement  no-console`;
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/foo.ts",
      line: 12,
      column: 5,
      message: "Unexpected console statement",
      errorType: "eslint",
      code: "no-console",
    });
  });

  it("parses ESLint warning lines", () => {
    const output = `src/utils.ts:3:1  warning  Missing return type on function  @typescript-eslint/explicit-function-return-type`;
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.errorType).toBe("eslint");
    expect(errors[0]!.code).toBe("@typescript-eslint/explicit-function-return-type");
  });

  it("parses Vitest FAIL lines", () => {
    const output = ` FAIL  src/utils.test.ts\n  some test description`;
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      file: "src/utils.test.ts",
      line: null,
      column: null,
      message: "Test suite failed: src/utils.test.ts",
      errorType: "vitest",
      code: null,
    });
  });

  it("parses Jest stack trace lines", () => {
    const output = `    at Object.<anonymous> (src/math.test.ts:42:10)`;
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.errorType).toBe("jest");
    expect(errors[0]!.file).toBe("src/math.test.ts");
    expect(errors[0]!.line).toBe(42);
    expect(errors[0]!.column).toBe(10);
  });

  it("deduplicates errors with the same file, line, and message", () => {
    const output = [
      `src/foo.ts(12,5): error TS2345: Argument of type 'string'.`,
      `src/foo.ts(12,5): error TS2345: Argument of type 'string'.`,
      `src/foo.ts(12,5): error TS2345: Argument of type 'string'.`,
    ].join("\n");
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(1);
  });

  it("keeps errors with different lines even if same file", () => {
    const output = [
      `src/foo.ts(10,1): error TS2304: Cannot find name 'a'.`,
      `src/foo.ts(20,1): error TS2304: Cannot find name 'b'.`,
    ].join("\n");
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(2);
  });

  it("returns empty array for non-error output", () => {
    const output = "Build succeeded.\nAll checks passed.";
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(0);
  });

  it("handles mixed error types in a single output", () => {
    const output = [
      `src/a.ts(1,1): error TS2304: Cannot find name 'x'.`,
      `src/b.ts:5:3  error  Unexpected var  no-var`,
      ` FAIL  src/c.test.ts`,
    ].join("\n");
    const errors = parseVerificationErrors(output);
    expect(errors).toHaveLength(3);
    expect(errors[0]!.errorType).toBe("typescript");
    expect(errors[1]!.errorType).toBe("eslint");
    expect(errors[2]!.errorType).toBe("vitest");
  });
});

describe("formatErrorsForFixPrompt", () => {
  it("returns empty string for no errors", () => {
    expect(formatErrorsForFixPrompt([])).toBe("");
  });

  it("formats errors with file, line, code, and message", () => {
    const result = formatErrorsForFixPrompt([
      {
        file: "src/foo.ts",
        line: 12,
        column: 5,
        message: "Type mismatch",
        errorType: "typescript",
        code: "TS2345",
      },
    ]);
    expect(result).toContain("Fix these specific errors:");
    expect(result).toContain("src/foo.ts:12 [TS2345]");
    expect(result).toContain("Type mismatch");
    expect(result).toContain("Do NOT rewrite entire files");
  });

  it("formats errors without line numbers using file only", () => {
    const result = formatErrorsForFixPrompt([
      {
        file: "src/bar.test.ts",
        line: null,
        column: null,
        message: "Test suite failed: src/bar.test.ts",
        errorType: "vitest",
        code: null,
      },
    ]);
    expect(result).toContain("- src/bar.test.ts");
    expect(result).not.toContain("null");
  });

  it("formats multiple errors as a list", () => {
    const result = formatErrorsForFixPrompt([
      {
        file: "src/a.ts",
        line: 1,
        column: 1,
        message: "Error A",
        errorType: "typescript",
        code: "TS001",
      },
      {
        file: "src/b.ts",
        line: 5,
        column: 3,
        message: "Error B",
        errorType: "eslint",
        code: "no-var",
      },
    ]);
    expect(result).toContain("src/a.ts:1 [TS001]");
    expect(result).toContain("src/b.ts:5 [no-var]");
  });
});

describe("computeErrorSignature", () => {
  it("produces deterministic signature for a set of errors", () => {
    const errors = [
      {
        file: "src/a.ts",
        line: 10,
        column: 1,
        message: "Error A",
        errorType: "typescript",
        code: "TS001",
      },
      {
        file: "src/b.ts",
        line: 20,
        column: 5,
        message: "Error B",
        errorType: "eslint",
        code: "no-var",
      },
    ];
    const sig1 = computeErrorSignature(errors);
    const sig2 = computeErrorSignature(errors);
    expect(sig1).toBe(sig2);
  });

  it("produces the same signature regardless of error order", () => {
    const errorsA = [
      {
        file: "src/b.ts",
        line: 20,
        column: 5,
        message: "Error B",
        errorType: "eslint",
        code: "no-var",
      },
      {
        file: "src/a.ts",
        line: 10,
        column: 1,
        message: "Error A",
        errorType: "typescript",
        code: "TS001",
      },
    ];
    const errorsB = [
      {
        file: "src/a.ts",
        line: 10,
        column: 1,
        message: "Error A",
        errorType: "typescript",
        code: "TS001",
      },
      {
        file: "src/b.ts",
        line: 20,
        column: 5,
        message: "Error B",
        errorType: "eslint",
        code: "no-var",
      },
    ];
    expect(computeErrorSignature(errorsA)).toBe(computeErrorSignature(errorsB));
  });

  it("uses message slice when code is null", () => {
    const sig = computeErrorSignature([
      {
        file: "src/c.test.ts",
        line: null,
        column: null,
        message: "Test suite failed: src/c.test.ts",
        errorType: "vitest",
        code: null,
      },
    ]);
    expect(sig).toContain("src/c.test.ts:null:Test suite failed");
  });

  it("produces different signatures for different error sets", () => {
    const sigA = computeErrorSignature([
      {
        file: "src/a.ts",
        line: 10,
        column: 1,
        message: "Error A",
        errorType: "typescript",
        code: "TS001",
      },
    ]);
    const sigB = computeErrorSignature([
      {
        file: "src/b.ts",
        line: 20,
        column: 5,
        message: "Error B",
        errorType: "typescript",
        code: "TS002",
      },
    ]);
    expect(sigA).not.toBe(sigB);
  });

  it("returns empty string for no errors", () => {
    expect(computeErrorSignature([])).toBe("");
  });
});
