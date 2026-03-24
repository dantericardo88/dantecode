import { randomUUID } from "node:crypto";
import * as path from "node:path";
import {
  GitAutomationStore,
  keepLatest,
  type StoredScheduledTaskRecord,
  type StoredScheduledTaskRun,
} from "./automation-store.js";

export interface ScheduledTaskContext {
  id: string;
  taskName: string;
  runCount: number;
  schedule: string;
}

export interface ScheduledTaskOptions {
  cwd?: string;
  runOnStart?: boolean;
  persist?: boolean;
  taskId?: string;
  maxHistory?: number;
  pollIntervalMs?: number;
}

export interface ScheduledTaskSnapshot extends StoredScheduledTaskRecord {
  runtimeState: "active" | "stopped";
}

export interface ScheduledTask {
  id: string;
  schedule: string;
  stop: () => Promise<void>;
  triggerNow: () => Promise<void>;
  snapshot: () => ScheduledTaskSnapshot;
  flush: () => Promise<void>;
}

const ACTIVE_SCHEDULED_TASKS = new Map<string, ScheduledGitTaskRunner>();

class ScheduledGitTaskRunner {
  private readonly id: string;
  private readonly cwd: string;
  private readonly runOnStart: boolean;
  private readonly persist: boolean;
  private readonly maxHistory: number;
  private readonly pollIntervalMs: number;
  private readonly store: GitAutomationStore;
  private readonly startedAt: string;
  private readonly schedule: string;
  private readonly taskName: string;
  private timer?: NodeJS.Timeout;
  private lastCronBucket?: string;
  private runCount = 0;
  private status: StoredScheduledTaskRecord["status"] = "active";
  private stoppedAt?: string;
  private lastRunAt?: string;
  private nextRunAt?: string;
  private error?: string;
  private recentRuns: StoredScheduledTaskRun[] = [];
  private isRunning = false;
  private pendingPersistence: Promise<void> = Promise.resolve();

  constructor(
    schedule: string | number,
    taskName: string,
    private readonly taskFn: (context: ScheduledTaskContext) => Promise<void> | void,
    options: ScheduledTaskOptions = {},
  ) {
    this.id = options.taskId ?? randomUUID().slice(0, 12);
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.runOnStart = options.runOnStart ?? true;
    this.persist = options.persist ?? true;
    this.maxHistory = options.maxHistory ?? 20;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.store = new GitAutomationStore(this.cwd);
    this.startedAt = new Date().toISOString();
    this.schedule = typeof schedule === "number" ? `interval:${schedule}` : schedule.trim();
    this.taskName = taskName;
    this.nextRunAt = computeNextRunAt(this.schedule, new Date())?.toISOString();
  }

  start(): ScheduledTask {
    ACTIVE_SCHEDULED_TASKS.set(this.id, this);
    void this.persistSnapshot();

    if (this.runOnStart) {
      void this.triggerNow();
    } else if (!this.schedule.startsWith("interval:")) {
      this.lastCronBucket = cronBucket(new Date());
    }

    if (this.schedule.startsWith("interval:")) {
      const intervalMs = parseIntervalMs(this.schedule);
      this.timer = setInterval(async () => {
        await this.triggerNow();
      }, intervalMs);
    } else {
      this.timer = setInterval(async () => {
        const now = new Date();
        const bucket = cronBucket(now);
        if (this.lastCronBucket === bucket) {
          return;
        }
        if (matchesCron(this.schedule, now)) {
          this.lastCronBucket = bucket;
          await this.triggerNow();
        }
      }, this.pollIntervalMs);
    }

    return {
      id: this.id,
      schedule: this.schedule,
      stop: () => this.stop(),
      triggerNow: () => this.triggerNow(),
      snapshot: () => this.snapshot(),
      flush: () => this.pendingPersistence,
    };
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    ACTIVE_SCHEDULED_TASKS.delete(this.id);
    this.status = this.status === "error" ? "error" : "stopped";
    this.stoppedAt = new Date().toISOString();
    await this.persistSnapshot();
  }

  snapshot(): ScheduledTaskSnapshot {
    return {
      id: this.id,
      taskName: this.taskName,
      schedule: this.schedule,
      cwd: this.cwd,
      status: this.status,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      ...(this.stoppedAt ? { stoppedAt: this.stoppedAt } : {}),
      ...(this.lastRunAt ? { lastRunAt: this.lastRunAt } : {}),
      ...(this.nextRunAt ? { nextRunAt: this.nextRunAt } : {}),
      runCount: this.runCount,
      recentRuns: [...this.recentRuns],
      ...(this.error ? { error: this.error } : {}),
      runtimeState: this.timer ? "active" : "stopped",
    };
  }

  async triggerNow(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    const runId = randomUUID().slice(0, 12);
    const startedAt = new Date().toISOString();

    try {
      await this.taskFn({
        id: this.id,
        taskName: this.taskName,
        runCount: this.runCount + 1,
        schedule: this.schedule,
      });

      this.runCount += 1;
      this.lastRunAt = startedAt;
      this.nextRunAt = computeNextRunAt(this.schedule, new Date())?.toISOString();
      this.status = "active";
      this.recentRuns = keepLatest(
        [
          ...this.recentRuns,
          {
            id: runId,
            startedAt,
            completedAt: new Date().toISOString(),
            success: true,
          },
        ],
        this.maxHistory,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = "error";
      this.error = message;
      this.lastRunAt = startedAt;
      this.nextRunAt = computeNextRunAt(this.schedule, new Date())?.toISOString();
      this.recentRuns = keepLatest(
        [
          ...this.recentRuns,
          {
            id: runId,
            startedAt,
            completedAt: new Date().toISOString(),
            success: false,
            error: message,
          },
        ],
        this.maxHistory,
      );
    } finally {
      this.isRunning = false;
      await this.persistSnapshot();
    }
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.persist) {
      return;
    }

    this.pendingPersistence = this.pendingPersistence.then(() =>
      this.store.upsertScheduledTask({
        id: this.id,
        taskName: this.taskName,
        schedule: this.schedule,
        cwd: this.cwd,
        status: this.status,
        startedAt: this.startedAt,
        updatedAt: new Date().toISOString(),
        ...(this.stoppedAt ? { stoppedAt: this.stoppedAt } : {}),
        ...(this.lastRunAt ? { lastRunAt: this.lastRunAt } : {}),
        ...(this.nextRunAt ? { nextRunAt: this.nextRunAt } : {}),
        runCount: this.runCount,
        recentRuns: [...this.recentRuns],
        ...(this.error ? { error: this.error } : {}),
      }),
    );
    await this.pendingPersistence;
  }
}

export function scheduleGitTask(
  cron: string | number,
  taskFn: (context: ScheduledTaskContext) => Promise<void> | void,
  options: ScheduledTaskOptions & { taskName?: string } = {},
): ScheduledTask {
  const taskName = options.taskName ?? "Scheduled git task";
  const runner = new ScheduledGitTaskRunner(cron, taskName, taskFn, options);
  return runner.start();
}

export async function listScheduledGitTasks(
  projectRoot = process.cwd(),
): Promise<StoredScheduledTaskRecord[]> {
  const store = new GitAutomationStore(path.resolve(projectRoot));
  return store.listScheduledTasks();
}

export async function stopScheduledGitTask(
  taskId: string,
  projectRoot = process.cwd(),
): Promise<boolean> {
  const active = ACTIVE_SCHEDULED_TASKS.get(taskId);
  if (active) {
    await active.stop();
    return true;
  }

  const store = new GitAutomationStore(path.resolve(projectRoot));
  const tasks = await store.listScheduledTasks();
  const existing = tasks.find((task) => task.id === taskId);
  if (!existing) {
    return false;
  }

  await store.upsertScheduledTask({
    ...existing,
    status: existing.status === "error" ? "error" : "stopped",
    updatedAt: new Date().toISOString(),
    stoppedAt: new Date().toISOString(),
  });
  return true;
}

function parseIntervalMs(schedule: string): number {
  const raw = schedule.replace("interval:", "");
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid interval schedule: ${schedule}`);
  }
  return parsed;
}

function computeNextRunAt(schedule: string, now: Date): Date | null {
  if (schedule.startsWith("interval:")) {
    return new Date(now.getTime() + parseIntervalMs(schedule));
  }

  const cursor = new Date(now.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);

  for (let index = 0; index < 525_600; index++) {
    if (matchesCron(schedule, cursor)) {
      return new Date(cursor.getTime());
    }
    cursor.setMinutes(cursor.getMinutes() + 1);
  }

  return null;
}

function cronBucket(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

function matchesCron(expression: string, now: Date): boolean {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must contain 5 fields: ${expression}`);
  }

  const values = [
    now.getMinutes(),
    now.getHours(),
    now.getDate(),
    now.getMonth() + 1,
    now.getDay(),
  ];

  return parts.every((field, index) => matchesCronField(field, values[index]!));
}

function matchesCronField(field: string, value: number): boolean {
  if (field === "*") {
    return true;
  }

  if (field.startsWith("*/")) {
    const step = Number(field.slice(2));
    return Number.isFinite(step) && step > 0 ? value % step === 0 : false;
  }

  if (field.includes(",")) {
    return field
      .split(",")
      .map((entry) => entry.trim())
      .some((entry) => matchesCronField(entry, value));
  }

  if (field.includes("-")) {
    const [startRaw, endRaw] = field.split("-");
    const start = Number(startRaw);
    const end = Number(endRaw);
    return Number.isFinite(start) && Number.isFinite(end) ? value >= start && value <= end : false;
  }

  const exact = Number(field);
  return Number.isFinite(exact) ? value === exact : false;
}
