// ============================================================================
// @dantecode/core — Git Lifecycle Manager
// Tracks branch→commits→PR lifecycle stages and emits JSONL audit records.
// ============================================================================

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type GitLifecycleStage = "branch_created" | "commit" | "push" | "pr_opened" | "pr_reviewed" | "pr_merged" | "pr_closed";

export interface GitLifecycleEvent {
  timestamp: string;
  stage: GitLifecycleStage;
  branch: string;
  commitSha?: string;
  prNumber?: number;
  prTitle?: string;
  authorEmail?: string;
  filesChanged?: number;
  linesAdded?: number;
  linesRemoved?: number;
  durationFromBranchMs?: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface GitLifecycleSummary {
  branch: string;
  events: GitLifecycleEvent[];
  totalCommits: number;
  reachedPR: boolean;
  reachedMerge: boolean;
  durationMs: number | null;
}

const LOG_FILE = ".danteforge/git-lifecycle-log.json";

export function emitGitLifecycleEvent(event: Omit<GitLifecycleEvent, "timestamp">, projectRoot?: string): void {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, LOG_FILE);
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const entry: GitLifecycleEvent = { timestamp: new Date().toISOString(), ...event };
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
}

export class GitLifecycleManager {
  private readonly _projectRoot: string;
  private readonly _branch: string;
  private _events: GitLifecycleEvent[] = [];
  private _startTime: number | null = null;

  constructor(branch: string, projectRoot?: string) {
    this._branch = branch;
    this._projectRoot = projectRoot ?? resolve(process.cwd());
  }

  recordBranchCreated(authorEmail?: string): void {
    this._startTime = Date.now();
    this._emit({ stage: "branch_created", authorEmail });
  }

  recordCommit(commitSha: string, filesChanged: number, linesAdded: number, linesRemoved: number): void {
    this._emit({ stage: "commit", commitSha, filesChanged, linesAdded, linesRemoved });
  }

  recordPush(): void {
    this._emit({ stage: "push" });
  }

  recordPROpened(prNumber: number, prTitle: string): void {
    this._emit({ stage: "pr_opened", prNumber, prTitle });
  }

  recordPRReviewed(prNumber: number): void {
    this._emit({ stage: "pr_reviewed", prNumber });
  }

  recordPRMerged(prNumber: number): void {
    this._emit({ stage: "pr_merged", prNumber });
  }

  recordPRClosed(prNumber: number): void {
    this._emit({ stage: "pr_closed", prNumber });
  }

  summarize(): GitLifecycleSummary {
    const commits = this._events.filter((e) => e.stage === "commit").length;
    const reachedPR = this._events.some((e) => e.stage === "pr_opened");
    const reachedMerge = this._events.some((e) => e.stage === "pr_merged");
    const endTime = reachedMerge
      ? new Date(this._events.find((e) => e.stage === "pr_merged")!.timestamp).getTime()
      : null;
    const durationMs = this._startTime && endTime ? endTime - this._startTime : null;
    return {
      branch: this._branch,
      events: [...this._events],
      totalCommits: commits,
      reachedPR,
      reachedMerge,
      durationMs,
    };
  }

  private _emit(partial: Omit<GitLifecycleEvent, "timestamp" | "branch" | "durationFromBranchMs">): void {
    const durationFromBranchMs = this._startTime ? Date.now() - this._startTime : undefined;
    const event: GitLifecycleEvent = {
      timestamp: new Date().toISOString(),
      branch: this._branch,
      durationFromBranchMs,
      ...partial,
    };
    this._events.push(event);
    emitGitLifecycleEvent(event, this._projectRoot);
  }
}
