// ============================================================================
// @dantecode/core — Council Agent Adapter Base
// Common interface that every agent adapter must implement.
// Adapters are ranked by reliability: native-cli > api > file-bridge > gui.
// ============================================================================

import type { AgentKind, AdapterKind, CouncilTaskPacket } from "../council-types.js";

// ----------------------------------------------------------------------------
// Probe / capacity types
// ----------------------------------------------------------------------------

export interface AdapterAvailability {
  available: boolean;
  health: "ready" | "degraded" | "offline";
  reason?: string;
}

export interface AdapterCapacity {
  /** 0-100 estimate of remaining capacity before cap. */
  remainingCapacity: number;
  capSuspicion: "none" | "low" | "medium" | "high";
  estimatedCooldownMs?: number;
}

// ----------------------------------------------------------------------------
// Submission / status types
// ----------------------------------------------------------------------------

export interface AdapterSubmission {
  sessionId: string;
  accepted: boolean;
  reason?: string;
}

export type AdapterStatusKind =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "aborted"
  | "capped"
  | "stalled"
  | "unknown";

export interface AdapterStatus {
  sessionId: string;
  status: AdapterStatusKind;
  lastOutputAt?: string;
  progressSummary?: string;
}

export interface AdapterArtifacts {
  sessionId: string;
  files: Array<{ path: string; content: string }>;
  logs: string[];
}

export interface AdapterPatch {
  sessionId: string;
  /** Unified diff of all changes made by this lane. */
  unifiedDiff: string;
  /** Files that were actually modified. */
  changedFiles: string[];
  /** Source branch — used by MergeBrain for structural git merges. */
  sourceBranch?: string;
  commitHash?: string;
}

export interface RateLimitSignal {
  detected: boolean;
  confidence: "none" | "low" | "medium" | "high";
  reason?: string;
  retryAfterMs?: number;
}

// ----------------------------------------------------------------------------
// Adapter interface
// ----------------------------------------------------------------------------

/**
 * Every external agent environment must implement this interface.
 * Follows the adapter-first, protocol-over-GUI principle from the PRD.
 */
export interface CouncilAgentAdapter {
  readonly id: AgentKind;
  readonly displayName: string;
  readonly kind: AdapterKind;

  /** Check whether the agent environment is reachable and healthy. */
  probeAvailability(): Promise<AdapterAvailability>;

  /** Estimate remaining capacity before a usage cap is hit. */
  estimateCapacity(): Promise<AdapterCapacity>;

  /** Submit a task packet to the agent. */
  submitTask(packet: CouncilTaskPacket): Promise<AdapterSubmission>;

  /** Poll the status of an in-progress session. */
  pollStatus(sessionId: string): Promise<AdapterStatus>;

  /** Collect any output artifacts (files, logs). */
  collectArtifacts(sessionId: string): Promise<AdapterArtifacts>;

  /** Collect the unified patch produced by the session (may be null if none). */
  collectPatch(sessionId: string): Promise<AdapterPatch | null>;

  /** Detect if the current session is rate-limited or capped. */
  detectRateLimit(sessionId: string): Promise<RateLimitSignal>;

  /** Abort an in-progress task. */
  abortTask(sessionId: string): Promise<void>;

  /**
   * Optional: return token/cost usage for a session.
   * Not all adapters track this — callers must check for its presence.
   */
  getUsage?(sessionId: string): Promise<{ tokensIn: number; tokensOut: number; costUsd: number } | null>;
}

// ----------------------------------------------------------------------------
// Abstract base with shared helpers
// ----------------------------------------------------------------------------

/**
 * Convenience base class. Concrete adapters only need to override what differs.
 */
export abstract class BaseCouncilAdapter implements CouncilAgentAdapter {
  abstract readonly id: AgentKind;
  abstract readonly displayName: string;
  abstract readonly kind: AdapterKind;

  abstract probeAvailability(): Promise<AdapterAvailability>;
  abstract estimateCapacity(): Promise<AdapterCapacity>;
  abstract submitTask(packet: CouncilTaskPacket): Promise<AdapterSubmission>;
  abstract pollStatus(sessionId: string): Promise<AdapterStatus>;
  abstract collectArtifacts(sessionId: string): Promise<AdapterArtifacts>;
  abstract collectPatch(sessionId: string): Promise<AdapterPatch | null>;
  abstract detectRateLimit(sessionId: string): Promise<RateLimitSignal>;

  /** Abort an in-progress task. Default no-op — override in adapters that support cancellation. */
  async abortTask(_sessionId: string): Promise<void> {
    // No-op default
  }

  /** Build a standard task prompt from a packet. */
  protected buildTaskPrompt(packet: CouncilTaskPacket): string {
    const lines: string[] = [
      `# Council Task — Lane ${packet.laneId}`,
      ``,
      `## Objective`,
      packet.objective,
      ``,
      `## Your files (you may ONLY write these)`,
      packet.ownedFiles.map((f) => `- ${f}`).join("\n") || "- (none assigned)",
      ``,
      `## Read-only files`,
      packet.readOnlyFiles.map((f) => `- ${f}`).join("\n") || "- (none)",
      ``,
      `## FORBIDDEN files (do not touch)`,
      packet.forbiddenFiles.map((f) => `- ${f}`).join("\n") || "- (none)",
    ];

    if (packet.assumptions.length > 0) {
      lines.push(``, `## Assumptions`, packet.assumptions.map((a) => `- ${a}`).join("\n"));
    }

    if (packet.resumeFrom) {
      lines.push(
        ``,
        `## Resuming from handoff`,
        `Previous agent stopped because: ${packet.resumeFrom.blockerReason ?? "unknown"}`,
        `Touched files so far: ${packet.resumeFrom.touchedFiles.join(", ")}`,
        `Pending tests: ${packet.resumeFrom.pendingTests.join(", ")}`,
        `Open questions: ${packet.resumeFrom.openQuestions.join(", ")}`,
      );
    }

    return lines.join("\n");
  }

  /**
   * Run an async operation with a timeout.
   * Rejects with a descriptive error if the operation exceeds `ms` milliseconds.
   */
  protected withTimeout<T>(op: () => Promise<T>, ms: number, label = "operation"): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
      op().then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e: unknown) => { clearTimeout(timer); reject(e); },
      );
    });
  }
}
