// Sprint AL — Dim 17: Browser session persistence
// Saves and loads browsing sessions so state persists across agent restarts
// and can be referenced in future sessions (url, steps, task context).
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface BrowserSessionStep {
  action: string;
  url?: string;
  timestamp: string;
  result?: string;
}

export interface BrowserSessionRecord {
  sessionId: string;
  taskDescription: string;
  startUrl: string;
  finalUrl?: string;
  startedAt: string;
  completedAt?: string;
  stepCount: number;
  steps: BrowserSessionStep[];
  status: "running" | "completed" | "failed";
  errorMessage?: string;
}

const SESSION_FILE = ".danteforge/browser-sessions.json";

/** Persist a browser session record (append JSONL). */
export function saveBrowserSession(
  record: Omit<BrowserSessionRecord, "sessionId"> & { sessionId?: string },
  projectRoot = process.cwd(),
): string {
  const root = resolve(projectRoot);
  const sessionId = record.sessionId ?? randomUUID();
  const full: BrowserSessionRecord = { ...record, sessionId };
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(join(root, SESSION_FILE), JSON.stringify(full) + "\n", "utf-8");
  } catch { /* non-fatal */ }
  return sessionId;
}

/** Load all stored browser session records. */
export function loadBrowserSessions(projectRoot = process.cwd()): BrowserSessionRecord[] {
  const root = resolve(projectRoot);
  const path = join(root, SESSION_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BrowserSessionRecord);
  } catch {
    return [];
  }
}

/** Get the most recent completed session for a given start URL, if any. */
export function getLastSessionForUrl(startUrl: string, projectRoot = process.cwd()): BrowserSessionRecord | null {
  const sessions = loadBrowserSessions(projectRoot);
  const matches = sessions.filter(
    (s) => s.startUrl === startUrl && s.status === "completed",
  );
  return matches[matches.length - 1] ?? null;
}

export interface BrowserSessionStoreSummary {
  totalSessions: number;
  completedSessions: number;
  failedSessions: number;
  avgStepCount: number;
  uniqueUrls: number;
}

// ─── Browser task outcome tracker (Sprint AW — Dim 17) ───────────────────────

export interface BrowserTaskOutcome {
  url: string;
  taskDescription: string;
  succeeded: boolean;
  stepsCompleted: number;
  totalSteps: number;
  timestamp: string;
}

const OUTCOME_FILE = ".danteforge/browser-task-outcomes.json";

/** Tracks browser task success rates across sessions. */
export class BrowserTaskOutcomeTracker {
  private readonly _root: string;
  private readonly _path: string;

  constructor(projectRoot: string) {
    this._root = resolve(projectRoot);
    this._path = join(this._root, OUTCOME_FILE);
  }

  recordTaskOutcome(
    url: string,
    taskDescription: string,
    succeeded: boolean,
    stepsCompleted: number,
    totalSteps: number,
  ): void {
    try {
      mkdirSync(join(this._root, ".danteforge"), { recursive: true });
      const entry: BrowserTaskOutcome = { url, taskDescription, succeeded, stepsCompleted, totalSteps, timestamp: new Date().toISOString() };
      appendFileSync(this._path, JSON.stringify(entry) + "\n", "utf-8");
    } catch { /* non-fatal */ }
  }

  load(): BrowserTaskOutcome[] {
    if (!existsSync(this._path)) return [];
    try {
      return readFileSync(this._path, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as BrowserTaskOutcome);
    } catch { return []; }
  }

  getSuccessRate(): number {
    const entries = this.load();
    if (entries.length === 0) return 0;
    return entries.filter((e) => e.succeeded).length / entries.length;
  }
}

// Sprint BP — Dim 17: Per-session summary + recent-sessions listing

export interface BrowserStoreSummaryRecord {
  sessionId: string;
  actionCount: number;
  successRate: number;       // successful steps / total steps (1 if no steps)
  distinctUrls: number;      // unique URLs visited across steps
  totalDurationMs: number;   // ms between startedAt and completedAt (0 if still running)
  lastAction: string;        // action string of the final step, or "" if no steps
  capturedAt: string;        // ISO timestamp when this summary was captured (= completedAt ?? startedAt)
}

/**
 * Derives a BrowserStoreSummaryRecord from a stored BrowserSessionRecord.
 * Returns null if the sessionId is not found in the provided list.
 */
export function getSessionSummary(
  sessionId: string,
  sessions: BrowserSessionRecord[],
): BrowserStoreSummaryRecord | null {
  const record = sessions.find((s) => s.sessionId === sessionId);
  if (!record) return null;
  return deriveSessionSummary(record);
}

/**
 * Returns up to `limit` most recent session summaries, sorted by capturedAt descending.
 */
export function getMostRecentSessions(
  sessions: BrowserSessionRecord[],
  limit: number,
): BrowserStoreSummaryRecord[] {
  return [...sessions]
    .sort((a, b) => {
      const ta = new Date(a.completedAt ?? a.startedAt).getTime();
      const tb = new Date(b.completedAt ?? b.startedAt).getTime();
      return tb - ta;
    })
    .slice(0, limit)
    .map(deriveSessionSummary);
}

function deriveSessionSummary(record: BrowserSessionRecord): BrowserStoreSummaryRecord {
  const steps = record.steps ?? [];
  const successfulSteps = steps.filter(
    (s) => s.result !== undefined && s.result !== "error" && s.result !== "failed",
  ).length;
  const successRate = steps.length > 0 ? successfulSteps / steps.length : 1;
  const distinctUrls = new Set(
    steps.map((s) => s.url).filter((u): u is string => Boolean(u)),
  ).size;
  const capturedAt = record.completedAt ?? record.startedAt;
  const totalDurationMs =
    record.completedAt
      ? Math.max(0, new Date(record.completedAt).getTime() - new Date(record.startedAt).getTime())
      : 0;
  const lastStep = steps.length > 0 ? steps[steps.length - 1] : undefined;
  const lastAction = lastStep ? lastStep.action : "";
  return {
    sessionId: record.sessionId,
    actionCount: steps.length,
    successRate,
    distinctUrls,
    totalDurationMs,
    lastAction,
    capturedAt,
  };
}

export function summarizeBrowserSessions(sessions: BrowserSessionRecord[]): BrowserSessionStoreSummary {
  if (sessions.length === 0) {
    return { totalSessions: 0, completedSessions: 0, failedSessions: 0, avgStepCount: 0, uniqueUrls: 0 };
  }
  const completed = sessions.filter((s) => s.status === "completed").length;
  const failed = sessions.filter((s) => s.status === "failed").length;
  const avgStepCount = sessions.reduce((s, r) => s + r.stepCount, 0) / sessions.length;
  const uniqueUrls = new Set(sessions.map((s) => s.startUrl)).size;
  return { totalSessions: sessions.length, completedSessions: completed, failedSessions: failed, avgStepCount, uniqueUrls };
}

// Sprint BQ — Dim 17: Browser outcome logger (richer outcome record + summary)

export interface BrowserOutcomeRecord {
  sessionId: string;
  taskDescription: string;
  urlsVisited: number;
  screenshotsTaken: number;
  actionsPerformed: number;
  succeeded: boolean;
  failureReason?: string;
  durationMs: number;
  timestamp: string;
}

export interface BrowserOutcomeSummary {
  totalSessions: number;
  successRate: number;
  avgActionsPerSession: number;
  avgDurationMs: number;
  topFailureReasons: string[];
}

const BROWSER_OUTCOME_FILE = ".danteforge/browser-outcome-log.json";

/** Append a BrowserOutcomeRecord to .danteforge/browser-outcome-log.json (JSONL). */
export function recordBrowserOutcome(
  outcome: BrowserOutcomeRecord,
  projectRoot = process.cwd(),
): void {
  try {
    const root = resolve(projectRoot);
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(
      join(root, BROWSER_OUTCOME_FILE),
      JSON.stringify(outcome) + "\n",
      "utf-8",
    );
  } catch { /* non-fatal */ }
}

/** Read and parse all BrowserOutcomeRecord entries from disk. */
export function loadBrowserOutcomes(projectRoot = process.cwd()): BrowserOutcomeRecord[] {
  const root = resolve(projectRoot);
  const path = join(root, BROWSER_OUTCOME_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as BrowserOutcomeRecord);
  } catch {
    return [];
  }
}

/** Compute aggregate summary over a set of BrowserOutcomeRecord entries. */
export function getBrowserOutcomeSummary(outcomes: BrowserOutcomeRecord[]): BrowserOutcomeSummary {
  if (outcomes.length === 0) {
    return { totalSessions: 0, successRate: 0, avgActionsPerSession: 0, avgDurationMs: 0, topFailureReasons: [] };
  }
  const total = outcomes.length;
  const succeeded = outcomes.filter((o) => o.succeeded).length;
  const successRate = succeeded / total;
  const avgActionsPerSession = outcomes.reduce((s, o) => s + o.actionsPerformed, 0) / total;
  const avgDurationMs = outcomes.reduce((s, o) => s + o.durationMs, 0) / total;

  // Count failure reasons from failed entries
  const reasonCounts = new Map<string, number>();
  for (const o of outcomes) {
    if (!o.succeeded && o.failureReason) {
      reasonCounts.set(o.failureReason, (reasonCounts.get(o.failureReason) ?? 0) + 1);
    }
  }
  const topFailureReasons = Array.from(reasonCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason]) => reason);

  return { totalSessions: total, successRate, avgActionsPerSession, avgDurationMs, topFailureReasons };
}
