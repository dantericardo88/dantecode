// ============================================================================
// @dantecode/core — Background Agent Runner Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BackgroundAgentRunner } from "./background-agent.js";
import type { BackgroundAgentTask } from "@dantecode/config-types";

describe("BackgroundAgentRunner", () => {
  let runner: BackgroundAgentRunner;

  beforeEach(() => {
    runner = new BackgroundAgentRunner(2);
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
      await new Promise((r) => setTimeout(r, 50));
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
      runner.enqueue("a");
      runner.enqueue("b");
      await new Promise((r) => setTimeout(r, 50));
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
      await new Promise((r) => setTimeout(r, 100));
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
      await new Promise((r) => setTimeout(r, 50));

      // Should have: queued, running, step 1, step 2, completed
      expect(updates.length).toBeGreaterThanOrEqual(3);
      const lastUpdate = updates[updates.length - 1]!;
      expect(lastUpdate.status).toBe("completed");
      expect(lastUpdate.touchedFiles).toEqual(["file.ts"]);
    });
  });

  describe("error handling", () => {
    it("marks task as failed when work function throws", async () => {
      runner.setWorkFn(async () => {
        throw new Error("something broke");
      });

      const id = runner.enqueue("will fail");
      await new Promise((r) => setTimeout(r, 50));

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
  });
});
