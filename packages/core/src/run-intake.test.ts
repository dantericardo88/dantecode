// ============================================================================
// @dantecode/core — RunIntake unit tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRunIntake,
  classifyTask,
  extractScopeFromPrompt,
  TaskClassSchema,
} from "./run-intake.js";
import type { TaskClass } from "./run-intake.js";

// ---------------------------------------------------------------------------
// classifyTask
// ---------------------------------------------------------------------------

describe("classifyTask", () => {
  it("classifies explain prompts", () => {
    expect(classifyTask("explain how the router works")).toBe("explain");
    expect(classifyTask("What is the purpose of this module?")).toBe("explain");
    expect(classifyTask("What are the dependencies?")).toBe("explain");
    expect(classifyTask("Why does the test fail?")).toBe("explain");
  });

  it("classifies analyze prompts", () => {
    expect(classifyTask("analyze the performance of this function")).toBe("analyze");
    expect(classifyTask("investigate the memory leak")).toBe("analyze");
    expect(classifyTask("diagnose the failing CI pipeline")).toBe("analyze");
    expect(classifyTask("debug the crash in production")).toBe("analyze");
    expect(classifyTask("profile the startup time")).toBe("analyze");
  });

  it("classifies review prompts", () => {
    expect(classifyTask("review this pull request")).toBe("review");
    expect(classifyTask("audit the security of auth.ts")).toBe("review");
    expect(classifyTask("check the code for bugs")).toBe("review");
    expect(classifyTask("inspect the configuration")).toBe("review");
    expect(classifyTask("validate the schema")).toBe("review");
  });

  it("classifies change prompts", () => {
    expect(classifyTask("build a new REST API endpoint")).toBe("change");
    expect(classifyTask("create a user model")).toBe("change");
    expect(classifyTask("implement the login flow")).toBe("change");
    expect(classifyTask("add error handling to the parser")).toBe("change");
    expect(classifyTask("fix the broken import")).toBe("change");
    expect(classifyTask("update the README")).toBe("change");
    expect(classifyTask("modify the config schema")).toBe("change");
    expect(classifyTask("remove the deprecated function")).toBe("change");
    expect(classifyTask("delete unused imports")).toBe("change");
    expect(classifyTask("write a test for utils")).toBe("change");
  });

  it("classifies long-horizon prompts", () => {
    expect(classifyTask("refactor the entire authentication module")).toBe("long-horizon");
    expect(classifyTask("migrate from REST to GraphQL")).toBe("long-horizon");
    expect(classifyTask("rewrite the parser in Rust")).toBe("long-horizon");
    expect(classifyTask("redesign the database schema")).toBe("long-horizon");
    expect(classifyTask("overhaul the CI/CD pipeline")).toBe("long-horizon");
    expect(classifyTask("architect a microservices solution")).toBe("long-horizon");
  });

  it("classifies background prompts", () => {
    expect(classifyTask("run this in the background")).toBe("background");
    expect(classifyTask("schedule a daily report")).toBe("background");
    expect(classifyTask("set up a cron job for cleanup")).toBe("background");
  });

  it("defaults to change for unrecognized prompts", () => {
    expect(classifyTask("hello world")).toBe("change");
    expect(classifyTask("")).toBe("change");
    expect(classifyTask("do something interesting")).toBe("change");
  });

  it("is case-insensitive", () => {
    expect(classifyTask("EXPLAIN this code")).toBe("explain");
    expect(classifyTask("ANALYZE the logs")).toBe("analyze");
    expect(classifyTask("REVIEW my PR")).toBe("review");
    expect(classifyTask("REFACTOR everything")).toBe("long-horizon");
  });

  it("prioritizes background over other classes", () => {
    // "background" should win even when other keywords are present
    expect(classifyTask("run the build in the background")).toBe("background");
  });

  it("prioritizes long-horizon over explain/analyze/review/change", () => {
    expect(classifyTask("refactor and fix all the tests")).toBe("long-horizon");
    expect(classifyTask("migrate and review the codebase")).toBe("long-horizon");
  });
});

// ---------------------------------------------------------------------------
// extractScopeFromPrompt
// ---------------------------------------------------------------------------

describe("extractScopeFromPrompt", () => {
  it("extracts file paths from prompt", () => {
    const scope = extractScopeFromPrompt("fix the bug in src/agent-loop.ts");
    expect(scope).toContain("src/agent-loop.ts");
  });

  it("extracts multiple file paths", () => {
    const scope = extractScopeFromPrompt(
      "update packages/core/src/index.ts and packages/cli/src/tools.ts",
    );
    expect(scope).toContain("packages/core/src/index.ts");
    expect(scope).toContain("packages/cli/src/tools.ts");
  });

  it("returns at most 5 paths", () => {
    const prompt = [
      "a.ts",
      "b.ts",
      "c.ts",
      "d.ts",
      "e.ts",
      "f.ts",
      "g.ts",
    ].join(" ");
    const scope = extractScopeFromPrompt(prompt);
    expect(scope.length).toBeLessThanOrEqual(5);
  });

  it("deduplicates paths", () => {
    const scope = extractScopeFromPrompt("fix src/main.ts and also src/main.ts is broken");
    const mainCount = scope.filter((p) => p === "src/main.ts").length;
    expect(mainCount).toBe(1);
  });

  it("returns empty array when no paths found", () => {
    const scope = extractScopeFromPrompt("explain how things work");
    expect(scope).toEqual([]);
  });

  it("handles paths with hyphens and dots", () => {
    const scope = extractScopeFromPrompt("update my-component.test.tsx");
    expect(scope).toContain("my-component.test.tsx");
  });

  it("handles nested directory paths", () => {
    const scope = extractScopeFromPrompt("look at packages/core/src/run-intake.ts");
    expect(scope).toContain("packages/core/src/run-intake.ts");
  });
});

// ---------------------------------------------------------------------------
// TaskClassSchema
// ---------------------------------------------------------------------------

describe("TaskClassSchema", () => {
  it("validates all known task classes", () => {
    const classes: TaskClass[] = [
      "explain",
      "analyze",
      "review",
      "change",
      "long-horizon",
      "background",
    ];
    for (const cls of classes) {
      expect(TaskClassSchema.parse(cls)).toBe(cls);
    }
  });

  it("rejects unknown task classes", () => {
    expect(() => TaskClassSchema.parse("unknown")).toThrow();
    expect(() => TaskClassSchema.parse("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// createRunIntake
// ---------------------------------------------------------------------------

describe("createRunIntake", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T10:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a RunIntake with correct fields", () => {
    const intake = createRunIntake("build a REST API", "abc12345-6789-0abc-def0-123456789abc");

    expect(intake.userAsk).toBe("build a REST API");
    expect(intake.classification).toBe("change");
    expect(intake.timestamp).toBe("2026-03-28T10:00:00.000Z");
    expect(intake.parentRunId).toBeUndefined();
    expect(intake.runId).toMatch(/^run_\d+_/);
  });

  it("generates unique runIds across calls", () => {
    const a = createRunIntake("do something", "session-a");
    // Advance time by 1ms to guarantee different Date.now()
    vi.advanceTimersByTime(1);
    const b = createRunIntake("do something else", "session-b");
    expect(a.runId).not.toBe(b.runId);
  });

  it("incorporates sessionId into runId", () => {
    const intake = createRunIntake("test", "abcdef12-3456-7890-abcd-ef1234567890");
    // sessionId with dashes removed, first 9 chars: "abcdef123"
    expect(intake.runId).toContain("abcdef123");
  });

  it("sets parentRunId when provided", () => {
    const intake = createRunIntake("sub-task", "session-1", "run_parent_123");
    expect(intake.parentRunId).toBe("run_parent_123");
  });

  it("classifies the prompt correctly", () => {
    expect(createRunIntake("explain this code", "s1").classification).toBe("explain");
    expect(createRunIntake("review the PR", "s1").classification).toBe("review");
    expect(createRunIntake("refactor the module", "s1").classification).toBe("long-horizon");
  });

  it("extracts scope from prompt", () => {
    const intake = createRunIntake("fix the bug in src/main.ts", "s1");
    expect(intake.requestedScope).toContain("src/main.ts");
    expect(intake.allowedBoundary.paths).toContain("src/main.ts");
  });

  it("sets maxFiles=undefined for long-horizon tasks", () => {
    const intake = createRunIntake("refactor the entire codebase", "s1");
    expect(intake.classification).toBe("long-horizon");
    expect(intake.allowedBoundary.maxFiles).toBeUndefined();
  });

  it("sets maxFiles=10 for non-long-horizon tasks", () => {
    const intake = createRunIntake("fix a small bug", "s1");
    expect(intake.allowedBoundary.maxFiles).toBe(10);
  });

  it("returns valid ISO-8601 timestamp", () => {
    const intake = createRunIntake("test", "s1");
    expect(() => new Date(intake.timestamp)).not.toThrow();
    expect(new Date(intake.timestamp).toISOString()).toBe(intake.timestamp);
  });
});
