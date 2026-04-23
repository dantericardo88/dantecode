// packages/cli/src/__tests__/generate-command.test.ts
// Sprint 30 — Dim 10: cmdGenerate CLI command tests
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cmdGenerate, formatScaffoldSummary, detectProjectType } from "../commands/generate.js";

// Mock fs/promises to avoid real disk writes
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, writeFile } from "node:fs/promises";

describe("cmdGenerate", () => {
  const passingExec = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success:true and a plan for a valid description", async () => {
    const result = await cmdGenerate("REST API for managing users", { dryRun: true });
    expect(result.success).toBe(true);
    expect(result.plan.projectType).toBe("node-api");
    expect(result.plan.files.length).toBeGreaterThan(0);
  });

  it("dry-run does not write any files", async () => {
    await cmdGenerate("React TypeScript app", { dryRun: true });
    expect(writeFile).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("writes files to disk when not dry-run", async () => {
    const result = await cmdGenerate("library for math", {
      outDir: "/tmp/test-lib",
      incrementalExecFn: passingExec,
    });
    expect(result.success).toBe(true);
    expect(writeFile).toHaveBeenCalled();
    expect(result.writtenFiles.length).toBeGreaterThan(0);
  });

  it("returns error for empty description", async () => {
    const result = await cmdGenerate("");
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("returns error for too-short description", async () => {
    const result = await cmdGenerate("ab");
    expect(result.success).toBe(false);
  });

  it("respects name override", async () => {
    const result = await cmdGenerate("REST API for todos", { name: "todo-api", dryRun: true });
    expect(result.plan.projectName).toBe("todo-api");
  });

  it("respects outDir override when writing files", async () => {
    await cmdGenerate("CLI tool for git", {
      outDir: "/custom/path",
      incrementalExecFn: passingExec,
    });
    const calls = (mkdir as ReturnType<typeof vi.fn>).mock.calls;
    // Normalize slashes for cross-platform comparison
    expect(calls.some((c: unknown[]) => String(c[0]).replace(/\\/g, "/").includes("custom/path"))).toBe(true);
  });

  it("detects python-cli project type from description", async () => {
    const result = await cmdGenerate("Python CLI for file processing", { dryRun: true });
    expect(result.plan.projectType).toBe("python-cli");
  });

  it("detects react-ts-app project type", async () => {
    const result = await cmdGenerate("React TypeScript SPA with Redux", { dryRun: true });
    expect(result.plan.projectType).toBe("react-ts-app");
  });

  it("plan includes postInstallCommands", async () => {
    const result = await cmdGenerate("Node API", { dryRun: true });
    expect(result.plan.postInstallCommands.length).toBeGreaterThan(0);
  });

  it("writtenFiles list matches plan files when not dry-run", async () => {
    const result = await cmdGenerate("library for utilities", {
      outDir: "/tmp/test",
      incrementalExecFn: passingExec,
    });
    expect(result.writtenFiles.length).toBe(result.plan.files.length);
  });

  it("records incremental verification results when writing files", async () => {
    const result = await cmdGenerate("Node API", {
      outDir: "/tmp/test-verify",
      incrementalExecFn: passingExec,
    });
    expect(result.success).toBe(true);
    expect(result.incrementalVerification?.length).toBeGreaterThan(0);
  });

  it("stops generation when incremental verification fails", async () => {
    const failAfterFirst = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "typecheck failed", exitCode: 1 });
    const result = await cmdGenerate("Node API", {
      outDir: "/tmp/test-stop",
      incrementalExecFn: failAfterFirst,
      stackTemplateOverride: {
        stack: "typescript-node",
        scaffoldHint: "TypeScript Node project",
        entryPoints: ["src/index.ts"],
        typecheckCmd: "npm run typecheck",
        testCmd: "npm test",
      },
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Incremental verification failed");
    expect(result.incrementalVerification?.some((entry) => entry.passed === false)).toBe(true);
  });

  it("persists a successful task outcome artifact after generation", async () => {
    const taskOutcomeRecorder = vi.fn().mockResolvedValue(undefined);
    const result = await cmdGenerate("Node API", {
      outDir: "/tmp/test-outcome-success",
      incrementalExecFn: passingExec,
      taskOutcomeRecorder,
    });

    expect(result.success).toBe(true);
    expect(taskOutcomeRecorder).toHaveBeenCalledTimes(1);
    expect(taskOutcomeRecorder.mock.calls[0]?.[0]).toMatchObject({
      command: "generate",
      success: true,
      taskDescription: "Node API",
    });
    expect(taskOutcomeRecorder.mock.calls[0]?.[1]).toBe("/tmp/test-outcome-success");
  });

  it("persists a failed task outcome artifact when incremental verification aborts generation", async () => {
    const taskOutcomeRecorder = vi.fn().mockResolvedValue(undefined);
    const failAfterFirst = vi
      .fn()
      .mockResolvedValue({ stdout: "", stderr: "typecheck failed", exitCode: 1 });
    const result = await cmdGenerate("Node API", {
      outDir: "/tmp/test-outcome-failure",
      incrementalExecFn: failAfterFirst,
      stackTemplateOverride: {
        stack: "typescript-node",
        scaffoldHint: "TypeScript Node project",
        entryPoints: ["src/index.ts"],
        typecheckCmd: "npm run typecheck",
        testCmd: "npm test",
      },
      taskOutcomeRecorder,
    });

    expect(result.success).toBe(false);
    expect(taskOutcomeRecorder).toHaveBeenCalledTimes(1);
    expect(taskOutcomeRecorder.mock.calls[0]?.[0]).toMatchObject({
      command: "generate",
      success: false,
      taskDescription: "Node API",
    });
    expect(String(taskOutcomeRecorder.mock.calls[0]?.[0]?.error ?? "")).toContain(
      "Incremental verification failed",
    );
  });

  it("formatScaffoldSummary returns markdown string", async () => {
    const result = await cmdGenerate("CLI for git management", { dryRun: true });
    const summary = formatScaffoldSummary(result.plan);
    expect(typeof summary).toBe("string");
    expect(summary).toContain("##");
  });

  it("detectProjectType re-exported from generate command", () => {
    expect(detectProjectType("Python CLI tool")).toBe("python-cli");
  });
});
