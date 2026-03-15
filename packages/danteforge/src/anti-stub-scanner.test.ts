import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runAntiStubScanner,
  scanFile,
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
      expect(result.hardViolations.some((v) => v.message.includes("NotImplementedError"))).toBe(
        true,
      );
    });

    it("detects throw new Error('not implemented')", () => {
      const result = runAntiStubScanner('throw new Error("not implemented")', PROJECT_ROOT);
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

  // -------------------------------------------------------------------------
  // scanFile tests
  // -------------------------------------------------------------------------

  describe("scanFile", () => {
    let tmpDir: string;

    afterEach(() => {
      if (tmpDir && existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("returns hard violation for non-existent file", () => {
      const result = scanFile("no-such-file.ts", "/tmp/nonexistent-project");
      expect(result.passed).toBe(false);
      expect(result.scannedLines).toBe(0);
      expect(result.hardViolations.length).toBe(1);
      expect(result.hardViolations[0]!.message).toContain("File not found");
    });

    it("scans a real file with violations", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-scanfile-"));
      const filePath = join(tmpDir, "stub.ts");
      writeFileSync(filePath, "// FIXME: broken\nexport function x() {}\n");
      const result = scanFile("stub.ts", tmpDir);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.length).toBeGreaterThanOrEqual(1);
      expect(result.hardViolations[0]!.message).toContain("FIXME");
    });

    it("scans a real file with no violations", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-scanfile-"));
      const filePath = join(tmpDir, "clean.ts");
      writeFileSync(
        filePath,
        "export function greet(name: string): string {\n  return `Hello ${name}`;\n}\n",
      );
      const result = scanFile("clean.ts", tmpDir);
      expect(result.passed).toBe(true);
      expect(result.hardViolations.length).toBe(0);
    });

    it("reports absolute path in filePath field", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-scanfile-"));
      writeFileSync(join(tmpDir, "code.ts"), "const x = 1;\n");
      const result = scanFile("code.ts", tmpDir);
      expect(result.filePath).toContain(tmpDir);
    });
  });

  // -------------------------------------------------------------------------
  // loadCustomPatterns (tested via runAntiStubScanner with real STATE.yaml)
  // -------------------------------------------------------------------------

  describe("custom patterns from STATE.yaml", () => {
    let tmpDir: string;

    afterEach(() => {
      if (tmpDir && existsSync(tmpDir)) {
        rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("loads custom patterns from STATE.yaml stub_patterns section", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-custom-"));
      const dcDir = join(tmpDir, ".dantecode");
      mkdirSync(dcDir, { recursive: true });
      writeFileSync(
        join(dcDir, "STATE.yaml"),
        [
          "version: 1",
          "stub_patterns:",
          "  - pattern: 'CUSTOM_STUB_MARKER'",
          "    message: 'Custom stub marker found'",
          "",
        ].join("\n"),
      );

      const result = runAntiStubScanner("// CUSTOM_STUB_MARKER here", tmpDir);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.message.includes("Custom stub marker"))).toBe(
        true,
      );
    });

    it("flushes final pattern when stub_patterns is last section", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-custom-"));
      const dcDir = join(tmpDir, ".dantecode");
      mkdirSync(dcDir, { recursive: true });
      // No trailing top-level key after stub_patterns — tests the final flush
      writeFileSync(
        join(dcDir, "STATE.yaml"),
        [
          "stub_patterns:",
          "  - pattern: 'FINAL_FLUSH_TEST'",
          "    message: 'Final flush pattern detected'",
        ].join("\n"),
      );

      const result = runAntiStubScanner("FINAL_FLUSH_TEST in code", tmpDir);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.message.includes("Final flush pattern"))).toBe(
        true,
      );
    });

    it("does not load patterns when STATE.yaml is missing", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-custom-"));
      // No .dantecode/STATE.yaml created
      const result = runAntiStubScanner("CUSTOM_STUB_MARKER here", tmpDir);
      // Should pass because the custom pattern was never loaded
      expect(result.passed).toBe(true);
    });

    it("handles incomplete pattern entries (missing message)", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-custom-"));
      const dcDir = join(tmpDir, ".dantecode");
      mkdirSync(dcDir, { recursive: true });
      writeFileSync(
        join(dcDir, "STATE.yaml"),
        [
          "stub_patterns:",
          "  - pattern: 'PARTIAL_PATTERN'",
          // no message line — should not be added
          "",
        ].join("\n"),
      );

      const result = runAntiStubScanner("PARTIAL_PATTERN here", tmpDir);
      // Pattern without message should not be loaded, so code passes
      expect(result.passed).toBe(true);
    });

    it("flushes pattern when new top-level key ends the section", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-custom-"));
      const dcDir = join(tmpDir, ".dantecode");
      mkdirSync(dcDir, { recursive: true });
      writeFileSync(
        join(dcDir, "STATE.yaml"),
        [
          "stub_patterns:",
          "  - pattern: 'SECTION_END_TEST'",
          "    message: 'Section end test pattern'",
          "other_config:",
          "  key: value",
        ].join("\n"),
      );

      const result = runAntiStubScanner("SECTION_END_TEST in code", tmpDir);
      expect(result.passed).toBe(false);
      expect(result.hardViolations.some((v) => v.message.includes("Section end test"))).toBe(true);
    });

    it("loads multiple custom patterns", () => {
      tmpDir = mkdtempSync(join(tmpdir(), "anti-stub-custom-"));
      const dcDir = join(tmpDir, ".dantecode");
      mkdirSync(dcDir, { recursive: true });
      writeFileSync(
        join(dcDir, "STATE.yaml"),
        [
          "stub_patterns:",
          "  - pattern: 'FIRST_CUSTOM'",
          "    message: 'First custom pattern'",
          "  - pattern: 'SECOND_CUSTOM'",
          "    message: 'Second custom pattern'",
        ].join("\n"),
      );

      const result1 = runAntiStubScanner("FIRST_CUSTOM here", tmpDir);
      expect(result1.passed).toBe(false);

      const result2 = runAntiStubScanner("SECOND_CUSTOM here", tmpDir);
      expect(result2.passed).toBe(false);
    });
  });
});
