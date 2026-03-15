import { describe, it, expect } from "vitest";
import {
  runAntiStubScanner,
  HARD_VIOLATION_PATTERNS,
  SOFT_VIOLATION_PATTERNS,
} from "./anti-stub-scanner.js";

// Use a non-existent project root so custom patterns don't load
const PROJECT_ROOT = "/tmp/dantecode-test-nonexistent";

describe("anti-stub-scanner", () => {
  describe("hard violations", () => {
    it("detects TODO markers", () => {
      const result = runAntiStubScanner("// TODO: implement this", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.length).toBeGreaterThanOrEqual(1);
      expect(result.hardViolations.some((v) => v.message.includes("TODO"))).toBe(true);
    });

    it("detects FIXME markers", () => {
      const result = runAntiStubScanner("// FIXME: broken logic", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.message.includes("FIXME"))).toBe(true);
    });

    it("detects HACK markers", () => {
      const result = runAntiStubScanner("// HACK: workaround for bug", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.message.includes("HACK"))).toBe(true);
    });

    it("detects 'as any' type assertion", () => {
      const result = runAntiStubScanner("const x = value as any;", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.type === "type_any")).toBe(true);
    });

    it("detects explicit any type annotation", () => {
      const result = runAntiStubScanner("function foo(x: any) {}", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.type === "type_any")).toBe(true);
    });

    it("detects @ts-ignore directive", () => {
      const result = runAntiStubScanner("// @ts-ignore\nconst x = bad;", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.type === "type_any")).toBe(true);
    });

    it("detects @ts-nocheck directive", () => {
      const result = runAntiStubScanner("// @ts-nocheck", PROJECT_ROOT);
      expect(result.passed).toBe(false);
    });

    it("detects raise NotImplementedError (Python)", () => {
      const result = runAntiStubScanner("raise NotImplementedError", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.message.includes("NotImplementedError"))).toBe(true);
    });

    it("detects throw new Error('not implemented')", () => {
      const result = runAntiStubScanner(
        'throw new Error("not implemented")',
        PROJECT_ROOT,
      );
      expect(result.passed).toBe(false);
    });

    it("detects ellipsis stub body", () => {
      const result = runAntiStubScanner("function foo() {\n  ...\n}", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.message.includes("Ellipsis"))).toBe(true);
    });

    it("detects Python pass stub", () => {
      const result = runAntiStubScanner("def foo():\n  pass", PROJECT_ROOT);
      expect(result.passed).toBe(false);
    });

    it("detects placeholder text", () => {
      const result = runAntiStubScanner("const msg = 'placeholder text';", PROJECT_ROOT);
      expect(result.passed).toBe(false);
    });

    it("detects empty arrow function body", () => {
      const result = runAntiStubScanner("const handler = () => {}", PROJECT_ROOT);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.type === "incomplete_function")).toBe(true);
    });
  });

  describe("soft violations", () => {
    it("detects XXX markers", () => {
      const result = runAntiStubScanner("// XXX: needs review", PROJECT_ROOT);
      expect(result.passed).toBe(true); // soft violations don't fail
      expect(result.softViolations.some((v) => v.message.includes("XXX"))).toBe(true);
    });

    it("detects console.log", () => {
      const result = runAntiStubScanner("console.log('debug');", PROJECT_ROOT);
      expect(result.passed).toBe(true);
      expect(result.softViolations.some((v) => v.type === "console_log_leftover")).toBe(true);
    });

    it("detects test.skip", () => {
      const result = runAntiStubScanner("test.skip('disabled test', () => {});", PROJECT_ROOT);
      expect(result.passed).toBe(true);
      expect(result.softViolations.some((v) => v.type === "test_skip")).toBe(true);
    });

    it("detects it.todo (also triggers hard TODO pattern)", () => {
      const result = runAntiStubScanner("it.todo('should work');", PROJECT_ROOT);
      // "it.todo" contains "todo" which matches the hard TODO pattern (case-insensitive)
      // so passed=false because the hard violation fires first
      expect(result.passed).toBe(false);
      expect(result.softViolations.some((v) => v.type === "test_skip")).toBe(true);
    });
  });

  describe("clean code", () => {
    it("passes complete, clean code", () => {
      const cleanCode = `
import { readFile } from "node:fs/promises";

export interface Config {
  name: string;
  version: string;
}

export function parseConfig(raw: string): Config {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Invalid config: expected an object");
  }
  const obj = parsed as Record<string, unknown>;
  const name = typeof obj["name"] === "string" ? obj["name"] : "";
  const version = typeof obj["version"] === "string" ? obj["version"] : "0.0.0";
  return { name, version };
}

export async function loadConfig(path: string): Promise<Config> {
  const content = await readFile(path, "utf-8");
  return parseConfig(content);
}
`;
      const result = runAntiStubScanner(cleanCode, PROJECT_ROOT);
      expect(result.passed).toBe(true);
      expect(result.hardViolations).toHaveLength(0);
    });

    it("does not flag 'as any' inside string literals", () => {
      const code = `const msg = "cast as any is bad";`;
      const result = runAntiStubScanner(code, PROJECT_ROOT);
      // The scanner strips strings before checking 'as any'
      expect(result.hardViolations.filter((v) => v.type === "type_any")).toHaveLength(0);
    });

    it("does not flag empty braces in interfaces", () => {
      const code = `export interface EmptyMarker {}`;
      const result = runAntiStubScanner(code, PROJECT_ROOT);
      expect(result.hardViolations.filter((v) => v.type === "incomplete_function")).toHaveLength(0);
    });

    it("does not flag empty object defaults", () => {
      const code = `const opts = {};`;
      const result = runAntiStubScanner(code, PROJECT_ROOT);
      expect(result.hardViolations.filter((v) => v.type === "incomplete_function")).toHaveLength(0);
    });
  });

  describe("scan result properties", () => {
    it("reports correct line numbers", () => {
      const code = "line one\nline two\n// TODO: fix\nline four";
      const result = runAntiStubScanner(code, PROJECT_ROOT);
      const violation = result.hardViolations.find((v) => v.message.includes("TODO"));
      expect(violation?.line).toBe(3);
    });

    it("reports scanned line count", () => {
      const code = "a\nb\nc\nd\ne";
      const result = runAntiStubScanner(code, PROJECT_ROOT);
      expect(result.scannedLines).toBe(5);
    });

    it("reports file path when provided", () => {
      const result = runAntiStubScanner("clean code", PROJECT_ROOT, "/src/file.ts");
      expect(result.filePath).toBe("/src/file.ts");
    });
  });

  describe("pattern coverage", () => {
    it("has at least 15 hard violation patterns", () => {
      expect(HARD_VIOLATION_PATTERNS.length).toBeGreaterThanOrEqual(15);
    });

    it("has at least 5 soft violation patterns", () => {
      expect(SOFT_VIOLATION_PATTERNS.length).toBeGreaterThanOrEqual(5);
    });
  });
});
