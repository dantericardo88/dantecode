import { describe, it, expect } from "vitest";
import { runGStackSingle, runGStack, allGStackPassed, summarizeGStackResults } from "./gstack.js";
import type { GStackCommand } from "@dantecode/config-types";

// Use the actual project root for commands that need a valid cwd
const VALID_CWD = process.cwd();

describe("gstack runner", () => {
  describe("runGStackSingle", () => {
    it("runs a simple command successfully", async () => {
      const command: GStackCommand = {
        name: "echo-test",
        command: "echo hello",
        runInSandbox: false,
        timeoutMs: 5000,
        failureIsSoft: false,
      };
      const result = await runGStackSingle(command, VALID_CWD);
      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("captures stderr from failing commands", async () => {
      const command: GStackCommand = {
        name: "fail-test",
        command: "node -e \"process.stderr.write('error msg'); process.exit(1)\"",
        runInSandbox: false,
        timeoutMs: 5000,
        failureIsSoft: false,
      };
      const result = await runGStackSingle(command, VALID_CWD);
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("error msg");
    });

    it("passes soft-failure commands even when exit code is non-zero", async () => {
      const command: GStackCommand = {
        name: "soft-fail",
        command: 'node -e "process.exit(1)"',
        runInSandbox: false,
        timeoutMs: 5000,
        failureIsSoft: true,
      };
      const result = await runGStackSingle(command, VALID_CWD);
      expect(result.passed).toBe(true); // soft failure = always passes
      expect(result.exitCode).toBe(1);
    });

    it("returns error for non-existent working directory", async () => {
      const command: GStackCommand = {
        name: "bad-cwd",
        command: "echo test",
        runInSandbox: false,
        timeoutMs: 5000,
        failureIsSoft: false,
      };
      const result = await runGStackSingle(command, "/nonexistent/path/12345");
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("does not exist");
    });

    it("returns error for empty command", async () => {
      const command: GStackCommand = {
        name: "empty",
        command: "",
        runInSandbox: false,
        timeoutMs: 5000,
        failureIsSoft: false,
      };
      const result = await runGStackSingle(command, VALID_CWD);
      expect(result.passed).toBe(false);
      expect(result.stderr).toContain("Empty command");
    });

    it("handles command not found gracefully", async () => {
      const command: GStackCommand = {
        name: "not-found",
        command: "nonexistent_binary_xyz_12345",
        runInSandbox: false,
        timeoutMs: 5000,
        failureIsSoft: false,
      };
      const result = await runGStackSingle(command, VALID_CWD);
      expect(result.passed).toBe(false);
      // Either exit code 127 (command not found) or spawn error
      expect(result.exitCode).not.toBe(0);
    });

    it("records duration in milliseconds", async () => {
      const command: GStackCommand = {
        name: "duration-test",
        command: 'node -e "setTimeout(() => {}, 100)"',
        runInSandbox: false,
        timeoutMs: 5000,
        failureIsSoft: false,
      };
      const result = await runGStackSingle(command, VALID_CWD);
      expect(result.durationMs).toBeGreaterThanOrEqual(50);
    });
  });

  describe("runGStack (sequential multi-command)", () => {
    it("runs multiple commands and returns all results", async () => {
      const commands: GStackCommand[] = [
        {
          name: "first",
          command: "echo first",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: false,
        },
        {
          name: "second",
          command: "echo second",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: false,
        },
      ];
      const results = await runGStack("", commands, VALID_CWD);
      expect(results).toHaveLength(2);
      expect(results[0]?.stdout).toContain("first");
      expect(results[1]?.stdout).toContain("second");
    });

    it("continues executing after a failure", async () => {
      const commands: GStackCommand[] = [
        {
          name: "fail",
          command: 'node -e "process.exit(1)"',
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: false,
        },
        {
          name: "pass",
          command: "echo still-runs",
          runInSandbox: false,
          timeoutMs: 5000,
          failureIsSoft: false,
        },
      ];
      const results = await runGStack("", commands, VALID_CWD);
      expect(results).toHaveLength(2);
      expect(results[0]?.passed).toBe(false);
      expect(results[1]?.passed).toBe(true);
    });

    it("returns empty array for no commands", async () => {
      const results = await runGStack("", [], VALID_CWD);
      expect(results).toEqual([]);
    });
  });

  describe("allGStackPassed", () => {
    it("returns true when all results passed", () => {
      const results = [
        { command: "a", exitCode: 0, stdout: "", stderr: "", durationMs: 10, passed: true },
        { command: "b", exitCode: 0, stdout: "", stderr: "", durationMs: 20, passed: true },
      ];
      expect(allGStackPassed(results)).toBe(true);
    });

    it("returns false when any result failed", () => {
      const results = [
        { command: "a", exitCode: 0, stdout: "", stderr: "", durationMs: 10, passed: true },
        { command: "b", exitCode: 1, stdout: "", stderr: "", durationMs: 20, passed: false },
      ];
      expect(allGStackPassed(results)).toBe(false);
    });

    it("returns true for empty results", () => {
      expect(allGStackPassed([])).toBe(true);
    });
  });

  describe("summarizeGStackResults", () => {
    it("produces PASS/FAIL summary lines", () => {
      const results = [
        {
          command: "typecheck",
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 100,
          passed: true,
        },
        {
          command: "lint",
          exitCode: 1,
          stdout: "",
          stderr: "error found",
          durationMs: 50,
          passed: false,
        },
      ];
      const summary = summarizeGStackResults(results);
      expect(summary).toContain("[PASS] typecheck");
      expect(summary).toContain("[FAIL] lint");
      expect(summary).toContain("error found");
    });

    it("returns empty string for no results", () => {
      expect(summarizeGStackResults([])).toBe("");
    });
  });
});
