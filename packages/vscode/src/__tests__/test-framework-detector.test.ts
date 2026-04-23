// ============================================================================
// packages/vscode/src/__tests__/test-framework-detector.test.ts
// 20 tests covering: framework detection, test file finder, path inference,
// test head reader, and function signature extraction.
// ============================================================================

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { TestFrameworkDetector } from "../test-framework-detector.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFs(files: Record<string, string>): (p: string) => Promise<string> {
  return async (p: string) => {
    const normalized = p.replace(/\\/g, "/");
    const entry = Object.entries(files).find(([k]) => normalized.endsWith(k.replace(/\\/g, "/")));
    if (entry) return entry[1];
    throw new Error(`ENOENT: ${p}`);
  };
}

function makeGlob(results: string[]): (pattern: string, cwd: string) => Promise<string[]> {
  return async () => results;
}

const emptyGlob = makeGlob([]);

// ── Framework detection ───────────────────────────────────────────────────────

describe("TestFrameworkDetector.detectFramework", () => {
  it("detects vitest from devDependencies", async () => {
    const pkgJson = JSON.stringify({ devDependencies: { vitest: "^2.1.0" } });
    const fs = makeFs({ "package.json": pkgJson });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.name).toBe("vitest");
    expect(result.runCommand).toBe("npx vitest run");
  });

  it("detects jest from devDependencies", async () => {
    const pkgJson = JSON.stringify({ devDependencies: { jest: "^29.0.0" } });
    const fs = makeFs({ "package.json": pkgJson });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.name).toBe("jest");
    expect(result.runCommand).toBe("npx jest");
  });

  it("detects mocha from devDependencies", async () => {
    const pkgJson = JSON.stringify({ devDependencies: { mocha: "^10.0.0" } });
    const fs = makeFs({ "package.json": pkgJson });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.name).toBe("mocha");
    expect(result.runCommand).toBe("npx mocha");
  });

  it("detects pytest from requirements.txt", async () => {
    const fs = makeFs({ "requirements.txt": "pytest==7.4.0\nrequests>=2.0\n" });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.name).toBe("pytest");
    expect(result.runCommand).toBe("pytest");
  });

  it("detects go-testing when go.mod exists", async () => {
    const fs = makeFs({ "go.mod": "module example.com/app\ngo 1.21\n" });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.name).toBe("go-testing");
    expect(result.runCommand).toBe("go test ./...");
  });

  it("falls back to unknown when no known framework found", async () => {
    const pkgJson = JSON.stringify({ devDependencies: { lodash: "^4.0.0" } });
    const fs = makeFs({ "package.json": pkgJson });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.name).toBe("unknown");
    expect(result.runCommand).toBe("npm test");
  });

  it("extracts version string from devDependencies", async () => {
    const pkgJson = JSON.stringify({ devDependencies: { vitest: "^3.2.4" } });
    const fs = makeFs({ "package.json": pkgJson });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.version).toBe("3.2.4");
  });

  it("uses npx vitest run as runCommand for vitest", async () => {
    const pkgJson = JSON.stringify({ devDependencies: { vitest: "^2.0.0" } });
    const fs = makeFs({ "package.json": pkgJson });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.runCommand).toBe("npx vitest run");
  });

  it("uses npx jest as runCommand for jest", async () => {
    const pkgJson = JSON.stringify({ devDependencies: { jest: "^29.0.0" } });
    const fs = makeFs({ "package.json": pkgJson });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.detectFramework("/workspace");
    expect(result.runCommand).toBe("npx jest");
  });
});

// ── Test file finder ──────────────────────────────────────────────────────────

describe("TestFrameworkDetector.findTestFile", () => {
  it("returns path when __tests__/{stem}.test.ts exists", async () => {
    const sourceFile = path.join("/workspace", "src", "utils.ts");
    const testFile = path.join("/workspace", "src", "__tests__", "utils.test.ts");
    const fs = makeFs({ "__tests__/utils.test.ts": "// test" });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.findTestFile(sourceFile, "/workspace");
    expect(result).toBe(testFile);
  });

  it("returns path when {stem}.test.ts sibling exists", async () => {
    const sourceFile = "/workspace/src/parser.ts";
    // Only sibling test file exists, not __tests__ dir
    const fs = async (p: string) => {
      if (p.includes("__tests__")) throw new Error("ENOENT");
      if (p.endsWith("parser.test.ts")) return "// test";
      throw new Error("ENOENT");
    };
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.findTestFile(sourceFile, "/workspace");
    expect(result).not.toBeNull();
    expect(result).toContain("parser.test.ts");
  });

  it("returns null when no test file found", async () => {
    const fs = async () => { throw new Error("ENOENT"); };
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.findTestFile("/workspace/src/utils.ts", "/workspace");
    expect(result).toBeNull();
  });

  it("checks .spec.ts variant as fallback", async () => {
    const sourceFile = "/workspace/src/helpers.ts";
    const fs = async (p: string) => {
      if (p.endsWith("helpers.spec.ts")) return "// spec";
      throw new Error("ENOENT");
    };
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.findTestFile(sourceFile, "/workspace");
    expect(result).not.toBeNull();
    expect(result).toContain("helpers.spec.ts");
  });
});

// ── Test file path inference ──────────────────────────────────────────────────

describe("TestFrameworkDetector.inferTestFilePath", () => {
  it("returns __tests__/{stem}.test.ts for TypeScript files", () => {
    const detector = new TestFrameworkDetector();
    const result = detector.inferTestFilePath("/workspace/src/utils.ts");
    expect(result).toBe(path.join("/workspace/src", "__tests__", "utils.test.ts"));
  });

  it("returns test_{stem}.py for Python .py files", () => {
    const detector = new TestFrameworkDetector();
    const result = detector.inferTestFilePath("/workspace/src/parser.py");
    expect(result).toBe(path.join("/workspace/src", "test_parser.py"));
  });

  it("returns {stem}_test.go for Go .go files", () => {
    const detector = new TestFrameworkDetector();
    const result = detector.inferTestFilePath("/workspace/pkg/server.go");
    expect(result).toBe(path.join("/workspace/pkg", "server_test.go"));
  });
});

// ── Test head reader ──────────────────────────────────────────────────────────

describe("TestFrameworkDetector.readTestFileHead", () => {
  it("returns first 60 lines of file by default", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n");
    const fs = makeFs({ "utils.test.ts": content });
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.readTestFileHead("/workspace/utils.test.ts");
    const resultLines = result.split("\n");
    expect(resultLines).toHaveLength(60);
    expect(resultLines[0]).toBe("line 1");
    expect(resultLines[59]).toBe("line 60");
  });

  it("returns empty string on file read error", async () => {
    const fs = async () => { throw new Error("ENOENT"); };
    const detector = new TestFrameworkDetector(fs, emptyGlob);
    const result = await detector.readTestFileHead("/workspace/missing.test.ts");
    expect(result).toBe("");
  });
});

// ── Function signature extractor ──────────────────────────────────────────────

describe("TestFrameworkDetector.extractFunctionSignatures", () => {
  it("returns exported function names from TypeScript code", () => {
    const code = `
export function parseConfig(input: string): Config { return {}; }
export async function fetchData(url: string): Promise<Data> { return {}; }
export const transform = (data: Data) => data;
function internalHelper(): void {}
`;
    const detector = new TestFrameworkDetector();
    const result = detector.extractFunctionSignatures(code, "typescript");
    expect(result).toContain("parseConfig");
    expect(result).toContain("fetchData");
    expect(result).toContain("transform");
    // internal non-exported functions may or may not be included — just check exported ones present
  });

  it("returns def function names from Python code", () => {
    const code = `
def parse_input(text):
    return text.strip()

def validate_schema(data, schema):
    return True

class MyClass:
    def method(self):
        pass
`;
    const detector = new TestFrameworkDetector();
    const result = detector.extractFunctionSignatures(code, "python");
    expect(result).toContain("parse_input");
    expect(result).toContain("validate_schema");
    expect(result).toContain("method");
  });
});
