import { randomUUID } from "node:crypto";

// ─── Canonical event types ───────────────────────────────────────────────────

export type GitAutomationEventType =
  | "fs-change"
  | "post-commit"
  | "pre-push"
  | "workflow-run"
  | "webhook"
  | "scheduled-task";

export type GitAutomationEventPriority = "low" | "normal" | "high";

/**
 * Canonical normalized event packet — produced by normalizeGitEvent() and
 * consumed by EventQueue, RateLimiter, and MultiRepoCoordinator.
 */
export interface GitAutomationEvent {
  id: string;
  repoRoot: string;
  worktreeId?: string;
  branch?: string;
  eventType: GitAutomationEventType;
  paths?: string[];
  payload?: Record<string, unknown>;
  priority: GitAutomationEventPriority;
  createdAt: string;
  /** Content-based fingerprint used for dedup */
  fingerprint: string;
}

/**
 * Raw signal from any source (fs watcher, git hook, webhook, scheduler).
 */
export interface RawGitEvent {
  type: GitAutomationEventType;
  repoRoot: string;
  worktreeId?: string;
  branch?: string;
  paths?: string[];
  payload?: Record<string, unknown>;
  /** Override computed priority */
  priority?: GitAutomationEventPriority;
}

// ─── Priority resolution ─────────────────────────────────────────────────────

const TYPE_PRIORITIES: Record<GitAutomationEventType, GitAutomationEventPriority> = {
  "pre-push": "high",
  "post-commit": "high",
  webhook: "high",
  "workflow-run": "normal",
  "scheduled-task": "low",
  "fs-change": "low",
};

function resolveEventPriority(raw: RawGitEvent): GitAutomationEventPriority {
  if (raw.priority) {
    return raw.priority;
  }
  return TYPE_PRIORITIES[raw.type];
}

// ─── Fingerprint ─────────────────────────────────────────────────────────────

/**
 * Deterministic content-based fingerprint for dedup / noise detection.
 * Two events with the same type + repoRoot + sorted-paths hash identically.
 */
export function computeEventFingerprint(raw: RawGitEvent): string {
  const sortedPaths = [...(raw.paths ?? [])].sort().join("|");
  const payloadKey =
    raw.payload !== undefined
      ? JSON.stringify(Object.keys(raw.payload).sort().reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = raw.payload![k];
          return acc;
        }, {}))
      : "";
  return `${raw.type}:${raw.repoRoot}:${raw.worktreeId ?? ""}:${sortedPaths}:${payloadKey}`;
}

// ─── Normalizer ──────────────────────────────────────────────────────────────

/**
 * Converts a raw git/webhook/fs/scheduler signal into a canonical
 * GitAutomationEvent with stable fingerprint, priority, and ISO timestamp.
 */
export function normalizeGitEvent(raw: RawGitEvent): GitAutomationEvent {
  return {
    id: randomUUID().slice(0, 12),
    repoRoot: raw.repoRoot.replace(/\\/g, "/"),
    ...(raw.worktreeId ? { worktreeId: raw.worktreeId } : {}),
    ...(raw.branch ? { branch: raw.branch } : {}),
    eventType: raw.type,
    ...(raw.paths && raw.paths.length > 0
      ? { paths: raw.paths.map((p) => p.replace(/\\/g, "/")) }
      : {}),
    ...(raw.payload !== undefined ? { payload: raw.payload } : {}),
    priority: resolveEventPriority(raw),
    createdAt: new Date().toISOString(),
    fingerprint: computeEventFingerprint(raw),
  };
}

// ─── Noise / dedup detection ─────────────────────────────────────────────────

export interface NoiseDetectionOptions {
  /** Window in ms within which identical fingerprints are considered duplicates */
  dedupeWindowMs?: number;
}

/**
 * Returns true when the candidate event is a duplicate of any recent event
 * within the dedup window (default 500 ms).
 */
export function isNoiseEvent(
  candidate: GitAutomationEvent,
  recentEvents: GitAutomationEvent[],
  options: NoiseDetectionOptions = {},
): boolean {
  const windowMs = options.dedupeWindowMs ?? 500;
  const candidateTime = new Date(candidate.createdAt).getTime();

  return recentEvents.some((recent) => {
    if (recent.fingerprint !== candidate.fingerprint) {
      return false;
    }
    const delta = Math.abs(candidateTime - new Date(recent.createdAt).getTime());
    return delta < windowMs;
  });
}

// ─── Event stream helpers ─────────────────────────────────────────────────────

/**
 * Sorts a list of GitAutomationEvents by priority (high → normal → low)
 * then by createdAt (oldest first within same priority).
 */
export function sortByPriority(events: GitAutomationEvent[]): GitAutomationEvent[] {
  const order: Record<GitAutomationEventPriority, number> = {
    high: 0,
    normal: 1,
    low: 2,
  };
  return [...events].sort((a, b) => {
    const priorityDiff = order[a.priority] - order[b.priority];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}
