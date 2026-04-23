// ============================================================================
// @dantecode/core — Approval Thread Tracker (Sprint AF — dim 13)
// Tracks unresolved review threads per PR, enabling Dante to follow through
// on approval comments rather than silently forgetting them.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface ApprovalThread {
  threadId: string;
  filePath?: string;
  line?: number;
  comment: string;
  author?: string;
  resolved: boolean;
  resolvedAt?: string;
  createdAt: string;
}

export interface ApprovalThreadRecord {
  timestamp: string;
  reviewId: string;
  prTitle?: string;
  totalThreads: number;
  resolvedCount: number;
  unresolvedCount: number;
  pendingThreads: ApprovalThread[];
  resolutionRate: number;
}

const THREADS_FILE = ".danteforge/approval-threads.json";

export class ApprovalThreadTracker {
  private _threads: Map<string, ApprovalThread> = new Map();
  private readonly _reviewId: string;
  private readonly _projectRoot: string;

  constructor(reviewId: string, projectRoot?: string) {
    this._reviewId = reviewId;
    this._projectRoot = projectRoot ?? resolve(process.cwd());
  }

  addThread(thread: Omit<ApprovalThread, "threadId" | "createdAt" | "resolved">): string {
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._threads.set(threadId, {
      threadId,
      resolved: false,
      createdAt: new Date().toISOString(),
      ...thread,
    });
    return threadId;
  }

  resolveThread(threadId: string): boolean {
    const thread = this._threads.get(threadId);
    if (!thread) return false;
    thread.resolved = true;
    thread.resolvedAt = new Date().toISOString();
    return true;
  }

  getPendingThreads(): ApprovalThread[] {
    return [...this._threads.values()].filter((t) => !t.resolved);
  }

  getResolutionRate(): number {
    const total = this._threads.size;
    if (total === 0) return 1;
    const resolved = [...this._threads.values()].filter((t) => t.resolved).length;
    return resolved / total;
  }

  persist(prTitle?: string): ApprovalThreadRecord {
    const pending = this.getPendingThreads();
    const resolved = this._threads.size - pending.length;
    const record: ApprovalThreadRecord = {
      timestamp: new Date().toISOString(),
      reviewId: this._reviewId,
      prTitle,
      totalThreads: this._threads.size,
      resolvedCount: resolved,
      unresolvedCount: pending.length,
      pendingThreads: pending,
      resolutionRate: this.getResolutionRate(),
    };

    try {
      mkdirSync(join(this._projectRoot, ".danteforge"), { recursive: true });
      appendFileSync(
        join(this._projectRoot, THREADS_FILE),
        JSON.stringify(record) + "\n",
        "utf-8",
      );
    } catch {
      // non-fatal
    }

    return record;
  }
}

export function loadApprovalThreads(projectRoot?: string): ApprovalThreadRecord[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, THREADS_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ApprovalThreadRecord);
  } catch {
    return [];
  }
}
