import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runSkillbookCommand } from "./skillbook.js";

const makeTestDir = () => {
  const dir = join(
    tmpdir(),
    `dc-skillbook-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe("runSkillbookCommand", () => {
  let testDir: string;
  let output: string[];
  let exitCalled: boolean;
  let originalLog: typeof console.log;
  let originalError: typeof console.error;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    testDir = makeTestDir();
    output = [];
    exitCalled = false;
    originalLog = console.log;
    originalError = console.error;
    originalExit = process.exit;
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    };
    // Override process.exit to throw instead of actually exiting
    process.exit = ((code?: number) => {
      exitCalled = true;
      throw new Error(`process.exit(${code ?? 0})`);
    }) as typeof process.exit;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("status — shows 0 skills on empty skillbook", async () => {
    await runSkillbookCommand(["status"], testDir);
    expect(output.join("\n")).toContain("0");
    expect(output.join("\n")).toMatch(/skillbook/i);
  });

  it("stats — alias for status", async () => {
    await runSkillbookCommand(["stats"], testDir);
    expect(output.join("\n")).toContain("0");
  });

  it("review — prints 'no pending' when queue is empty", async () => {
    await runSkillbookCommand(["review"], testDir);
    expect(output.join("\n")).toMatch(/no pending/i);
  });

  it("learn-now — adds a skill and confirms", async () => {
    await runSkillbookCommand(
      ["learn-now", "Always use strict null checks in TypeScript."],
      testDir,
    );
    expect(output.join("\n")).toMatch(/skill added/i);
  });

  it("learn-now — increases total skill count", async () => {
    await runSkillbookCommand(["learn-now", "Use async/await over callbacks."], testDir);
    output = [];
    await runSkillbookCommand(["status"], testDir);
    expect(output.join("\n")).toContain("1");
  });

  it("learn-now — prints error and exits on empty text", async () => {
    await expect(runSkillbookCommand(["learn-now"], testDir)).rejects.toThrow("process.exit");
    expect(output.join("\n")).toMatch(/usage/i);
  });

  it("approve — prints error and exits for unknown id", async () => {
    await expect(runSkillbookCommand(["approve", "bad-id"], testDir)).rejects.toThrow(
      "process.exit",
    );
    expect(output.join("\n")).toMatch(/not found/i);
    expect(exitCalled).toBe(true);
  });

  it("reject — prints error and exits for unknown id", async () => {
    await expect(runSkillbookCommand(["reject", "bad-id"], testDir)).rejects.toThrow(
      "process.exit",
    );
    expect(output.join("\n")).toMatch(/not found/i);
    expect(exitCalled).toBe(true);
  });

  it("unknown subcommand — shows help text", async () => {
    await runSkillbookCommand(["unknown"], testDir);
    expect(output.join("\n")).toMatch(/subcommand/i);
  });
});
