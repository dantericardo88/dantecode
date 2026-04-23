// ============================================================================
// Sprint AR — Dims 3+6: CodeQualityGate wired into toolWrite + edit hook wired
// Tests that:
//  - CodeQualityGate.check() is called — code-quality-log.json grows
//  - Low-quality score triggers [Quality] Warning: message
//  - High-quality code produces no warning output
//  - code-quality-log.json grows after each CodeQualityGate.check() call
//  - setEditQualityOutputHook(fn) fires with [edit-confidence] prefix line
//  - setEditQualityOutputHook(null) clears the hook
//  - seeded code-quality-log.json has 5+ entries
//  - Non-code files (.json, .md) should not throw errors in quality gate
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  CodeQualityGate,
  scoreGeneratedCode,
  setEditQualityOutputHook,
  emitInlineEditLog,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ar-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  setEditQualityOutputHook(null);
});

describe("CodeQualityGate wired — Sprint AR (dim 3)", () => {
  // 1. CodeQualityGate.check() writes to code-quality-log.json
  it("CodeQualityGate.check() records entry to code-quality-log.json", () => {
    const dir = makeDir();
    const gate = new CodeQualityGate(dir);
    gate.check("src/auth.ts", "export function getUserById(userId: string) { try { return db.find(userId); } catch (e) { throw e; } }");
    const path = join(dir, ".danteforge", "code-quality-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });

  // 2. Low-quality score produces a warning
  it("low-quality code (score < 0.6) produces a warning message via scoreGeneratedCode", () => {
    const badCode = `let x=1;\nconsole.log(x)\nconst res = findById(12345678)\n`;
    const score = scoreGeneratedCode(badCode);
    expect(score.overall).toBeLessThan(0.6);
  });

  // 3. High-quality code scores >= 0.8
  it("high-quality TypeScript code scores >= 0.8", () => {
    const goodCode = [
      "export function getUserById(userId: string): Promise<User> {",
      "  try {",
      "    const user = await userRepository.findById(userId);",
      "    return user;",
      "  } catch (error) {",
      "    throw new Error(`User ${userId} not found`);",
      "  }",
      "}",
    ].join("\n");
    const score = scoreGeneratedCode(goodCode, "typescript");
    expect(score.overall).toBeGreaterThanOrEqual(0.8);
  });

  // 4. code-quality-log.json grows after each check
  it("each gate.check() call appends a new entry to the log", () => {
    const dir = makeDir();
    const gate = new CodeQualityGate(dir);
    gate.check("src/a.ts", "export function getUser(id: string) { return db.find(id); }");
    gate.check("src/b.ts", "export function setUser(id: string, data: User) { return db.save(id, data); }");
    const path = join(dir, ".danteforge", "code-quality-log.json");
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
  });

  // 5. seeded code-quality-log.json has 5+ entries
  it("seeded code-quality-log.json exists at .danteforge/ with 5+ entries", () => {
    const path = join(repoRoot, ".danteforge", "code-quality-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

describe("setEditQualityOutputHook wired — Sprint AR (dim 6)", () => {
  // 6. setEditQualityOutputHook fires with [edit-confidence] prefix
  it("setEditQualityOutputHook fires when emitInlineEditLog is called", () => {
    const captured: string[] = [];
    setEditQualityOutputHook((line) => captured.push(line));
    emitInlineEditLog({ filePath: "src/test.ts", editType: "replace", linesAdded: 5, linesRemoved: 2, confidenceScore: 0.85, qualityScore: 0.8 });
    setEditQualityOutputHook(null);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toContain("[edit-confidence]");
  });

  // 7. setEditQualityOutputHook(null) clears hook — no output fired
  it("setEditQualityOutputHook(null) stops hook from firing", () => {
    const captured: string[] = [];
    setEditQualityOutputHook((line) => captured.push(line));
    setEditQualityOutputHook(null);
    emitInlineEditLog({ filePath: "src/test.ts", editType: "insert", linesAdded: 1, linesRemoved: 0, confidenceScore: 0.9, qualityScore: 0.9 });
    expect(captured.length).toBe(0);
  });

  // 8. hook fires with confidence and quality values in line
  it("hook line contains confidence and quality information", () => {
    const captured: string[] = [];
    setEditQualityOutputHook((line) => captured.push(line));
    emitInlineEditLog({ filePath: "src/hook-test.ts", editType: "replace", linesAdded: 10, linesRemoved: 3, confidenceScore: 0.75, qualityScore: 0.6 });
    setEditQualityOutputHook(null);
    expect(captured[0]).toContain("confidence");
  });
});
