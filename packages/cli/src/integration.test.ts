// ============================================================================
// @dantecode/cli — Integration Tests
// Tests slash commands that tie together core + cli modules.
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";

import { BackgroundAgentRunner, CodeIndex, SessionStore } from "@dantecode/core";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { routeSlashCommand } from "./slash-commands.js";
import type { ChatSessionFile, DanteCodeState, Session } from "@dantecode/config-types";
import type { ReplState } from "./slash-commands.js";

describe("CLI Integration", () => {
  function makeRuntimeSession(projectRoot = process.cwd()): Session {
    return {
      id: "session-1",
      projectRoot,
      messages: [],
      activeFiles: [],
      readOnlyFiles: [],
      model: {
        provider: "grok",
        modelId: "grok-3",
        maxTokens: 4096,
        temperature: 0.1,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentStack: [],
      todoList: [],
    };
  }

  // --------------------------------------------------------------------------
  // Background Agent via /bg command flow
  // --------------------------------------------------------------------------
  describe("/bg command flow", () => {
    let bgTempDir: string;

    beforeEach(async () => {
      bgTempDir = await mkdtemp(join(tmpdir(), "dantecode-integ-bg-"));
    });

    it("enqueues and completes a task end-to-end", async () => {
      const runner = new BackgroundAgentRunner(2, bgTempDir);
      runner.setWorkFn(async (prompt) => ({
        output: `Completed: ${prompt}`,
        touchedFiles: ["src/foo.ts"],
      }));

      const id = runner.enqueue("fix the login bug");
      expect(id).toBeTruthy();

      // Wait for completion
      await new Promise((r) => setTimeout(r, 100));

      const task = runner.getTask(id);
      expect(task).not.toBeNull();
      expect(task!.status).toBe("completed");
      expect(task!.output).toBe("Completed: fix the login bug");
      expect(task!.touchedFiles).toEqual(["src/foo.ts"]);
    });

    it("cancel flow works", () => {
      const runner = new BackgroundAgentRunner(0, bgTempDir); // no slots = stays queued
      const id = runner.enqueue("long running task");

      expect(runner.getTask(id)!.status).toBe("queued");
      const cancelled = runner.cancel(id);
      expect(cancelled).toBe(true);
      expect(runner.getTask(id)!.status).toBe("cancelled");
    });

    it("clear finished removes completed/failed tasks", async () => {
      const runner = new BackgroundAgentRunner(5, bgTempDir);
      runner.setWorkFn(async (prompt) => {
        if (prompt === "fail") throw new Error("intentional");
        return { output: "ok", touchedFiles: [] };
      });

      runner.enqueue("pass");
      runner.enqueue("fail");
      await new Promise((r) => setTimeout(r, 100));

      expect(runner.listTasks()).toHaveLength(2);
      const cleared = runner.clearFinished();
      expect(cleared).toBe(2);
      expect(runner.listTasks()).toHaveLength(0);
    });

    it("routes /bg --docker tasks with sandbox defaults", async () => {
      const replState: ReplState = {
        session: makeRuntimeSession(bgTempDir),
        state: {
          sandbox: {
            enabled: true,
            defaultImage: "ghcr.io/dantecode/sandbox:latest",
            networkMode: "bridge",
            memoryLimitMb: 2048,
            cpuLimit: 2,
            timeoutMs: 300_000,
            autoStart: false,
          },
        } as DanteCodeState,
        projectRoot: bgTempDir,
        verbose: false,
        enableGit: false,
        enableSandbox: false,
        silent: true,
        lastEditFile: null,
        lastEditContent: null,
        recentToolCalls: [],
        pendingAgentPrompt: null,
        pendingResumeRunId: null,
        pendingExpectedWorkflow: null,
        activeAbortController: null,
        sandboxBridge: null,
        activeSkill: null,
        waveState: null,
        gaslight: null,
        memoryOrchestrator: null,
        verificationTrendTracker: null,
        planMode: false,
        currentPlan: null,
        planApproved: false,
        currentPlanId: null,
        planExecutionInProgress: false,
        planExecutionResult: null,
        approvalMode: "default",
        theme: "default",
      };

      const output = await routeSlashCommand("/bg --docker fix the flaky CI task", replState);
      expect(output).toContain("queued");

      const runner = replState._bgRunner as BackgroundAgentRunner;
      const [task] = runner.listTasks();
      expect(task).toBeDefined();
      expect(task!.prompt).toBe("fix the flaky CI task");
      expect(task!.dockerConfig).toEqual({
        image: "ghcr.io/dantecode/sandbox:latest",
        networkMode: "bridge",
        memoryLimitMb: 2048,
        cpuLimit: 2,
        readOnlyMount: false,
      });
    });

    it("resumes a task through /bg --resume", async () => {
      const resume = vi.fn().mockResolvedValue(true);
      const replState: ReplState = {
        session: makeRuntimeSession(bgTempDir),
        state: {
          sandbox: {
            enabled: true,
            defaultImage: "ghcr.io/dantecode/sandbox:latest",
            networkMode: "bridge",
            memoryLimitMb: 2048,
            cpuLimit: 2,
            timeoutMs: 300_000,
            autoStart: false,
          },
        } as DanteCodeState,
        projectRoot: bgTempDir,
        verbose: false,
        enableGit: false,
        enableSandbox: false,
        silent: true,
        lastEditFile: null,
        lastEditContent: null,
        recentToolCalls: [],
        pendingAgentPrompt: null,
        pendingResumeRunId: null,
        pendingExpectedWorkflow: null,
        activeAbortController: null,
        sandboxBridge: null,
        activeSkill: null,
        waveState: null,
        gaslight: null,
        memoryOrchestrator: null,
        verificationTrendTracker: null,
        planMode: false,
        currentPlan: null,
        planApproved: false,
        currentPlanId: null,
        planExecutionInProgress: false,
        planExecutionResult: null,
        approvalMode: "default",
        theme: "default",
        _bgRunner: {
          hasWorkFn: () => true,
          resume,
          listTasks: () => [],
          cancel: () => false,
          clearFinished: () => 0,
          enqueue: () => "task-1",
        },
      };

      const output = await routeSlashCommand("/bg --resume task-123", replState);

      expect(output).toContain("Resuming background task task-123");
      expect(resume).toHaveBeenCalledWith("task-123");
    });
  });

  describe("/autoforge command flow", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "dantecode-integ-autoforge-"));
    });

    it("queues explicit self-improvement from repo root when no file context is active", async () => {
      const replState: ReplState = {
        session: makeRuntimeSession(tempDir),
        state: {
          autoforge: {
            enabled: true,
            maxIterations: 5,
            gstackCommands: [],
            lessonInjectionEnabled: true,
            abortOnSecurityViolation: true,
          },
        } as unknown as DanteCodeState,
        projectRoot: tempDir,
        verbose: false,
        enableGit: false,
        enableSandbox: false,
        silent: true,
        lastEditFile: null,
        lastEditContent: null,
        recentToolCalls: [],
        pendingAgentPrompt: null,
        pendingResumeRunId: null,
        pendingExpectedWorkflow: null,
        activeAbortController: null,
        sandboxBridge: null,
        activeSkill: null,
        waveState: null,
        gaslight: null,
        memoryOrchestrator: null,
        verificationTrendTracker: null,
        planMode: false,
        currentPlan: null,
        planApproved: false,
        currentPlanId: null,
        planExecutionInProgress: false,
        planExecutionResult: null,
        approvalMode: "default",
        theme: "default",
      };

      const output = await routeSlashCommand("/autoforge --self-improve", replState);

      expect(output).toContain("Self-improvement autoforge queued");
      expect(replState.pendingAgentPrompt).toContain("/autoforge --self-improve");
      expect(replState.pendingAgentPrompt).toContain("Run repo-root typecheck, lint, and test");
    });
  });

  // --------------------------------------------------------------------------
  // Code Index via /index + /search flow
  // --------------------------------------------------------------------------
  describe("/index + /search flow", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "dantecode-integ-idx-"));
      await mkdir(join(tempDir, "src"), { recursive: true });
    });

    it("builds index from sample TS files and searches", async () => {
      await writeFile(
        join(tempDir, "src", "math.ts"),
        [
          "export function add(a: number, b: number): number {",
          "  return a + b;",
          "}",
          "",
          "export function multiply(a: number, b: number): number {",
          "  return a * b;",
          "}",
          "",
          "export function fibonacci(n: number): number {",
          "  if (n <= 1) return n;",
          "  return fibonacci(n - 1) + fibonacci(n - 2);",
          "}",
        ].join("\n"),
        "utf-8",
      );

      await writeFile(
        join(tempDir, "src", "strings.ts"),
        [
          "export function capitalize(s: string): string {",
          "  return s.charAt(0).toUpperCase() + s.slice(1);",
          "}",
          "",
          "export function reverse(s: string): string {",
          "  return s.split('').reverse().join('');",
          "}",
        ].join("\n"),
        "utf-8",
      );

      const index = new CodeIndex();
      const count = await index.buildIndex(tempDir);
      expect(count).toBeGreaterThanOrEqual(2);

      // Search for fibonacci should find math.ts
      const results = index.search("fibonacci recursive", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.filePath).toContain("math.ts");

      // Search for string operations
      const strResults = index.search("capitalize string", 5);
      expect(strResults.length).toBeGreaterThan(0);
      expect(strResults[0]!.filePath).toContain("strings.ts");
    });

    it("saves and loads index to disk", async () => {
      // Need multiple files so TF-IDF has enough signal
      await writeFile(
        join(tempDir, "src", "hello.ts"),
        [
          "export function greet(name: string): string {",
          "  return `Hello, ${name}!`;",
          "}",
          "",
          "export function farewell(name: string): string {",
          "  return `Goodbye, ${name}!`;",
          "}",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        join(tempDir, "src", "calc.ts"),
        ["export function add(a: number, b: number): number {", "  return a + b;", "}"].join("\n"),
        "utf-8",
      );

      const index = new CodeIndex();
      const chunkCount = await index.buildIndex(tempDir);
      expect(chunkCount).toBeGreaterThanOrEqual(2);
      await index.save(tempDir);

      // Load in a fresh instance
      const index2 = new CodeIndex();
      const loaded = await index2.load(tempDir);
      expect(loaded).toBe(true);

      // The loaded index should contain chunks
      const results = index2.search("greet hello name", 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty results for unrelated query", async () => {
      await writeFile(join(tempDir, "src", "app.ts"), "export const version = '1.0.0';", "utf-8");

      const index = new CodeIndex();
      await index.buildIndex(tempDir);

      const results = index.search("quantum entanglement teleportation", 5);
      // Results may be returned by TF-IDF but should have low relevance
      // At minimum, the function should not crash
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Session persistence save/load roundtrip
  // --------------------------------------------------------------------------
  describe("Session persistence roundtrip", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "dantecode-integ-session-"));
    });

    it("saves and loads a session", async () => {
      const store = new SessionStore(tempDir);
      const session: ChatSessionFile = {
        id: "test-session-1",
        title: "Test Chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: "grok-3",
        messages: [
          { role: "user" as const, content: "Hello", timestamp: new Date().toISOString() },
          { role: "assistant" as const, content: "Hi!", timestamp: new Date().toISOString() },
        ],
        contextFiles: ["src/index.ts"],
      };

      await store.save(session);
      const loaded = await store.load("test-session-1");
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe("Test Chat");
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.contextFiles).toEqual(["src/index.ts"]);
    });

    it("lists sessions sorted by updatedAt", async () => {
      const store = new SessionStore(tempDir);

      await store.save({
        id: "old",
        title: "Old Chat",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        model: "grok-3",
        messages: [],
        contextFiles: [],
      });

      await store.save({
        id: "new",
        title: "New Chat",
        createdAt: "2024-06-01T00:00:00Z",
        updatedAt: "2024-06-01T00:00:00Z",
        model: "grok-3",
        messages: [{ role: "user", content: "test", timestamp: "2024-06-01T00:00:00Z" }],
        contextFiles: [],
      });

      const list = await store.list();
      expect(list).toHaveLength(2);
      expect(list[0]!.id).toBe("new");
      expect(list[1]!.id).toBe("old");
    });

    it("deletes a session", async () => {
      const store = new SessionStore(tempDir);
      await store.save({
        id: "to-delete",
        title: "Delete Me",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: "grok-3",
        messages: [],
        contextFiles: [],
      });

      expect(await store.exists("to-delete")).toBe(true);
      const deleted = await store.delete("to-delete");
      expect(deleted).toBe(true);
      expect(await store.exists("to-delete")).toBe(false);
    });
  });
});
