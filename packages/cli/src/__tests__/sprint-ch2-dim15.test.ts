// ============================================================================
// Sprint CH2 — Dim 15: Task triage + completion verdict tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyTask,
  computeTaskCompletionVerdict,
  recordTaskCompletion,
  loadTaskCompletionLog,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim15-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("classifyTask", () => {
  it("returns hard for vague 8-word prompt with no file path", () => {
    const result = classifyTask("improve the authentication system for better performance");
    expect(result.difficulty).toBe("hard");
    expect(result.reason).toBeTruthy();
  });

  it("returns easy for prompt with file path and clear verb", () => {
    const result = classifyTask("add type annotation to src/foo.ts line 42");
    expect(result.difficulty).toBe("easy");
  });

  it("returns easy for a very short prompt", () => {
    const result = classifyTask("fix typo in README");
    expect(result.difficulty).toBe("easy");
  });

  it("returns non-empty assumptionText for hard prompts", () => {
    const result = classifyTask("refactor all components across multiple packages to improve consistency and ensure better performance everywhere");
    expect(result.difficulty).toBe("hard");
    expect(result.assumptionText.length).toBeGreaterThan(0);
  });

  it("returns hard for multi-file scope prompt", () => {
    const result = classifyTask("update all files across every package to use the new logger pattern and ensure everything is consistent throughout the whole codebase");
    expect(result.difficulty).toBe("hard");
    expect(result.reason).toContain("multi-file-scope");
  });

  it("returns easy when specific identifier is mentioned", () => {
    const result = classifyTask("add a `getUser` method to UserService");
    expect(result.difficulty).toBe("easy");
  });
});

describe("computeTaskCompletionVerdict", () => {
  it("returns FAILED when no tool calls made", () => {
    const { verdict, reason } = computeTaskCompletionVerdict([], 0, 0);
    expect(verdict).toBe("FAILED");
    expect(reason).toContain("no tool calls");
  });

  it("returns FAILED when consecutive failures >= 3", () => {
    const { verdict } = computeTaskCompletionVerdict(["err", "err", "err"], 3, 3);
    expect(verdict).toBe("FAILED");
  });

  it("returns ATTEMPTED when last tool result contains errors", () => {
    const { verdict } = computeTaskCompletionVerdict(
      ["ok", "error TS2345: Type mismatch"],
      2,
      1,
    );
    expect(verdict).toBe("ATTEMPTED");
  });

  it("returns ATTEMPTED when last tool result contains FAILED", () => {
    const { verdict } = computeTaskCompletionVerdict(["ok", "FAILED 3 tests"], 2, 1);
    expect(verdict).toBe("ATTEMPTED");
  });

  it("returns COMPLETED when last tool result is clean", () => {
    const { verdict, reason } = computeTaskCompletionVerdict(
      ["ok", "All tests passed"],
      5,
      0,
    );
    expect(verdict).toBe("COMPLETED");
    expect(reason).toContain("clean");
  });
});

describe("recordTaskCompletion + loadTaskCompletionLog", () => {
  it("creates task-completion-log.jsonl on write", () => {
    recordTaskCompletion({
      sessionId: "test-session-1",
      prompt: "add type annotation to src/foo.ts",
      verdict: "COMPLETED",
      reason: "last tool result clean",
      toolCallCount: 3,
    }, tmpDir);

    const logPath = join(tmpDir, ".danteforge", "task-completion-log.jsonl");
    expect(existsSync(logPath)).toBe(true);
  });

  it("loadTaskCompletionLog reads and parses entries", () => {
    recordTaskCompletion({
      sessionId: "s1",
      prompt: "fix bug in parser",
      verdict: "ATTEMPTED",
      reason: "last tool had error",
      toolCallCount: 2,
    }, tmpDir);

    recordTaskCompletion({
      sessionId: "s2",
      prompt: "update README",
      verdict: "COMPLETED",
      reason: "last tool result clean",
      toolCallCount: 1,
    }, tmpDir);

    const entries = loadTaskCompletionLog(tmpDir);
    expect(entries.length).toBe(2);
    expect(entries[0]!.verdict).toBe("ATTEMPTED");
    expect(entries[1]!.verdict).toBe("COMPLETED");
  });

  it("entries include timestamp field", () => {
    recordTaskCompletion({
      sessionId: "s3",
      prompt: "deploy feature",
      verdict: "FAILED",
      reason: "no tool calls made",
      toolCallCount: 0,
    }, tmpDir);

    const entries = loadTaskCompletionLog(tmpDir);
    expect(entries[0]!.timestamp).toBeTruthy();
    expect(new Date(entries[0]!.timestamp).getTime()).toBeGreaterThan(0);
  });
});
