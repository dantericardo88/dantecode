import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import {
  listScheduledGitTasks,
  scheduleGitTask,
} from "./scheduled-tasks.js";

describe("scheduleGitTask", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    vi.useRealTimers();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("runs interval schedules and persists run metadata", async () => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-schedule-"));
    let runs = 0;

    const task = scheduleGitTask(
      1000,
      () => {
        runs += 1;
      },
      { cwd: tmpDir, taskName: "Interval task", runOnStart: false },
    );

    await vi.advanceTimersByTimeAsync(2100);
    await task.stop();

    expect(runs).toBe(2);

    const records = await listScheduledGitTasks(tmpDir);
    expect(records).toHaveLength(1);
    expect(records[0]?.runCount).toBe(2);
    expect(records[0]?.taskName).toBe("Interval task");
  });

  it("runs cron schedules once per matching minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-20T12:00:00.000Z"));
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-cron-"));
    let runs = 0;

    const task = scheduleGitTask(
      "* * * * *",
      () => {
        runs += 1;
      },
      { cwd: tmpDir, taskName: "Cron task", runOnStart: false, pollIntervalMs: 1000 },
    );

    await vi.advanceTimersByTimeAsync(61_000);
    await task.stop();

    expect(runs).toBe(1);
  });
});
