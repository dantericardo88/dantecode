// ============================================================================
// @dantecode/core — Background Agent Runner Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackgroundAgentRunner } from "./background-agent.js";
import type { EnqueueOptions } from "./background-agent.js";
import type { BackgroundAgentTask } from "@dantecode/config-types";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void;

// ── child_process mock ────────────────────────────────────────────────────────
const mockExec = vi.fn();
vi.mock("node:child_process", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

const mockSandboxStart = vi.fn().mockResolvedValue("sandbox-123");
const mockSandboxStop = vi.fn().mockResolvedValue(undefined);
const mockSandboxRun = vi.fn().mockResolvedValue({
  exitCode: 0,
  stdout: "docker output",
  stderr: "",
  durationMs: 5,
  timedOut: false,
});

vi.mock("@dantecode/sandbox", () => ({
  SandboxManager: vi.fn().mockImplementation(() => ({
    start: mockSandboxStart,
    stop: mockSandboxStop,
  })),
  SandboxExecutor: vi.fn().mockImplementation(() => ({
    run: mockSandboxRun,
  })),
}));

describe("BackgroundAgentRunner", () => {
  let runner: BackgroundAgentRunner;
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-bg-runner-"));
    runner = new BackgroundAgentRunner(2, projectRoot);
    mockExec.mockClear();
    mockSandboxStart.mockClear();
    mockSandboxStop.mockClear();
    mockSandboxRun.mockClear();

    // Default: exec succeeds (for auto-commit / PR creation hooks)
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: ExecCallback) => {
      if (cb) cb(null, "", "");
      return { stdout: "", stderr: "" };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("enqueue", () => {
    it("returns a task ID", () => {
      const id = runner.enqueue("do something");
      expect(id).toBeTruthy();
      expect(typeof id).toBe("string");
    });

    it("creates a task with the correct prompt", async () => {
      // Without a work function, task will fail, but prompt should be set
      const id = runner.enqueue("test task");
      const task = runner.getTask(id);
      expect(task).not.toBeNull();
      expect(task!.prompt).toBe("test task");
      // It may be queued, running, or failed depending on timing
      expect(["queued", "running", "failed"]).toContain(task!.status);
    });

    it("starts task immediately if work function is set and slots available", async () => {
      const workFn = vi.fn().mockImplementation(async () => ({
        output: "done",
        touchedFiles: [],
      }));
      runner.setWorkFn(workFn);

      const id = runner.enqueue("start me");
      // Give the async task a tick to start
      await new Promise((r) => setTimeout(r, 10));
      const task = runner.getTask(id);
      expect(task!.status === "running" || task!.status === "completed").toBe(true);
    });

    it("stores docker config on tasks when requested", () => {
      const dockerConfig = {
        image: "ghcr.io/dantecode/sandbox:latest",
        networkMode: "bridge" as const,
        memoryLimitMb: 1024,
      };

      const id = runner.enqueue("containerized task", dockerConfig);
      const task = runner.getTask(id);

      expect(task).not.toBeNull();
      expect(task!.dockerConfig).toEqual(dockerConfig);
    });
  });

  describe("listTasks", () => {
    it("returns all enqueued tasks", () => {
      runner.enqueue("first");
      runner.enqueue("second");
      runner.enqueue("third");
      const tasks = runner.listTasks();
      expect(tasks).toHaveLength(3);
      const prompts = tasks.map((t) => t.prompt);
      expect(prompts).toContain("first");
      expect(prompts).toContain("second");
      expect(prompts).toContain("third");
    });

    it("returns empty array when no tasks", () => {
      expect(runner.listTasks()).toEqual([]);
    });
  });

  describe("getTask", () => {
    it("returns null for unknown ID", () => {
      expect(runner.getTask("nonexistent")).toBeNull();
    });
  });

  describe("cancel", () => {
    it("cancels a queued task", () => {
      // Create runner with 0 concurrent to keep tasks queued
      const limitedRunner = new BackgroundAgentRunner(0);
      const id = limitedRunner.enqueue("cancel me");
      const result = limitedRunner.cancel(id);
      expect(result).toBe(true);
      expect(limitedRunner.getTask(id)!.status).toBe("cancelled");
    });

    it("returns false for unknown task", () => {
      expect(runner.cancel("nonexistent")).toBe(false);
    });

    it("returns false for already completed task", async () => {
      runner.setWorkFn(async () => ({ output: "done", touchedFiles: [] }));
      const id = runner.enqueue("quick");
      await vi.waitFor(
        () => {
          expect(runner.getTask(id)?.status).toBe("completed");
        },
        { timeout: 5_000 },
      );
      expect(runner.cancel(id)).toBe(false);
    });
  });

  describe("getStatusCounts", () => {
    it("counts tasks by status", () => {
      const limitedRunner = new BackgroundAgentRunner(0);
      limitedRunner.enqueue("a");
      limitedRunner.enqueue("b");
      limitedRunner.enqueue("c");
      const counts = limitedRunner.getStatusCounts();
      expect(counts.queued).toBe(3);
      expect(counts.running).toBe(0);
    });
  });

  describe("clearFinished", () => {
    it("removes completed tasks", async () => {
      runner.setWorkFn(async () => ({ output: "done", touchedFiles: [] }));
      const firstId = runner.enqueue("a");
      const secondId = runner.enqueue("b");
      await vi.waitFor(
        () => {
          expect(runner.getTask(firstId)?.status).toBe("completed");
          expect(runner.getTask(secondId)?.status).toBe("completed");
        },
        { timeout: 5_000 },
      );
      const cleared = runner.clearFinished();
      expect(cleared).toBe(2);
      expect(runner.listTasks()).toHaveLength(0);
    });
  });

  describe("concurrency control", () => {
    it("respects max concurrent limit", async () => {
      const running: string[] = [];
      const completed: string[] = [];

      runner.setWorkFn(async (prompt, onProgress) => {
        running.push(prompt);
        onProgress(`Running: ${prompt}`);
        await new Promise((r) => setTimeout(r, 30));
        running.splice(running.indexOf(prompt), 1);
        completed.push(prompt);
        return { output: prompt, touchedFiles: [] };
      });

      runner.enqueue("task-1");
      runner.enqueue("task-2");
      runner.enqueue("task-3");

      // Let first two start
      await new Promise((r) => setTimeout(r, 10));
      expect(running.length).toBeLessThanOrEqual(2);

      // Wait for all to complete
      await vi.waitFor(
        () => {
          expect(completed).toHaveLength(3);
        },
        { timeout: 5_000 },
      );
      expect(completed).toHaveLength(3);
    });
  });

  describe("progress callback", () => {
    it("fires progress updates", async () => {
      const updates: BackgroundAgentTask[] = [];
      runner.setProgressCallback((task) => updates.push({ ...task }));
      runner.setWorkFn(async (_prompt, onProgress) => {
        onProgress("Step 1");
        onProgress("Step 2");
        return { output: "done", touchedFiles: ["file.ts"] };
      });

      runner.enqueue("tracked");
      await vi.waitFor(() => {
        expect(updates.length).toBeGreaterThanOrEqual(3);
        expect(updates[updates.length - 1]?.status).toBe("completed");
      });

      // Should have: queued, running, step 1, step 2, completed
      expect(updates.length).toBeGreaterThanOrEqual(3);
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe("completed");
      expect(lastUpdate.touchedFiles).toEqual(["file.ts"]);
    });

    it("provides a Docker execution helper when docker mode is enabled", async () => {
      runner.setWorkFn(async (_prompt, _onProgress, context) => {
        const result = await context.runInDocker?.("echo from container");

        return {
          output: result?.stdout ?? "no docker output",
          touchedFiles: [],
        };
      });

      const id = runner.enqueue("container task", {
        image: "ghcr.io/dantecode/sandbox:latest",
        networkMode: "bridge",
        memoryLimitMb: 1024,
        cpuLimit: 1,
      });

      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("completed");
      });
      await vi.waitFor(() => {
        expect(mockSandboxStop).toHaveBeenCalledTimes(1);
      });

      const task = runner.getTask(id);
      expect(task!.status).toBe("completed");
      expect(task!.output).toBe("docker output");
      expect(mockSandboxStart).toHaveBeenCalledTimes(1);
      expect(mockSandboxRun).toHaveBeenCalledWith("echo from container", undefined);
      expect(mockSandboxStop).toHaveBeenCalledTimes(1);
    });
  });

  describe("error handling", () => {
    it("marks task as failed when work function throws", async () => {
      runner.setWorkFn(async () => {
        throw new Error("something broke");
      });

      const id = runner.enqueue("will fail");
      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("failed");
      });

      const task = runner.getTask(id);
      expect(task!.status).toBe("failed");
      expect(task!.error).toBe("something broke");
    });

    it("marks task as failed when no work function is set", async () => {
      const id = runner.enqueue("no worker");
      await new Promise((r) => setTimeout(r, 50));

      const task = runner.getTask(id);
      expect(task!.status).toBe("failed");
      expect(task!.error).toContain("No work function");
    });

    it(
      "pauses a long-running task when repeated failures form a loop",
      async () => {
        const retryProjectRoot = await mkdtemp(join(tmpdir(), "dantecode-bg-retry-"));
        const retryRunner = new BackgroundAgentRunner(1, retryProjectRoot, {
          failureThreshold: 5,
          resetTimeoutMs: 10_000,
        });

        retryRunner.setWorkFn(async () => {
          throw new Error("boom");
        });

        const id = retryRunner.enqueue("recover me", { longRunning: true });

        await vi.waitFor(
          () => {
            expect(retryRunner.getTask(id)?.progress).toContain("Loop detected");
          },
          { timeout: 15_000 },
        );
        expect(retryRunner.getTask(id)?.status).toBe("paused");
        expect(retryRunner.getTask(id)?.progress).toContain("identical_consecutive");
      },
      { timeout: 20_000 },
    );
  });

  describe("enqueue with EnqueueOptions", () => {
    it("accepts EnqueueOptions with autoCommit and createPR flags", () => {
      const options: EnqueueOptions = {
        autoCommit: true,
        createPR: true,
      };
      const id = runner.enqueue("implement feature X", options);
      expect(id).toBeTruthy();
      const task = runner.getTask(id);
      expect(task).not.toBeNull();
      expect(task!.prompt).toBe("implement feature X");
    });

    it("stores docker config when passed via EnqueueOptions", () => {
      const options: EnqueueOptions = {
        autoCommit: false,
        docker: true,
        dockerConfig: {
          image: "ghcr.io/dantecode/sandbox:latest",
          networkMode: "bridge",
          memoryLimitMb: 2048,
        },
      };
      const id = runner.enqueue("docker task", options);
      const task = runner.getTask(id);
      expect(task!.dockerConfig).toEqual(options.dockerConfig);
    });

    it("still accepts legacy DockerAgentConfig for backward compatibility", () => {
      const dockerConfig = {
        image: "ghcr.io/dantecode/sandbox:latest",
        networkMode: "bridge" as const,
        memoryLimitMb: 1024,
      };
      const id = runner.enqueue("legacy docker call", dockerConfig);
      const task = runner.getTask(id);
      expect(task!.dockerConfig).toEqual(dockerConfig);
    });
  });

  describe("post-completion hook: auto-commit", () => {
    it("auto-commits touched files when autoCommit option is set", async () => {
      runner.setWorkFn(async () => ({
        output: "done",
        touchedFiles: ["src/foo.ts", "src/bar.ts"],
      }));

      const id = runner.enqueue("add foo and bar", { autoCommit: true });

      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("completed");
      });
      await vi.waitFor(() => {
        expect(
          mockExec.mock.calls.some(
            (c: unknown[]) =>
              typeof c[0] === "string" && c[0].includes("git add") && c[0].includes("git commit"),
          ),
        ).toBe(true);
      });

      // exec should have been called with git add + commit
      const calls = mockExec.mock.calls.map((c: unknown[]) => c[0] as string);
      const gitCall = calls.find((c) => c.includes("git add") && c.includes("git commit"));
      expect(gitCall).toBeTruthy();
      expect(gitCall).toContain("src/foo.ts");
      expect(gitCall).toContain("src/bar.ts");
    });

    it("does not auto-commit when autoCommit option is not set", async () => {
      runner.setWorkFn(async () => ({
        output: "done",
        touchedFiles: ["src/foo.ts"],
      }));

      const id = runner.enqueue("no commit task");

      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("completed");
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      const calls = mockExec.mock.calls.map((c: unknown[]) => c[0] as string);
      const gitCall = calls.find((c) => typeof c === "string" && c.includes("git commit"));
      expect(gitCall).toBeUndefined();
    });

    it("clears loop detection state on manual resume", async () => {
      const retryProjectRoot = await mkdtemp(join(tmpdir(), "dantecode-bg-resume-"));
      const retryRunner = new BackgroundAgentRunner(1, retryProjectRoot, {
        failureThreshold: 5,
        resetTimeoutMs: 200,
      });

      let attempts = 0;
      retryRunner.setWorkFn(async () => {
        attempts++;
        if (attempts <= 3) {
          throw new Error("boom");
        }
        return { output: "recovered", touchedFiles: [] };
      });

      const id = retryRunner.enqueue("resume me", { longRunning: true });

      await vi.waitFor(
        () => {
          expect(retryRunner.getTask(id)?.status).toBe("paused");
        },
        { timeout: 15_000 },
      );
      expect(retryRunner.getTask(id)?.progress).toContain("Loop detected");

      const resumed = await retryRunner.resume(id);
      expect(resumed).toBe(true);

      await vi.waitFor(
        () => {
          expect(retryRunner.getTask(id)?.status).toBe("completed");
        },
        { timeout: 15_000 },
      );
      expect(retryRunner.getTask(id)?.output).toBe("recovered");
    });

    it("does not auto-commit when there are no touched files", async () => {
      runner.setWorkFn(async () => ({
        output: "done",
        touchedFiles: [],
      }));

      const id = runner.enqueue("empty result", { autoCommit: true });

      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("completed");
      });

      const calls = mockExec.mock.calls.map((c: unknown[]) => c[0] as string);
      const gitCall = calls.find((c) => typeof c === "string" && c.includes("git commit"));
      expect(gitCall).toBeUndefined();
    });

    it("commit failure does not fail the task", async () => {
      // Make exec fail for git commands
      mockExec.mockImplementation((cmd: string, _opts: unknown, cb?: ExecCallback) => {
        if (typeof cmd === "string" && cmd.includes("git")) {
          if (cb) cb(new Error("git commit failed"), "", "");
          return;
        }
        if (cb) cb(null, "", "");
      });

      runner.setWorkFn(async () => ({
        output: "done",
        touchedFiles: ["src/foo.ts"],
      }));

      const id = runner.enqueue("commit will fail", { autoCommit: true });

      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("completed");
      });

      // Task should still be completed despite commit failure
      const task = runner.getTask(id);
      expect(task!.status).toBe("completed");
      expect(task!.output).toBe("done");
    });
  });

  describe("post-completion hook: PR creation", () => {
    it("creates a PR when createPR option is set", async () => {
      runner.setWorkFn(async () => ({
        output: "done",
        touchedFiles: ["src/feature.ts"],
      }));

      const id = runner.enqueue("add shiny feature", { autoCommit: true, createPR: true });

      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("completed");
      });

      await vi.waitFor(() => {
        expect(
          mockExec.mock.calls.some(
            (c: unknown[]) => typeof c[0] === "string" && c[0].includes("gh pr create"),
          ),
        ).toBe(true);
      });

      const calls = mockExec.mock.calls.map((c: unknown[]) => c[0] as string);
      const prCall = calls.find((c) => typeof c === "string" && c.includes("gh pr create"));
      expect(prCall).toBeTruthy();
      expect(prCall).toContain("add shiny feature");
    });

    it("PR failure does not fail the task", async () => {
      mockExec.mockImplementation((cmd: string, _opts: unknown, cb?: ExecCallback) => {
        if (typeof cmd === "string" && cmd.includes("gh pr create")) {
          if (cb) cb(new Error("gh: not authenticated"), "", "");
          return;
        }
        if (cb) cb(null, "", "");
      });

      runner.setWorkFn(async () => ({
        output: "done",
        touchedFiles: ["src/feature.ts"],
      }));

      const id = runner.enqueue("pr will fail", { autoCommit: true, createPR: true });

      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("completed");
      });
      await vi.waitFor(() => {
        expect(runner.getTask(id)?.progress).toContain("PR creation failed");
      });

      const task = runner.getTask(id);
      expect(task!.status).toBe("completed");
      // Progress should indicate PR creation failed
      expect(task!.progress).toContain("PR creation failed");
    });

    it("does not create a PR when createPR is not set", async () => {
      runner.setWorkFn(async () => ({
        output: "done",
        touchedFiles: ["src/foo.ts"],
      }));

      const id = runner.enqueue("just commit", { autoCommit: true });

      await vi.waitFor(() => {
        expect(runner.getTask(id)?.status).toBe("completed");
      });

      const calls = mockExec.mock.calls.map((c: unknown[]) => c[0] as string);
      const prCall = calls.find((c) => typeof c === "string" && c.includes("gh pr create"));
      expect(prCall).toBeUndefined();
    });
  });
});
