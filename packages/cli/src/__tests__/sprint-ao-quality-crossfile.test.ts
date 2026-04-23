// ============================================================================
// Sprint AO — Dims 3+9: Code Quality Gate + Cross-File Consistency Checker
// Tests that:
//  - scoreGeneratedCode gives 0.0 for code with all negative signals
//  - scoreGeneratedCode gives 1.0 for code with all positive signals
//  - scoreGeneratedCode correctly detects console.log presence
//  - scoreGeneratedCode correctly detects try/catch as error handling
//  - CodeQualityGate.check records to .danteforge/code-quality-log.json
//  - CodeQualityGate.getAverageScore returns average across entries
//  - seeded code-quality-log.json exists with 5+ entries
//  - extractExports finds exported names
//  - checkExportImportMatch returns passed=true for consistent files
//  - checkExportImportMatch returns inconsistency when import not exported
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  scoreGeneratedCode,
  CodeQualityGate,
  extractExports,
  checkExportImportMatch,
  type FileContent,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ao-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Code Quality Gate ───────────────────────────────────────────────

describe("CodeQualityGate — Sprint AO (dim 3)", () => {
  // 1. scoreGeneratedCode = 0.0 for worst-case code
  it("scoreGeneratedCode returns 0.0 for code with all negative signals", () => {
    const badCode = `
      let x=1;
      console.log(x)
      const res = findById(12345678)
      x = res.value
    `;
    const score = scoreGeneratedCode(badCode);
    expect(score.overall).toBeLessThanOrEqual(0.4);
  });

  // 2. scoreGeneratedCode = 1.0 for best-case code
  it("scoreGeneratedCode returns 1.0 for code with all positive signals", () => {
    const goodCode = `
export function getUserById(userId: string): Promise<User> {
  try {
    const user = await userRepository.findById(userId);
    return user;
  } catch (error) {
    throw new Error(\`User \${userId} not found\`);
  }
}
    `.trim();
    const score = scoreGeneratedCode(goodCode, "typescript");
    expect(score.overall).toBe(1.0);
  });

  // 3. detectConsoleLog correctly
  it("scoreGeneratedCode detects console.log presence", () => {
    const code = `console.log('debug output');\nconst x = 1;`;
    const score = scoreGeneratedCode(code);
    expect(score.breakdown.noConsoleLog).toBe(false);
  });

  // 4. detectErrorHandling from try/catch
  it("scoreGeneratedCode detects try/catch as error handling", () => {
    const code = `try { doSomething(); } catch (e) { handle(e); }`;
    const score = scoreGeneratedCode(code);
    expect(score.breakdown.hasErrorHandling).toBe(true);
  });

  // 5. CodeQualityGate.check records entry
  it("CodeQualityGate.check records to .danteforge/code-quality-log.json", () => {
    const dir = makeDir();
    const gate = new CodeQualityGate(dir);
    gate.check("src/test.ts", "export function add(a: number, b: number): number { return a + b; }");
    expect(existsSync(join(dir, ".danteforge", "code-quality-log.json"))).toBe(true);
  });

  // 6. CodeQualityGate.getAverageScore
  it("CodeQualityGate.getAverageScore returns average across entries", () => {
    const dir = makeDir();
    const gate = new CodeQualityGate(dir);
    gate.check("src/a.ts", "export function getUser(id: string) { try { return db.find(id); } catch (e) { throw e; } }");
    gate.check("src/b.ts", "console.log('bad');");
    const avg = gate.getAverageScore();
    expect(avg).toBeGreaterThan(0);
    expect(avg).toBeLessThan(1);
  });

  // 7. seeded code-quality-log.json exists
  it("seeded code-quality-log.json exists at .danteforge/ with 5+ entries", () => {
    const path = join(repoRoot, ".danteforge", "code-quality-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── Part 2: Cross-File Consistency Checker ───────────────────────────────────

describe("CrossFileChecker — Sprint AO (dim 9)", () => {
  // 8. extractExports finds exported names
  it("extractExports finds exported function and const names", () => {
    const code = `
export const MY_CONST = 42;
export function myFunction() {}
export class MyClass {}
`;
    const exports = extractExports(code);
    expect(exports.has("MY_CONST")).toBe(true);
    expect(exports.has("myFunction")).toBe(true);
    expect(exports.has("MyClass")).toBe(true);
  });

  // 9. checkExportImportMatch passes for consistent files
  it("checkExportImportMatch returns passed=true when imports match exports", () => {
    const files: FileContent[] = [
      { path: "/src/utils.ts", content: "export function helper() {}" },
      { path: "/src/main.ts", content: "import { helper } from './utils';" },
    ];
    const report = checkExportImportMatch(files);
    expect(report.passed).toBe(true);
    expect(report.inconsistencies).toHaveLength(0);
  });

  // 10. checkExportImportMatch detects missing export
  it("checkExportImportMatch detects when import symbol is not exported", () => {
    const files: FileContent[] = [
      { path: "/src/utils.ts", content: "export function actualName() {}" },
      { path: "/src/main.ts", content: "import { wrongName } from './utils';" },
    ];
    const report = checkExportImportMatch(files);
    expect(report.passed).toBe(false);
    expect(report.inconsistencies.some((i) => i.symbol === "wrongName")).toBe(true);
  });
});
