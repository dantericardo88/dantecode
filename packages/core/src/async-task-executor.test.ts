// ============================================================================
// @dantecode/core — Async Task Executor Tests
// ============================================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  AsyncTaskExecutor,
  createAsyncTaskExecutor,
  createTask,
  type Task as _Task,
  type TaskExecutor,
  type TaskResult as _TaskResult,
} from "./async-task-executor.js";

describe("AsyncTaskExecutor", () => {
  let executor: AsyncTaskExecutor;

  beforeEach(() => {
    executor = createAsyncTaskExecutor({ maxConcurrency: 2 });
  });

  describe("createTask", () => {
    it("creates a task with required fields", () => {
      const task = createTask("test-task", { foo: "bar" });

      expect(task.id).toBeTruthy();
      expect(task.name).toBe("test-task");
      expect(task.input).toEqual({ foo: "bar" });
    });

    it("accepts optional fields", () => {
      const task = createTask(
        "test-task",
        { foo: "bar" },
        {
          description: "Test description",
          priority: "high",
          timeout: 5000,
          retries: 3,
          tags: ["test", "unit"],
        },
      );

      expect(task.description).toBe("Test description");
      expect(task.priority).toBe("high");
      expect(task.timeout).toBe(5000);
      expect(task.retries).toBe(3);
      expect(task.tags).toEqual(["test", "unit"]);
    });

    it("accepts custom ID", () => {
      const task = createTask("test-task", {}, { id: "custom-id" });
      expect(task.id).toBe("custom-id");
    });
  });

  describe("startTask", () => {
    it("starts a task and returns a handle", async () => {
      const task = createTask("test-task", { value: 42 });
      const taskExecutor: TaskExecutor<typeof task.input, number> = async (t) => {
        return t.input.value * 2;
      };

      const handle = executor.startTask(task, taskExecutor);

      expect(handle.taskId).toBe(task.id);
      expect(handle.promise).toBeInstanceOf(Promise);
      expect(handle.cancel).toBeInstanceOf(Function);

      const result = await handle.promise;
      expect(result.success).toBe(true);
      expect(result.output).toBe(84);
    });

    it("emits task:started event", async () => {
      const task = createTask("test-task", {});
      const taskExecutor: TaskExecutor = async () => "done";

      const spy = vi.fn();
      executor.on("task:started", spy);

      executor.startTask(task, taskExecutor);

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(spy).toHaveBeenCalledWith(task.id, task);
    });

    it("emits task:completed event", async () => {
      const task = createTask("test-task", {});
      const taskExecutor: TaskExecutor = async () => "done";

      const spy = vi.fn();
      executor.on("task:completed", spy);

      const handle = executor.startTask(task, taskExecutor);
      await handle.promise;

      expect(spy).toHaveBeenCalledWith(task.id, expect.objectContaining({ success: true }));
    });

    it("handles task failure", async () => {
      const task = createTask("failing-task", {});
      const taskExecutor: TaskExecutor = async () => {
        throw new Error("Task failed");
      };

      const spy = vi.fn();
      executor.on("task:failed", spy);

      const handle = executor.startTask(task, taskExecutor);
      const result = await handle.promise;

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("Task failed");
      expect(spy).toHaveBeenCalled();
    });

    it("respects maxConcurrency", async () => {
      const task1 = createTask("task-1", {});
      const task2 = createTask("task-2", {});
      const task3 = createTask("task-3", {});

      let runningCount = 0;
      let maxRunning = 0;

      const taskExecutor: TaskExecutor = async () => {
        runningCount++;
        maxRunning = Math.max(maxRunning, runningCount);
        await new Promise((resolve) => setTimeout(resolve, 50));
        runningCount--;
        return "done";
      };

      const handles = [
        executor.startTask(task1, taskExecutor),
        executor.startTask(task2, taskExecutor),
        executor.startTask(task3, taskExecutor),
      ];

      await Promise.all(handles.map((h) => h.promise));

      // maxConcurrency is 2, so maxRunning should never exceed 2
      expect(maxRunning).toBeLessThanOrEqual(2);
    });

    it("processes queue in priority order", async () => {
      const executionOrder: string[] = [];

      // Create executor with concurrency=1 to force queueing
      const singleExecutor = createAsyncTaskExecutor({ maxConcurrency: 1 });

      const lowTask = createTask("low", {}, { priority: "low" });
      const highTask = createTask("high", {}, { priority: "high" });
      const normalTask = createTask("normal", {}, { priority: "normal" });
      const criticalTask = createTask("critical", {}, { priority: "critical" });

      const taskExecutor: TaskExecutor = async (task) => {
        executionOrder.push(task.name);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return "done";
      };

      // Start low first to ensure it runs immediately, then queue others
      const handle1 = singleExecutor.startTask(lowTask, taskExecutor);
      await new Promise((resolve) => setTimeout(resolve, 5)); // Small delay
      const handle2 = singleExecutor.startTask(normalTask, taskExecutor);
      const handle3 = singleExecutor.startTask(highTask, taskExecutor);
      const handle4 = singleExecutor.startTask(criticalTask, taskExecutor);

      await Promise.all([handle1.promise, handle2.promise, handle3.promise, handle4.promise]);

      // Critical should run before normal, high should run before normal
      const criticalIndex = executionOrder.indexOf("critical");
      const highIndex = executionOrder.indexOf("high");
      const normalIndex = executionOrder.indexOf("normal");
      const lowIndex = executionOrder.indexOf("low");

      // Low ran first (started immediately)
      expect(lowIndex).toBe(0);
      // Critical should come before all others in the queue
      expect(criticalIndex).toBeLessThan(normalIndex);
      // High should come before normal
      expect(highIndex).toBeLessThan(normalIndex);
    });
  });

  describe("cancelTask", () => {
    it("cancels a pending task", async () => {
      const task1 = createTask("task-1", {});
      const task2 = createTask("task-2", {});
      const task3 = createTask("task-3", {});

      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "done";
      };

      executor.startTask(task1, taskExecutor);
      executor.startTask(task2, taskExecutor);
      const handle3 = executor.startTask(task3, taskExecutor);

      // Cancel task3 before it starts
      await handle3.cancel();

      const status = await executor.getStatus(task3.id);
      expect(status?.status).toBe("cancelled");
    });

    it("cancels a running task", async () => {
      const task = createTask("task", {});

      const taskExecutor: TaskExecutor = async (_, signal) => {
        // Simulate long-running task that checks abort signal
        for (let i = 0; i < 10; i++) {
          if (signal.aborted) {
            throw new Error("Task was cancelled");
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return "done";
      };

      const handle = executor.startTask(task, taskExecutor);

      // Cancel after a short delay
      setTimeout(() => handle.cancel(), 100);

      const result = await handle.promise;
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("cancelled");
    });

    it("emits task:cancelled event", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "done";
      };

      const spy = vi.fn();
      executor.on("task:cancelled", spy);

      const handle = executor.startTask(task, taskExecutor);
      await handle.cancel();

      expect(spy).toHaveBeenCalledWith(task.id);
    });

    it("throws when cancelling non-existent task", async () => {
      await expect(executor.cancelTask("non-existent")).rejects.toThrow("not found");
    });

    it("does nothing when cancelling already completed task", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => "done";

      const handle = executor.startTask(task, taskExecutor);
      await handle.promise;

      // Should not throw
      await expect(handle.cancel()).resolves.toBeUndefined();
    });
  });

  describe("getStatus", () => {
    it("returns status for a task", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "done";
      };

      executor.startTask(task, taskExecutor);

      const status = await executor.getStatus(task.id);
      expect(status).toBeTruthy();
      expect(status?.taskId).toBe(task.id);
      expect(status?.status).toMatch(/pending|running/);
    });

    it("returns null for non-existent task", async () => {
      const status = await executor.getStatus("non-existent");
      expect(status).toBeNull();
    });
  });

  describe("waitForCompletion", () => {
    it("waits for task to complete", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "completed";
      };

      const _handle = executor.startTask(task, taskExecutor);
      const result = await executor.waitForCompletion(task.id);

      expect(result.success).toBe(true);
      expect(result.output).toBe("completed");
    });

    it("throws when waiting for non-existent task", async () => {
      await expect(executor.waitForCompletion("non-existent")).rejects.toThrow("not found");
    });
  });

  describe("onTaskComplete", () => {
    it("registers completion callback", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => "done";

      const callback = vi.fn();
      executor.onTaskComplete(callback);

      const handle = executor.startTask(task, taskExecutor);
      await handle.promise;

      expect(callback).toHaveBeenCalledWith(task.id, expect.objectContaining({ success: true }));
    });
  });

  describe("retry logic", () => {
    it("retries failed tasks", async () => {
      const task = createTask("task", {}, { retries: 2 });
      let attempts = 0;

      const taskExecutor: TaskExecutor = async () => {
        attempts++;
        if (attempts < 3) {
          throw new Error("Retry me");
        }
        return "success";
      };

      const retrySpy = vi.fn();
      executor.on("task:retry", retrySpy);

      const handle = executor.startTask(task, taskExecutor);
      const result = await handle.promise;

      expect(result.success).toBe(true);
      expect(result.output).toBe("success");
      expect(attempts).toBe(3);
      expect(retrySpy).toHaveBeenCalledTimes(2); // 2 retries
    });

    it("fails after max retries", async () => {
      const task = createTask("task", {}, { retries: 1 });
      let attempts = 0;

      const taskExecutor: TaskExecutor = async () => {
        attempts++;
        throw new Error("Always fail");
      };

      const handle = executor.startTask(task, taskExecutor);
      const result = await handle.promise;

      expect(result.success).toBe(false);
      expect(attempts).toBe(2); // Initial attempt + 1 retry
      expect(result.metrics.retriesUsed).toBe(1);
    });
  });

  describe("timeout", () => {
    it("times out long-running tasks", async () => {
      const task = createTask("task", {}, { timeout: 50 });

      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return "should not complete";
      };

      const handle = executor.startTask(task, taskExecutor);
      const result = await handle.promise;

      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("timed out");
    });

    it("completes fast tasks before timeout", async () => {
      const task = createTask("task", {}, { timeout: 200 });

      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "completed";
      };

      const handle = executor.startTask(task, taskExecutor);
      const result = await handle.promise;

      expect(result.success).toBe(true);
      expect(result.output).toBe("completed");
    });
  });

  describe("getActiveTasks", () => {
    it("returns list of active tasks", async () => {
      const task1 = createTask("task-1", {});
      const task2 = createTask("task-2", {});

      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "done";
      };

      executor.startTask(task1, taskExecutor);
      executor.startTask(task2, taskExecutor);

      const active = executor.getActiveTasks();
      expect(active.length).toBeGreaterThan(0);
      expect(active.some((t) => t.taskId === task1.id)).toBe(true);
    });

    it("excludes completed tasks", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => "done";

      const handle = executor.startTask(task, taskExecutor);
      await handle.promise;

      const active = executor.getActiveTasks();
      expect(active.some((t) => t.taskId === task.id)).toBe(false);
    });
  });

  describe("cleanup", () => {
    it("removes completed tasks from memory", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => "done";

      const handle = executor.startTask(task, taskExecutor);
      await handle.promise;

      executor.cleanup();

      const status = await executor.getStatus(task.id);
      expect(status).toBeNull();
    });

    it("keeps active tasks", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "done";
      };

      executor.startTask(task, taskExecutor);
      executor.cleanup();

      const status = await executor.getStatus(task.id);
      expect(status).toBeTruthy();
    });
  });

  describe("getStats", () => {
    it("returns executor statistics", async () => {
      const task1 = createTask("task-1", {});
      const task2 = createTask("task-2", {}, { retries: 0 });

      const taskExecutor1: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "done";
      };

      const taskExecutor2: TaskExecutor = async () => {
        throw new Error("fail");
      };

      executor.startTask(task1, taskExecutor1);
      const handle2 = executor.startTask(task2, taskExecutor2);
      await handle2.promise;

      const stats = executor.getStats();
      expect(stats.running).toBeGreaterThanOrEqual(0);
      expect(stats.failed).toBe(1);
    });
  });

  describe("queue:empty event", () => {
    it("emits when queue is empty", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => "done";

      const spy = vi.fn();
      executor.on("queue:empty", spy);

      const handle = executor.startTask(task, taskExecutor);
      await handle.promise;

      // Wait for event
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(spy).toHaveBeenCalled();
    });
  });

  describe("metrics", () => {
    it("tracks execution metrics", async () => {
      const task = createTask("task", {});
      const taskExecutor: TaskExecutor = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return "done";
      };

      const handle = executor.startTask(task, taskExecutor);
      const result = await handle.promise;

      expect(result.metrics.startedAt).toBeTruthy();
      expect(result.metrics.completedAt).toBeTruthy();
      expect(result.metrics.durationMs).toBeGreaterThan(0);
      expect(result.metrics.retriesUsed).toBe(0);
    });
  });
});
