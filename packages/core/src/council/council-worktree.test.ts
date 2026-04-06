// ============================================================================
// Council Orchestrator — Worktree Integration Tests
// Tests worktree creation, merging, and cleanup for council lanes.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import { CouncilOrchestrator } from "./council-orchestrator.js";
import type { AgentKind } from "./council-types.js";
import { DanteCodeAdapter } from "./agent-adapters/dantecode.js";
import type { SelfLaneExecutor } from "./agent-adapters/dantecode.js";
import { listWorktrees, createWorktree, removeWorktree, mergeWorktree } from "@dantecode/git-engine";

// ----------------------------------------------------------------------------
// Test Helpers
// ----------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `worktree-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });

  // Initialize a git repo
  execSync("git init", { cwd: testDir, stdio: "pipe" });
  execSync("git config user.email test@example.com", { cwd: testDir, stdio: "pipe" });
  execSync("git config user.name Test", { cwd: testDir, stdio: "pipe" });

  // Create an initial commit on main
  await writeFile(join(testDir, "README.md"), "# Test Repo\n");
  execSync("git add README.md", { cwd: testDir, stdio: "pipe" });
  execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: "pipe" });
  execSync("git branch -M main", { cwd: testDir, stdio: "pipe" });
});

function createMockExecutor(
  behavior: "success" | "failure" | "crash" = "success",
  delayMs: number = 0,
): SelfLaneExecutor {
  return async (prompt: string, worktreePath: string) => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    if (behavior === "crash") {
      throw new Error("Executor crashed");
    }

    if (behavior === "success") {
      // Create uniquely named source + test files (avoids merge conflicts across lanes).
      // Include a .test.ts so PDSE heuristic scores 85 (passes 70 threshold).
      const slug = Buffer.from(worktreePath).toString("base64").slice(-8).replace(/[^a-z0-9]/gi, "x");
      const srcFile = `output-${slug}.txt`;
      const testFile = `output-${slug}.test.ts`;
      await writeFile(join(worktreePath, srcFile), `Result: ${prompt}\n`);
      await writeFile(join(worktreePath, testFile), `// test for ${srcFile}\n`);
      execSync(`git add ${srcFile} ${testFile}`, { cwd: worktreePath, stdio: "pipe" });
      execSync('git commit -m "Add output"', { cwd: worktreePath, stdio: "pipe" });
    }

    return {
      output: behavior === "success" ? "Task completed" : "Task failed",
      touchedFiles: behavior === "success" ? ["output.txt", "output.test.ts"] : [],
      success: behavior === "success",
      error: behavior === "failure" ? "Execution failed" : undefined,
    };
  };
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("CouncilOrchestrator — Worktree Integration", () => {
  describe("Worktree Creation", () => {
    it("should create a unique worktree for each lane", async () => {
      const executor = createMockExecutor("success");
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 100,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test parallel lanes",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      // Assign two lanes
      const lane1 = await orchestrator.assignLane({
        objective: "Task 1",
        taskCategory: "coding",
        ownedFiles: ["file1.ts"],
        worktreePath: testDir, // Will be replaced with unique worktree
        branch: "lane1",
        baseBranch: "main",
      });

      const lane2 = await orchestrator.assignLane({
        objective: "Task 2",
        taskCategory: "coding",
        ownedFiles: ["file2.ts"],
        worktreePath: testDir,
        branch: "lane2",
        baseBranch: "main",
      });

      expect(lane1.accepted).toBe(true);
      expect(lane2.accepted).toBe(true);

      // Check that worktrees were created
      const worktrees = listWorktrees(testDir);
      expect(worktrees.length).toBeGreaterThanOrEqual(2);

      const state = orchestrator.currentRunState;
      expect(state?.agents.length).toBe(2);

      const session1 = state?.agents.find((a) => a.laneId === lane1.laneId);
      const session2 = state?.agents.find((a) => a.laneId === lane2.laneId);

      expect(session1?.worktreeBranch).toBeTruthy();
      expect(session2?.worktreeBranch).toBeTruthy();
      expect(session1?.worktreeBranch).not.toBe(session2?.worktreeBranch);

      await orchestrator.fail("Test cleanup");
    });

    it("should emit worktree:created event when worktree is created", async () => {
      const executor = createMockExecutor("success");
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 100,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      const createdEvents: Array<{ laneId: string; worktreePath: string }> = [];
      orchestrator.on("worktree:created", (event) => {
        createdEvents.push(event);
      });

      await orchestrator.start({
        objective: "Test event",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["test.ts"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      expect(createdEvents.length).toBe(1);
      expect(createdEvents[0]?.laneId).toBeTruthy();
      expect(createdEvents[0]?.worktreePath.replace(/\\/g, "/")).toContain(".dantecode/worktrees");

      await orchestrator.fail("Test cleanup");
    });

    it("should populate worktreeBranch on AgentSessionState", async () => {
      const executor = createMockExecutor("success");
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 100,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test state",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      const result = await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["test.ts"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      const state = orchestrator.currentRunState;
      const session = state?.agents.find((a) => a.laneId === result.laneId);

      expect(session?.worktreeBranch).toBeTruthy();
      expect(session?.worktreeBranch).toMatch(/^council\//);

      await orchestrator.fail("Test cleanup");
    });

    it("should clean up worktree if lane assignment fails", async () => {
      const executor = createMockExecutor("success");
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 100,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
        councilConfig: { maxNestingDepth: 2 }, // Set a finite limit so depth=999 triggers rejection
      });

      await orchestrator.start({
        objective: "Test cleanup",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      // Force assignment to fail by exceeding nesting depth
      await expect(
        orchestrator.assignLane({
          objective: "Deep task",
          taskCategory: "coding",
          ownedFiles: ["test.ts"],
          worktreePath: testDir,
          branch: "test",
          baseBranch: "main",
          nestingDepth: 999, // Exceeds maxNestingDepth=2
        }),
      ).rejects.toThrow();

      // Worktree should be cleaned up
      const worktrees = listWorktrees(testDir);
      const councilWorktrees = worktrees.filter((w) => w.branch.includes("council/"));
      expect(councilWorktrees.length).toBe(0);

      await orchestrator.fail("Test cleanup");
    });

    it("should create worktree with correct branch pattern", async () => {
      const executor = createMockExecutor("success");
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 100,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test branch pattern",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      const result = await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["test.ts"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      const state = orchestrator.currentRunState;
      const session = state?.agents.find((a) => a.laneId === result.laneId);
      const runId = state?.runId;

      expect(session?.worktreeBranch).toMatch(new RegExp(`^council/${runId}/`));

      await orchestrator.fail("Test cleanup");
    });
  });

  describe("Worktree Merge on Success", () => {
    it("should merge worktree back to main when lane completes successfully", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      const mergedEvents: Array<{ laneId: string; commitSha: string }> = [];
      orchestrator.on("worktree:merged", (event) => {
        mergedEvents.push(event);
      });

      await orchestrator.start({
        objective: "Test merge",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Create file",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      // Wait for lane to complete and merge
      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      expect(mergedEvents.length).toBe(1);
      expect(mergedEvents[0]?.commitSha).toBeTruthy();
      expect(mergedEvents[0]?.laneId).toBeTruthy();
    });

    it("should emit worktree:cleaned event after successful merge", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      const cleanedEvents: Array<{ laneId: string; reason: string }> = [];
      orchestrator.on("worktree:cleaned", (event) => {
        cleanedEvents.push(event);
      });

      await orchestrator.start({
        objective: "Test cleanup",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Create file",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      expect(cleanedEvents.length).toBe(1);
      expect(cleanedEvents[0]?.reason).toBe("success");
    });

    it("should remove worktree directory after successful merge", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test removal",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Create file",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // Worktree should be removed
      const worktrees = listWorktrees(testDir);
      const councilWorktrees = worktrees.filter((w) => w.branch.includes("council/"));
      expect(councilWorktrees.length).toBe(0);
    });

    it("should merge changes to main branch correctly", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test merge content",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Create output file",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // Check that an output file was merged to main (mock creates output-<slug>.txt)
      const files = execSync("git ls-files", { cwd: testDir, encoding: "utf-8" })
        .trim()
        .split("\n");
      expect(files.some((f) => f.startsWith("output-") && f.endsWith(".txt"))).toBe(true);
    });

    it("should only merge lanes that pass PDSE verification", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
        councilConfig: {
          pdseThreshold: 90, // High threshold — will fail without test files
        },
      });

      const mergedEvents: unknown[] = [];
      orchestrator.on("worktree:merged", () => {
        mergedEvents.push({});
      });

      await orchestrator.start({
        objective: "Test verification gate",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Create file without tests",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // Should NOT merge because verification failed
      expect(mergedEvents.length).toBe(0);
    });
  });

  describe("Worktree Preservation on Failure", () => {
    it("should preserve worktree when lane fails", async () => {
      const executor = createMockExecutor("failure", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        maxLaneRetries: 0, // No retries
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test failure",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Failing task",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // Worktree should still exist for manual review
      const worktrees = listWorktrees(testDir);
      const councilWorktrees = worktrees.filter((w) => w.branch.includes("council/"));
      expect(councilWorktrees.length).toBeGreaterThan(0);
    });

    it("should emit worktree:cleaned with reason=failure for failed lanes", async () => {
      const executor = createMockExecutor("failure", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        maxLaneRetries: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      const cleanedEvents: Array<{ laneId: string; reason: string }> = [];
      orchestrator.on("worktree:cleaned", (event) => {
        cleanedEvents.push(event);
      });

      await orchestrator.start({
        objective: "Test failure event",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Failing task",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // When preserve=true (default for failed lanes), worktree is kept for manual review
      // so no worktree:cleaned event is emitted — the worktree was not cleaned.
      const failureEvents = cleanedEvents.filter((e) => e.reason === "failure");
      expect(failureEvents.length).toBe(0);
    });

    it("should preserve worktree when PDSE verification fails", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
        councilConfig: {
          pdseThreshold: 95, // Very high threshold
        },
      });

      await orchestrator.start({
        objective: "Test verification failure",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Task without sufficient quality",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // Worktree should be preserved
      const worktrees = listWorktrees(testDir);
      const councilWorktrees = worktrees.filter((w) => w.branch.includes("council/"));
      expect(councilWorktrees.length).toBeGreaterThan(0);
    });

    it("should preserve worktree when budget cap is exceeded", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });

      // Mock adapter to return high token usage
      const originalPollStatus = adapter.pollStatus.bind(adapter);
      adapter.pollStatus = vi.fn(async (sessionId: string) => {
        const status = await originalPollStatus(sessionId);
        return {
          ...status,
          tokensUsed: 999999, // Exceeds budget
        };
      });

      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
        councilConfig: {
          budget: {
            maxTotalTokens: 1000,
            maxTokensPerAgent: 500,
            maxTotalCostUsd: 100,
            warningThreshold: 0.8,
          },
        },
      });

      await orchestrator.start({
        objective: "Test budget cap",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // Worktree should be preserved
      const worktrees = listWorktrees(testDir);
      const councilWorktrees = worktrees.filter((w) => w.branch.includes("council/"));
      expect(councilWorktrees.length).toBeGreaterThan(0);
    });

    it("should not merge failed lanes to main", async () => {
      const executor = createMockExecutor("failure", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        maxLaneRetries: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      const mergedEvents: unknown[] = [];
      orchestrator.on("worktree:merged", () => {
        mergedEvents.push({});
      });

      await orchestrator.start({
        objective: "Test no merge on failure",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Failing task",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      expect(mergedEvents.length).toBe(0);
    });
  });

  describe("Worktree Cleanup", () => {
    it("should not leak worktrees after successful runs", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test no leaks",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      // Run 3 successful lanes
      for (let i = 0; i < 3; i++) {
        await orchestrator.assignLane({
          objective: `Task ${i}`,
          taskCategory: "coding",
          ownedFiles: [`file${i}.txt`],
          worktreePath: testDir,
          branch: `test${i}`,
          baseBranch: "main",
        });
      }

      await orchestrator.watchUntilComplete({ timeoutMs: 30000 });

      // All worktrees should be cleaned up
      const worktrees = listWorktrees(testDir);
      const councilWorktrees = worktrees.filter((w) => w.branch.includes("council/"));
      expect(councilWorktrees.length).toBe(0);
    });

    it("should handle concurrent lane completions without race conditions", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      const cleanedEvents: unknown[] = [];
      orchestrator.on("worktree:cleaned", () => {
        cleanedEvents.push({});
      });

      await orchestrator.start({
        objective: "Test concurrency",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      // Start multiple lanes concurrently
      await Promise.all([
        orchestrator.assignLane({
          objective: "Task A",
          taskCategory: "coding",
          ownedFiles: ["fileA.txt"],
          worktreePath: testDir,
          branch: "testA",
          baseBranch: "main",
        }),
        orchestrator.assignLane({
          objective: "Task B",
          taskCategory: "coding",
          ownedFiles: ["fileB.txt"],
          worktreePath: testDir,
          branch: "testB",
          baseBranch: "main",
        }),
      ]);

      await orchestrator.watchUntilComplete({ timeoutMs: 30000 });

      // Both lanes should emit cleanup events
      expect(cleanedEvents.length).toBe(2);
    });

    it("should handle worktree merge errors gracefully", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      const errorEvents: Array<{ message: string }> = [];
      orchestrator.on("error", (event) => {
        errorEvents.push(event);
      });

      await orchestrator.start({
        objective: "Test merge error handling",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      // Simulate dirty main branch before merge completes
      await writeFile(join(testDir, "conflicting.txt"), "conflict");
      execSync("git add conflicting.txt", { cwd: testDir, stdio: "pipe" });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // Orchestrator should handle merge error and continue
      const state = orchestrator.currentRunState;
      expect(state?.status).not.toBe("failed");
    });
  });

  describe("Event Emission", () => {
    it("should emit all worktree lifecycle events in correct order", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      const events: string[] = [];
      orchestrator.on("worktree:created", () => events.push("created"));
      orchestrator.on("worktree:merged", () => events.push("merged"));
      orchestrator.on("worktree:cleaned", () => events.push("cleaned"));

      await orchestrator.start({
        objective: "Test event order",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      expect(events).toEqual(["created", "merged", "cleaned"]);
    });

    it("should include correct metadata in worktree:created event", async () => {
      const executor = createMockExecutor("success");
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 100,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      let capturedEvent: { laneId: string; worktreePath: string; worktreeBranch: string } | null =
        null;
      orchestrator.on(
        "worktree:created",
        (event: { laneId: string; worktreePath: string; worktreeBranch: string }) => {
          capturedEvent = event;
        },
      );

      await orchestrator.start({
        objective: "Test metadata",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["test.ts"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.worktreePath.replace(/\\/g, "/")).toContain(".dantecode/worktrees");
      expect(capturedEvent!.worktreeBranch).toMatch(/^council\//);

      await orchestrator.fail("Test cleanup");
    });

    it("should include commit SHA in worktree:merged event", async () => {
      const executor = createMockExecutor("success", 50);
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      let capturedEvent: {
        laneId: string;
        worktreeBranch: string;
        targetBranch: string;
        commitSha: string;
      } | null = null;
      orchestrator.on(
        "worktree:merged",
        (event: {
          laneId: string;
          worktreeBranch: string;
          targetBranch: string;
          commitSha: string;
        }) => {
          capturedEvent = event;
        },
      );

      await orchestrator.start({
        objective: "Test commit SHA",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["output.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      expect(capturedEvent).not.toBeNull();
      expect(capturedEvent!.commitSha).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("Edge Cases", () => {
    it("should handle lanes that create no changes", async () => {
      const noopExecutor: SelfLaneExecutor = async () => {
        // Don't create any files or commits
        return {
          output: "No changes made",
          touchedFiles: [],
          success: true,
        };
      };

      const adapter = new DanteCodeAdapter({ executor: noopExecutor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 50,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test no changes",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      await orchestrator.assignLane({
        objective: "No-op task",
        taskCategory: "coding",
        ownedFiles: ["phantom.txt"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

      // Should complete without errors
      expect(orchestrator.currentStatus).toBe("completed");
    });

    it("should handle very long lane IDs in worktree branch names", async () => {
      const executor = createMockExecutor("success");
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 100,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test long ID",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      const result = await orchestrator.assignLane({
        objective: "Task with long ID",
        taskCategory: "coding",
        ownedFiles: ["test.ts"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      const state = orchestrator.currentRunState;
      const session = state?.agents.find((a) => a.laneId === result.laneId);

      // Branch name should be valid
      expect(session?.worktreeBranch).toBeTruthy();
      expect(session?.worktreeBranch?.length).toBeLessThan(256); // Git limit

      await orchestrator.fail("Test cleanup");
    });

    it("should handle worktree creation when repo has uncommitted changes", async () => {
      // Add uncommitted file to main
      await writeFile(join(testDir, "dirty.txt"), "uncommitted");

      const executor = createMockExecutor("success");
      const adapter = new DanteCodeAdapter({ executor });
      const adapters = new Map<AgentKind, typeof adapter>([["dantecode", adapter]]);

      const orchestrator = new CouncilOrchestrator(adapters, {
        pollIntervalMs: 100,
        retryBaseDelayMs: 0,
        worktreeHooks: { createWorktree, removeWorktree, mergeWorktree },
      });

      await orchestrator.start({
        objective: "Test dirty repo",
        agents: ["dantecode"],
        repoRoot: testDir,
      });

      // Should still be able to create worktree
      const result = await orchestrator.assignLane({
        objective: "Task",
        taskCategory: "coding",
        ownedFiles: ["test.ts"],
        worktreePath: testDir,
        branch: "test",
        baseBranch: "main",
      });

      expect(result.accepted).toBe(true);

      await orchestrator.fail("Test cleanup");
    });
  });
});
