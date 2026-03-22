// ============================================================================
// @dantecode/debug-trail — Session Map
// Tracks active and historical sessions with metadata.
// ============================================================================

import { randomUUID } from "node:crypto";

export interface SessionInfo {
  sessionId: string;
  runId: string;
  startedAt: string;
  endedAt?: string;
  worktreePath?: string;
  branch?: string;
  eventCount: number;
  fileModCount: number;
  fileDeleteCount: number;
  pinned: boolean;
  tags: string[];
}

export class SessionMap {
  private sessions = new Map<string, SessionInfo>();
  private currentSessionId: string | null = null;

  /** Start or resume a session. */
  startSession(options?: {
    sessionId?: string;
    runId?: string;
    worktreePath?: string;
    branch?: string;
  }): SessionInfo {
    const sessionId = options?.sessionId ?? `sess_${randomUUID()}`;
    const runId = options?.runId ?? `run_${randomUUID()}`;
    const now = new Date().toISOString();

    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.currentSessionId = sessionId;
      return existing;
    }

    const info: SessionInfo = {
      sessionId,
      runId,
      startedAt: now,
      worktreePath: options?.worktreePath,
      branch: options?.branch,
      eventCount: 0,
      fileModCount: 0,
      fileDeleteCount: 0,
      pinned: false,
      tags: [],
    };
    this.sessions.set(sessionId, info);
    this.currentSessionId = sessionId;
    return info;
  }

  /** End the current session. */
  endSession(sessionId?: string): void {
    const sid = sessionId ?? this.currentSessionId;
    if (!sid) return;
    const info = this.sessions.get(sid);
    if (info) {
      info.endedAt = new Date().toISOString();
    }
    if (this.currentSessionId === sid) {
      this.currentSessionId = null;
    }
  }

  /** Get current session info. */
  current(): SessionInfo | null {
    if (!this.currentSessionId) return null;
    return this.sessions.get(this.currentSessionId) ?? null;
  }

  /** Get a session by ID. */
  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  /** All sessions as array (newest first). */
  all(): SessionInfo[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    );
  }

  /** Increment event count for a session. */
  recordEvent(sessionId: string, kind: "file_write" | "file_delete" | "other"): void {
    const info = this.sessions.get(sessionId);
    if (!info) return;
    info.eventCount++;
    if (kind === "file_write") info.fileModCount++;
    if (kind === "file_delete") info.fileDeleteCount++;
  }

  /** Pin a session. */
  pin(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (info) info.pinned = true;
  }

  /** Unpin a session. */
  unpin(sessionId: string): void {
    const info = this.sessions.get(sessionId);
    if (info) info.pinned = false;
  }

  /** Tag a session. */
  tag(sessionId: string, tag: string): void {
    const info = this.sessions.get(sessionId);
    if (info && !info.tags.includes(tag)) {
      info.tags.push(tag);
    }
  }

  /** Restore session map from serialized data. */
  loadFrom(data: Record<string, SessionInfo>): void {
    for (const [id, info] of Object.entries(data)) {
      this.sessions.set(id, info);
    }
  }

  /** Serialize for persistence. */
  toJSON(): Record<string, SessionInfo> {
    return Object.fromEntries(this.sessions);
  }
}
