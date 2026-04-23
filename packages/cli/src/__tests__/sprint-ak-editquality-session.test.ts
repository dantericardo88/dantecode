// ============================================================================
// Sprint AK — Dims 6+11: Edit Quality Output Hook + Session Proof Formatter
// Tests that:
//  - setEditQualityOutputHook registers a callback
//  - emitInlineEditLog fires the hook with formatted confidence line
//  - hook line contains [edit-confidence] prefix with file path
//  - hook line contains confidence and quality percentages
//  - setEditQualityOutputHook(null) clears the hook
//  - formatSessionProof returns markdown with ## Session Proof header
//  - formatSessionProof shows file count and status
//  - formatSessionProof includes validation pass rate when provided
//  - formatSessionProof handles empty messages and files gracefully
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  setEditQualityOutputHook,
  emitInlineEditLog,
} from "@dantecode/core";
import { formatSessionProof } from "../agent-loop.js";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ak-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Edit Quality Output Hook ────────────────────────────────────────

describe("Edit Quality Output Hook — Sprint AK (dim 6)", () => {
  afterEach(() => {
    setEditQualityOutputHook(null); // cleanup after each test
  });

  // 1. hook fires when emitInlineEditLog is called
  it("setEditQualityOutputHook registers a callback that fires on emit", () => {
    const lines: string[] = [];
    setEditQualityOutputHook((line) => lines.push(line));
    const dir = makeDir();
    emitInlineEditLog({ filePath: "src/test.ts", editType: "insert", linesAdded: 5, linesRemoved: 0, confidenceScore: 0.9, qualityScore: 0.85 }, dir);
    expect(lines.length).toBe(1);
  });

  // 2. hook line has [edit-confidence] prefix
  it("hook line starts with [edit-confidence]", () => {
    const lines: string[] = [];
    setEditQualityOutputHook((line) => lines.push(line));
    const dir = makeDir();
    emitInlineEditLog({ filePath: "src/hook-test.ts", editType: "modify", linesAdded: 2, linesRemoved: 1, confidenceScore: 0.8, qualityScore: 0.75 }, dir);
    expect(lines[0]).toContain("[edit-confidence]");
  });

  // 3. hook line contains file path
  it("hook line contains the emitted file path", () => {
    const lines: string[] = [];
    setEditQualityOutputHook((line) => lines.push(line));
    const dir = makeDir();
    emitInlineEditLog({ filePath: "src/my-special-file.ts", editType: "replace", linesAdded: 3, linesRemoved: 3, confidenceScore: 0.7, qualityScore: 0.65 }, dir);
    expect(lines[0]).toContain("src/my-special-file.ts");
  });

  // 4. hook line contains confidence percentage
  it("hook line contains confidence and quality percentages", () => {
    const lines: string[] = [];
    setEditQualityOutputHook((line) => lines.push(line));
    const dir = makeDir();
    emitInlineEditLog({ filePath: "src/conf.ts", editType: "insert", linesAdded: 1, linesRemoved: 0, confidenceScore: 0.9, qualityScore: 0.8 }, dir);
    expect(lines[0]).toContain("confidence=90%");
    expect(lines[0]).toContain("quality=80%");
  });

  // 5. setEditQualityOutputHook(null) clears hook
  it("setEditQualityOutputHook(null) clears the hook so it no longer fires", () => {
    const lines: string[] = [];
    setEditQualityOutputHook((line) => lines.push(line));
    setEditQualityOutputHook(null);
    const dir = makeDir();
    emitInlineEditLog({ filePath: "src/cleared.ts", editType: "insert", linesAdded: 1, linesRemoved: 0, confidenceScore: 0.9, qualityScore: 0.8 }, dir);
    expect(lines.length).toBe(0);
  });
});

// ─── Part 2: Session Proof Formatter ─────────────────────────────────────────

describe("formatSessionProof — Sprint AK (dim 11)", () => {
  // 6. formatSessionProof returns markdown with ## header
  it("formatSessionProof returns markdown with ## Session Proof header", () => {
    const proof = formatSessionProof([], [], "COMPLETE");
    expect(proof).toContain("## Session Proof");
  });

  // 7. formatSessionProof shows file count
  it("formatSessionProof includes file count in output", () => {
    const proof = formatSessionProof(
      [{ role: "assistant", content: "I modified the auth module." }],
      ["src/auth.ts", "src/user.ts"],
      "COMPLETE",
    );
    expect(proof).toContain("Files modified");
    expect(proof).toContain("2");
  });

  // 8. formatSessionProof shows status
  it("formatSessionProof shows the status field", () => {
    const proof = formatSessionProof([], [], "FAILED");
    expect(proof).toContain("FAILED");
  });

  // 9. formatSessionProof shows validation pass rate when provided
  it("formatSessionProof includes validation rate when records given", () => {
    const proof = formatSessionProof(
      [],
      ["src/x.ts"],
      "COMPLETE",
      [
        { id: "v1", passed: true, command: "tsc", output: "", timestamp: "2026-04-21T00:00:00.000Z", exitCode: 0, type: "typecheck" as const },
        { id: "v2", passed: false, command: "npm test", output: "", timestamp: "2026-04-21T00:01:00.000Z", exitCode: 1, type: "test" as const },
      ],
    );
    expect(proof).toContain("Validations");
    expect(proof).toContain("1/2");
  });
});
