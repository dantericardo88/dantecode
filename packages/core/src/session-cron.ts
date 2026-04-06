// ============================================================================
// Session Cron Scheduler — in-session periodic agent task trigger.
// Based on QwenCode's cron-create/delete/list tool pattern.
// ============================================================================

import { randomBytes } from "node:crypto";

export interface CronTask {
  id: string;
  /** Standard 5-field cron expression: min hour day month weekday */
  expression: string;
  /** Prompt to send to the agent when the task fires. */
  prompt: string;
  createdAt: string;
  /** ISO date after which the task will not fire. Defaults to 3 days from creation. */
  expiresAt?: string;
  lastRunAt?: string;
  runCount: number;
}

// ─── Cron Parser ─────────────────────────────────────────────────────────────

interface CronFields {
  minute: CronField;
  hour: CronField;
  dayOfMonth: CronField;
  month: CronField;
  dayOfWeek: CronField;
}

type CronField =
  | { type: "wildcard" }
  | { type: "every"; step: number }
  | { type: "value"; values: number[] };

function parseField(raw: string, min: number, max: number): CronField | null {
  if (raw === "*") {
    return { type: "wildcard" };
  }
  // */N — every N units
  const everyMatch = /^\*\/(\d+)$/.exec(raw);
  if (everyMatch) {
    const step = parseInt(everyMatch[1]!, 10);
    if (step < 1 || step > max - min) return null;
    return { type: "every", step };
  }
  // Comma-separated specific values (or single value)
  const parts = raw.split(",");
  const values: number[] = [];
  for (const part of parts) {
    // Ranges: 1-5
    const rangeMatch = /^(\d+)-(\d+)$/.exec(part.trim());
    if (rangeMatch) {
      const from = parseInt(rangeMatch[1]!, 10);
      const to = parseInt(rangeMatch[2]!, 10);
      if (from < min || to > max || from > to) return null;
      for (let v = from; v <= to; v++) values.push(v);
      continue;
    }
    const v = parseInt(part.trim(), 10);
    if (isNaN(v) || v < min || v > max) return null;
    values.push(v);
  }
  if (values.length === 0) return null;
  return { type: "value", values: [...new Set(values)].sort((a, b) => a - b) };
}

function parseCronExpression(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [rawMin, rawHour, rawDom, rawMon, rawDow] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  const minute = parseField(rawMin, 0, 59);
  const hour = parseField(rawHour, 0, 23);
  const dayOfMonth = parseField(rawDom, 1, 31);
  const month = parseField(rawMon, 1, 12);
  const dayOfWeek = parseField(rawDow, 0, 6);

  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

function fieldMatches(field: CronField, value: number): boolean {
  switch (field.type) {
    case "wildcard":
      return true;
    case "every":
      return value % field.step === 0;
    case "value":
      return field.values.includes(value);
  }
}

/** Returns the next Date on which the given cron fields fire, searching up to 8 days ahead. */
function nextFireDate(fields: CronFields, from: Date): Date | null {
  const candidate = new Date(from);
  // Round up to the next minute boundary
  candidate.setSeconds(0, 0);
  candidate.setTime(candidate.getTime() + 60_000);

  const limit = new Date(from.getTime() + 8 * 24 * 60 * 60 * 1000);

  while (candidate < limit) {
    const month = candidate.getMonth() + 1; // 1-12
    const dom = candidate.getDate(); // 1-31
    const dow = candidate.getDay(); // 0-6
    const hour = candidate.getHours(); // 0-23
    const minute = candidate.getMinutes(); // 0-59

    if (
      fieldMatches(fields.month, month) &&
      fieldMatches(fields.dayOfMonth, dom) &&
      fieldMatches(fields.dayOfWeek, dow) &&
      fieldMatches(fields.hour, hour) &&
      fieldMatches(fields.minute, minute)
    ) {
      return new Date(candidate);
    }

    // Advance by one minute
    candidate.setTime(candidate.getTime() + 60_000);
  }

  return null; // No match found within 8 days
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

const DEFAULT_EXPIRES_DAYS = 3;

export class SessionCronScheduler {
  private readonly tasks = new Map<string, CronTask>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly MAX_TASKS = 50;
  private onTrigger: ((taskId: string, prompt: string) => void) | null = null;
  private running = false;

  /**
   * Schedule a new cron task.
   * @returns The generated task ID.
   * @throws if the expression is invalid or the task limit is reached.
   */
  schedule(
    expression: string,
    prompt: string,
    options?: { expiresInDays?: number },
  ): string {
    if (!SessionCronScheduler.isValid(expression)) {
      throw new Error(
        `Invalid cron expression "${expression}". ` +
          `Use 5-field syntax, e.g. "*/5 * * * *" or "0 9 * * 1".`,
      );
    }
    if (this.tasks.size >= this.MAX_TASKS) {
      throw new Error(`Cron task limit (${this.MAX_TASKS}) reached. Delete some tasks first.`);
    }

    const id = `cron_${randomBytes(4).toString("hex")}`;
    const now = new Date();
    const expiresInDays = options?.expiresInDays ?? DEFAULT_EXPIRES_DAYS;
    const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    const task: CronTask = {
      id,
      expression,
      prompt,
      createdAt: now.toISOString(),
      expiresAt,
      runCount: 0,
    };

    this.tasks.set(id, task);

    if (this.running && this.onTrigger) {
      this.armTimer(task, this.onTrigger);
    }

    return id;
  }

  /**
   * Remove a scheduled task and cancel its timer.
   * @returns `true` if the task existed and was removed.
   */
  unschedule(taskId: string): boolean {
    const existed = this.tasks.has(taskId);
    this.tasks.delete(taskId);
    this.clearTimer(taskId);
    return existed;
  }

  /** List all active (non-expired) tasks. */
  list(): CronTask[] {
    const now = new Date();
    return [...this.tasks.values()].filter(
      (t) => !t.expiresAt || new Date(t.expiresAt) > now,
    );
  }

  /**
   * Start the scheduler. Registers timers for all current and future tasks.
   * @param onTrigger Callback invoked with `(taskId, prompt)` when a task fires.
   */
  start(onTrigger: (taskId: string, prompt: string) => void): void {
    if (this.running) return;
    this.running = true;
    this.onTrigger = onTrigger;

    for (const task of this.tasks.values()) {
      this.armTimer(task, onTrigger);
    }
  }

  /** Stop all timers and prevent further triggers. Does not clear tasks. */
  stop(): void {
    this.running = false;
    this.onTrigger = null;
    for (const taskId of this.timers.keys()) {
      this.clearTimer(taskId);
    }
  }

  /**
   * Parse a 5-field cron expression and return the next fire date from now.
   * Returns `null` if the expression is invalid or no match found within 8 days.
   */
  static parseExpression(expression: string): Date | null {
    const fields = parseCronExpression(expression);
    if (!fields) return null;
    return nextFireDate(fields, new Date());
  }

  /**
   * Check whether a cron expression is a valid 5-field expression.
   * `@shortcuts` (like `@hourly`) are not supported.
   */
  static isValid(expression: string): boolean {
    return parseCronExpression(expression) !== null;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private armTimer(task: CronTask, onTrigger: (taskId: string, prompt: string) => void): void {
    // Cancel any existing timer for this task
    this.clearTimer(task.id);

    const fields = parseCronExpression(task.expression);
    if (!fields) return; // Should not happen if schedule() validated it

    const fireDate = nextFireDate(fields, new Date());
    if (!fireDate) return; // No match within 8 days

    // Check expiry
    if (task.expiresAt && fireDate >= new Date(task.expiresAt)) {
      this.tasks.delete(task.id);
      return;
    }

    const delay = fireDate.getTime() - Date.now();
    if (delay < 0) return;

    const timer = setTimeout(() => {
      this.timers.delete(task.id);

      const current = this.tasks.get(task.id);
      if (!current) return; // Task was unscheduled

      // Check expiry at fire time
      if (current.expiresAt && new Date() >= new Date(current.expiresAt)) {
        this.tasks.delete(task.id);
        return;
      }

      // Update run metadata
      current.lastRunAt = new Date().toISOString();
      current.runCount += 1;
      this.tasks.set(task.id, current);

      // Fire callback
      try {
        onTrigger(task.id, current.prompt);
      } catch {
        // Swallow errors from the callback — caller is responsible
      }

      // Re-arm for the next occurrence if still running
      if (this.running && this.onTrigger) {
        this.armTimer(current, this.onTrigger);
      }
    }, delay);

    // Allow Node.js to exit even with active timers
    if (typeof timer === "object" && typeof (timer as NodeJS.Timeout).unref === "function") {
      (timer as NodeJS.Timeout).unref();
    }

    this.timers.set(task.id, timer);
  }

  private clearTimer(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }
}
