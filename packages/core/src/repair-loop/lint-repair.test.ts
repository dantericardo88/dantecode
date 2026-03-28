/**
 * lint-repair.test.ts
 *
 * Tests for lint repair loop
 */

import { describe, it, expect, vi } from "vitest";
import { runLintRepair, formatLintErrors } from "./lint-repair.js";
import type { LintError } from "./lint-parsers.js";
import type { EventEngine } from "../event-engine.js";

// Mock event engine
function createMockEventEngine(): EventEngine {
  const emitted: any[] = [];
  return {
    emit: vi.fn(async (event: any) => {
      emitted.push(event);
      return "event-id";
    }),
    on: vi.fn(),
    off: vi.fn(),
    _emitted: emitted, // For test inspection
  } as any;
}

describe("runLintRepair - Execution", () => {
  it("should return success when no lint errors", async () => {
    const execFn = vi.fn(() => Buffer.from("", "utf-8"));

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 3,
        autoCommitFixes: true,
      },
      projectRoot: "/project",
      execFn,
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.fixesApplied).toBe(false);
    expect(result.iteration).toBe(0);
  });

  it("should emit started and completed events", async () => {
    const execFn = vi.fn(() => Buffer.from("", "utf-8"));
    const eventEngine = createMockEventEngine();
    const testTaskId = "12345678-1234-1234-1234-123456789012"; // Valid UUID

    await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 3,
        autoCommitFixes: true,
      },
      projectRoot: "/project",
      eventEngine,
      taskId: testTaskId,
      execFn,
    });

    expect(eventEngine.emit).toHaveBeenCalledTimes(2);

    const emitted = (eventEngine as any)._emitted;
    expect(emitted[0].kind).toBe("run.repair.lint.started");
    expect(emitted[0].taskId).toBe(testTaskId);
    expect(emitted[1].kind).toBe("run.repair.lint.completed");
    expect(emitted[1].payload.success).toBe(true);
  });

  it("should attempt auto-fix when errors found", async () => {
    const _callCount = 0;
    const execFn = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        // First call: lint with errors
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                {
                  ruleId: "semi",
                  severity: 2,
                  message: "Missing semicolon",
                  line: 10,
                  column: 5,
                },
              ],
            },
          ]),
        );
        throw error;
      } else if (callCount === 2) {
        // Second call: lint --fix (success)
        return Buffer.from("Fixed 1 error", "utf-8");
      } else {
        // Third call: recheck lint (no errors)
        return Buffer.from("", "utf-8");
      }
    });

    const gitCommit = vi.fn(() => "abc123");

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 3,
        autoCommitFixes: true,
      },
      projectRoot: "/project",
      execFn,
      gitCommit,
    });

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.fixesApplied).toBe(true);
    expect(result.autoCommitHash).toBe("abc123");
    expect(result.iteration).toBe(1);
    expect(gitCommit).toHaveBeenCalledWith("chore: auto-fix lint errors", "/project");
  });

  it("should respect maxRetries limit", async () => {
    const _callCount = 0;
    const execFn = vi.fn(() => {
      callCount++;
      // Always return errors (error count doesn't decrease, so loop breaks after first iteration)
      const error: any = new Error("Lint failed");
      error.stdout = Buffer.from(
        JSON.stringify([
          {
            filePath: "src/file.ts",
            messages: [
              {
                ruleId: "no-unused-vars",
                severity: 2,
                message: "Unused variable",
                line: 10,
                column: 5,
              },
            ],
          },
        ]),
      );
      throw error;
    });

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 2,
        autoCommitFixes: true,
      },
      projectRoot: "/project",
      execFn,
      gitCommit: vi.fn(() => "abc123"),
    });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    // Loop breaks after 1 iteration because error count doesn't decrease
    expect(result.iteration).toBe(1);
  });

  it("should not auto-fix when tool is tsc", async () => {
    const execFn = vi.fn(() => {
      const error: any = new Error("TSC failed");
      error.stdout = Buffer.from("src/file.ts(10,5): error TS2304: Cannot find name 'foo'.");
      throw error;
    });

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "tsc --noEmit",
        maxRetries: 3,
        autoCommitFixes: true,
        tool: "tsc",
      },
      projectRoot: "/project",
      execFn,
    });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.fixesApplied).toBe(false);
    expect(result.iteration).toBe(0); // Exits loop immediately since can't auto-fix
  });

  it("should skip auto-commit when autoCommitFixes is false", async () => {
    const _callCount = 0;
    const execFn = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                { ruleId: "semi", severity: 2, message: "Missing semicolon", line: 10, column: 5 },
              ],
            },
          ]),
        );
        throw error;
      } else if (callCount === 2) {
        return Buffer.from("Fixed", "utf-8");
      } else {
        return Buffer.from("", "utf-8");
      }
    });

    const gitCommit = vi.fn(() => "abc123");

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 3,
        autoCommitFixes: false,
      },
      projectRoot: "/project",
      execFn,
      gitCommit,
    });

    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);
    expect(result.autoCommitHash).toBeUndefined();
    expect(gitCommit).not.toHaveBeenCalled();
  });

  it("should use custom fixCommand when provided", async () => {
    const _callCount = 0;
    const execFn = vi.fn((command: string) => {
      callCount++;
      if (callCount === 1) {
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                { ruleId: "semi", severity: 2, message: "Missing semicolon", line: 10, column: 5 },
              ],
            },
          ]),
        );
        throw error;
      } else if (callCount === 2) {
        // Verify custom fix command is used
        expect(command).toBe("npm run custom-fix");
        return Buffer.from("Fixed", "utf-8");
      } else {
        return Buffer.from("", "utf-8");
      }
    });

    await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        fixCommand: "npm run custom-fix",
        maxRetries: 3,
        autoCommitFixes: false,
      },
      projectRoot: "/project",
      execFn,
    });

    expect(execFn).toHaveBeenCalledWith("npm run custom-fix", expect.anything());
  });

  it("should stop retrying when error count doesn't decrease", async () => {
    const _callCount = 0;
    const execFn = vi.fn(() => {
      callCount++;
      const error: any = new Error("Lint failed");
      error.stdout = Buffer.from(
        JSON.stringify([
          {
            filePath: "src/file.ts",
            messages: [
              {
                ruleId: "no-unused-vars",
                severity: 2,
                message: "Unused variable",
                line: 10,
                column: 5,
              },
            ],
          },
        ]),
      );
      throw error;
    });

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 3,
        autoCommitFixes: false,
      },
      projectRoot: "/project",
      execFn,
    });

    // Should exit after first fix attempt since errors don't decrease
    expect(result.iteration).toBe(1);
    expect(result.success).toBe(false);
  });
});

describe("runLintRepair - Auto-fix", () => {
  it("should build fix command for ESLint", async () => {
    let fixCommandUsed = "";
    const _callCount = 0;
    const execFn = vi.fn((command: string) => {
      callCount++;
      if (callCount === 1) {
        // Initial lint: has errors
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                { ruleId: "semi", severity: 2, message: "Missing semicolon", line: 10, column: 5 },
              ],
            },
          ]),
        );
        throw error;
      } else if (command.includes("--fix")) {
        // Fix command
        fixCommandUsed = command;
        return Buffer.from("Fixed", "utf-8");
      } else {
        // Recheck: no errors
        return Buffer.from("", "utf-8");
      }
    });

    await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 1,
        autoCommitFixes: false,
        tool: "eslint",
      },
      projectRoot: "/project",
      execFn,
    });

    // ESLint should use --fix
    expect(fixCommandUsed).toContain("--fix");
  });

  it("should build fix command for Prettier", async () => {
    let fixCommandUsed = "";
    const _callCount = 0;
    const execFn = vi.fn((command: string) => {
      callCount++;
      if (callCount === 1) {
        // Initial prettier check: has errors
        const error: any = new Error("Prettier failed");
        error.stdout = Buffer.from("[error] src/file.ts: Code style issues found");
        throw error;
      } else if (command.includes("--write")) {
        // Fix command
        fixCommandUsed = command;
        return Buffer.from("Fixed", "utf-8");
      } else {
        // Recheck: no errors
        return Buffer.from("", "utf-8");
      }
    });

    await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run prettier",
        maxRetries: 1,
        autoCommitFixes: false,
        tool: "prettier",
      },
      projectRoot: "/project",
      execFn,
    });

    // Prettier should use --write
    expect(fixCommandUsed).toContain("--write");
  });

  it("should handle git commit failure gracefully", async () => {
    const _callCount = 0;
    const execFn = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                { ruleId: "semi", severity: 2, message: "Missing semicolon", line: 10, column: 5 },
              ],
            },
          ]),
        );
        throw error;
      } else if (callCount === 2) {
        return Buffer.from("Fixed", "utf-8");
      } else {
        return Buffer.from("", "utf-8");
      }
    });

    const gitCommit = vi.fn(() => {
      throw new Error("Git commit failed");
    });

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 3,
        autoCommitFixes: true,
      },
      projectRoot: "/project",
      execFn,
      gitCommit,
    });

    // Should still complete successfully even if commit fails
    expect(result.success).toBe(true);
    expect(result.fixesApplied).toBe(true);
    expect(result.autoCommitHash).toBeUndefined();
  });

  it("should handle fix command failure", async () => {
    const _callCount = 0;
    const execFn = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                { ruleId: "semi", severity: 2, message: "Missing semicolon", line: 10, column: 5 },
              ],
            },
          ]),
        );
        throw error;
      } else if (callCount === 2) {
        // Fix command fails
        const error: any = new Error("Fix failed");
        error.stdout = Buffer.from("Could not fix", "utf-8");
        throw error;
      } else {
        // Recheck still has errors
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                { ruleId: "semi", severity: 2, message: "Missing semicolon", line: 10, column: 5 },
              ],
            },
          ]),
        );
        throw error;
      }
    });

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 3,
        autoCommitFixes: false,
      },
      projectRoot: "/project",
      execFn,
    });

    expect(result.success).toBe(false);
    expect(result.fixesApplied).toBe(true); // Fix was attempted
  });

  it("should default to --fix when tool not specified", async () => {
    let fixCommandUsed = "";
    const _callCount = 0;
    const execFn = vi.fn((command: string) => {
      callCount++;
      if (callCount === 1) {
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                { ruleId: "semi", severity: 2, message: "Missing semicolon", line: 10, column: 5 },
              ],
            },
          ]),
        );
        throw error;
      } else if (command.includes("--fix")) {
        fixCommandUsed = command;
        return Buffer.from("Fixed", "utf-8");
      } else {
        return Buffer.from("", "utf-8");
      }
    });

    await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 1,
        autoCommitFixes: false,
        // No tool specified - should default to --fix
      },
      projectRoot: "/project",
      execFn,
    });

    expect(fixCommandUsed).toContain("--fix");
  });

  it("should reduce error count across iterations", async () => {
    const _callCount = 0;
    const execFn = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        // Initial: 2 errors
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                { ruleId: "semi", severity: 2, message: "Missing semicolon", line: 10, column: 5 },
                {
                  ruleId: "quotes",
                  severity: 2,
                  message: "Use single quotes",
                  line: 15,
                  column: 10,
                },
              ],
            },
          ]),
        );
        throw error;
      } else if (callCount === 2) {
        // Fix command
        return Buffer.from("Fixed some", "utf-8");
      } else if (callCount === 3) {
        // Recheck: 1 error remains
        const error: any = new Error("Lint failed");
        error.stdout = Buffer.from(
          JSON.stringify([
            {
              filePath: "src/file.ts",
              messages: [
                {
                  ruleId: "quotes",
                  severity: 2,
                  message: "Use single quotes",
                  line: 15,
                  column: 10,
                },
              ],
            },
          ]),
        );
        throw error;
      } else if (callCount === 4) {
        // Second fix
        return Buffer.from("Fixed more", "utf-8");
      } else {
        // Final check: no errors
        return Buffer.from("", "utf-8");
      }
    });

    const result = await runLintRepair({
      changedFiles: ["src/file.ts"],
      config: {
        command: "npm run lint",
        maxRetries: 3,
        autoCommitFixes: false,
      },
      projectRoot: "/project",
      execFn,
    });

    expect(result.success).toBe(true);
    expect(result.iteration).toBe(2);
  });
});

describe("formatLintErrors", () => {
  it("should format empty errors", () => {
    const formatted = formatLintErrors([]);
    expect(formatted).toBe("No lint errors found.");
  });

  it("should format single error", () => {
    const errors: LintError[] = [
      {
        file: "src/file.ts",
        line: 10,
        column: 5,
        rule: "no-unused-vars",
        message: "'foo' is declared but never used",
        severity: "error",
      },
    ];

    const formatted = formatLintErrors(errors);

    expect(formatted).toContain("Found 1 lint error");
    expect(formatted).toContain("src/file.ts");
    expect(formatted).toContain("10:5");
    expect(formatted).toContain("error");
    expect(formatted).toContain("'foo' is declared but never used");
    expect(formatted).toContain("(no-unused-vars)");
  });

  it("should group errors by file", () => {
    const errors: LintError[] = [
      {
        file: "src/file1.ts",
        line: 10,
        column: 5,
        rule: "semi",
        message: "Missing semicolon",
        severity: "error",
      },
      {
        file: "src/file2.ts",
        line: 20,
        column: 15,
        rule: "quotes",
        message: "Use single quotes",
        severity: "warning",
      },
      {
        file: "src/file1.ts",
        line: 15,
        column: 10,
        rule: "no-unused-vars",
        message: "Unused variable",
        severity: "error",
      },
    ];

    const formatted = formatLintErrors(errors);

    expect(formatted).toContain("Found 3 lint error(s) in 2 file(s)");
    expect(formatted).toContain("src/file1.ts");
    expect(formatted).toContain("src/file2.ts");
    expect(formatted).toContain("10:5");
    expect(formatted).toContain("15:10");
    expect(formatted).toContain("20:15");
  });

  it("should format warnings differently from errors", () => {
    const errors: LintError[] = [
      {
        file: "src/file.ts",
        line: 10,
        column: 5,
        rule: "semi",
        message: "Missing semicolon",
        severity: "error",
      },
      {
        file: "src/file.ts",
        line: 15,
        column: 10,
        rule: "quotes",
        message: "Use single quotes",
        severity: "warning",
      },
    ];

    const formatted = formatLintErrors(errors);

    expect(formatted).toContain("error");
    expect(formatted).toContain("warn");
  });
});
