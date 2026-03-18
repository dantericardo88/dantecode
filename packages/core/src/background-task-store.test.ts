import { beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BackgroundTaskStore } from "./background-task-store.js";
import type { BackgroundAgentTask } from "@dantecode/config-types";

describe("BackgroundTaskStore", () => {
  let projectRoot: string;
  let store: BackgroundTaskStore;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-bg-store-"));
    await mkdir(join(projectRoot, ".dantecode"), { recursive: true });
    store = new BackgroundTaskStore(projectRoot);
  });

  it("saves and loads persisted background tasks", async () => {
    const task: BackgroundAgentTask = {
      id: "task-1",
      prompt: "long running refactor",
      status: "paused",
      createdAt: new Date().toISOString(),
      progress: "Paused for cooldown",
      touchedFiles: ["src/app.ts"],
      attemptCount: 5,
      breakerState: "open",
      checkpoints: [
        {
          id: "cp-1",
          label: "task-start",
          createdAt: new Date().toISOString(),
          touchedFiles: [],
          progress: "started",
        },
      ],
    };

    await store.saveTask(task);
    const loaded = await store.loadTask("task-1");

    expect(loaded).not.toBeNull();
    expect(loaded?.breakerState).toBe("open");
    expect(loaded?.checkpoints).toHaveLength(1);
  });

  it("cleans up expired task files", async () => {
    const now = new Date();
    await store.saveTask({
      id: "fresh-task",
      prompt: "fresh",
      status: "queued",
      createdAt: now.toISOString(),
      progress: "queued",
      touchedFiles: [],
    });
    await store.saveTask({
      id: "expired-task",
      prompt: "expired",
      status: "completed",
      createdAt: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000).toISOString(),
      completedAt: new Date(now.getTime() - 9 * 24 * 60 * 60 * 1000).toISOString(),
      progress: "done",
      touchedFiles: [],
    });

    const removed = await store.cleanupExpired(7);
    const tasks = await store.listTasks();

    expect(removed).toBe(1);
    expect(tasks.map((task) => task.id)).toEqual(["fresh-task"]);
  });
});
