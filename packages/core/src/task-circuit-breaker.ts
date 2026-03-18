// ============================================================================
// @dantecode/core — Task-Level Circuit Breaker
// Tracks identical verification failures within a long-running task and
// triggers pause + re-read recovery after a configurable threshold.
// Unlike the provider-level CircuitBreaker, this tracks error signatures
// to detect repeated identical failures.
// ============================================================================

import { createHash } from "node:crypto";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** State of the task circuit breaker. */
export type TaskBreakerState = "active" | "paused" | "escalated";

/** A recorded failure with its error signature. */
export interface TaskFailureRecord {
  /** Hash of the error message for deduplication. */
  errorHash: string;
  /** Truncated error message (first 200 chars). */
  errorMessage: string;
  /** ISO-8601 timestamp of the failure. */
  timestamp: string;
  /** The step/iteration where the failure occurred. */
  step: number;
}

/** Escalation event emitted when the breaker exhausts recovery attempts. */
export interface EscalationEvent {
  /** The repeated error hash that caused escalation. */
  errorHash: string;
  /** The error message. */
  errorMessage: string;
  /** Total number of identical failures before escalation. */
  failureCount: number;
  /** Number of recovery attempts that were tried. */
  recoveryAttempts: number;
  /** ISO-8601 timestamp of the escalation. */
  timestamp: string;
}

/** Configuration for the task circuit breaker. */
export interface TaskCircuitBreakerOptions {
  /** Number of identical failures before pausing. Default: 5. */
  identicalFailureThreshold?: number;
  /** Maximum recovery attempts before escalation. Default: 2. */
  maxRecoveryAttempts?: number;
}

/** Result returned by `recordFailure()`. */
export interface FailureAction {
  /** What the caller should do next. */
  action: "continue" | "pause_and_recover" | "escalate";
  /** Current breaker state after recording the failure. */
  state: TaskBreakerState;
  /** Number of identical failures for this error hash. */
  identicalCount: number;
  /** Number of recovery attempts already made for this error hash. */
  recoveryAttempts: number;
}

// ----------------------------------------------------------------------------
// TaskCircuitBreaker
// ----------------------------------------------------------------------------

/**
 * Task-level circuit breaker that tracks identical verification failures
 * during a long-running /autoforge or /party session.
 *
 * Flow:
 *   1. On each failure, call `recordFailure(errorMessage, step)`
 *   2. If < threshold identical failures: returns `{ action: "continue" }`
 *   3. If >= threshold identical failures:
 *      a. If recovery attempts remain: returns `{ action: "pause_and_recover" }`
 *      b. If recovery attempts exhausted: returns `{ action: "escalate" }`
 *   4. On success, call `recordSuccess()` to reset the breaker
 */
export class TaskCircuitBreaker {
  private readonly identicalFailureThreshold: number;
  private readonly maxRecoveryAttempts: number;

  /** All recorded failures. */
  private failures: TaskFailureRecord[] = [];

  /** Count of identical failures per error hash. */
  private identicalCounts = new Map<string, number>();

  /** Recovery attempts per error hash. */
  private recoveryCounts = new Map<string, number>();

  /** Current breaker state. */
  private state: TaskBreakerState = "active";

  /** Escalation events (for audit trail). */
  private escalations: EscalationEvent[] = [];

  constructor(options: TaskCircuitBreakerOptions = {}) {
    this.identicalFailureThreshold = options.identicalFailureThreshold ?? 5;
    this.maxRecoveryAttempts = options.maxRecoveryAttempts ?? 2;
  }

  /**
   * Records a verification failure and determines the next action.
   *
   * @param errorMessage - The error message from the failed verification.
   * @param step - The current step/iteration number.
   * @returns A `FailureAction` indicating what the caller should do next.
   */
  recordFailure(errorMessage: string, step: number): FailureAction {
    const errorHash = hashError(errorMessage);
    const truncatedMessage = errorMessage.slice(0, 200);

    this.failures.push({
      errorHash,
      errorMessage: truncatedMessage,
      timestamp: new Date().toISOString(),
      step,
    });

    const identicalCount = (this.identicalCounts.get(errorHash) ?? 0) + 1;
    this.identicalCounts.set(errorHash, identicalCount);

    if (identicalCount < this.identicalFailureThreshold) {
      return {
        action: "continue",
        state: this.state,
        identicalCount,
        recoveryAttempts: this.recoveryCounts.get(errorHash) ?? 0,
      };
    }

    // Threshold reached — check recovery attempts
    const recoveryAttempts = this.recoveryCounts.get(errorHash) ?? 0;

    if (recoveryAttempts < this.maxRecoveryAttempts) {
      this.state = "paused";
      this.recoveryCounts.set(errorHash, recoveryAttempts + 1);

      // Reset identical count so the breaker can re-trigger after recovery
      this.identicalCounts.set(errorHash, 0);

      return {
        action: "pause_and_recover",
        state: this.state,
        identicalCount,
        recoveryAttempts: recoveryAttempts + 1,
      };
    }

    // Recovery exhausted — escalate
    this.state = "escalated";
    const escalation: EscalationEvent = {
      errorHash,
      errorMessage: truncatedMessage,
      failureCount: identicalCount,
      recoveryAttempts,
      timestamp: new Date().toISOString(),
    };
    this.escalations.push(escalation);

    return {
      action: "escalate",
      state: this.state,
      identicalCount,
      recoveryAttempts,
    };
  }

  /**
   * Records a successful verification, resetting the breaker to active state.
   * Clears all identical failure counts.
   */
  recordSuccess(): void {
    this.state = "active";
    this.identicalCounts.clear();
    this.recoveryCounts.clear();
  }

  /** Returns the current breaker state. */
  getState(): TaskBreakerState {
    return this.state;
  }

  /** Returns the total failure count. */
  getTotalFailures(): number {
    return this.failures.length;
  }

  /** Returns all recorded failures. */
  getFailures(): TaskFailureRecord[] {
    return [...this.failures];
  }

  /** Returns all escalation events. */
  getEscalations(): EscalationEvent[] {
    return [...this.escalations];
  }

  /** Returns the identical failure threshold. */
  getThreshold(): number {
    return this.identicalFailureThreshold;
  }

  /** Returns the max recovery attempts. */
  getMaxRecoveryAttempts(): number {
    return this.maxRecoveryAttempts;
  }

  /** Resets all state (for a new session/task). */
  reset(): void {
    this.state = "active";
    this.failures = [];
    this.identicalCounts.clear();
    this.recoveryCounts.clear();
    this.escalations = [];
  }
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

/** Creates a stable hash of an error message for deduplication. */
function hashError(message: string): string {
  // Normalize: trim, lowercase, collapse whitespace, remove line numbers
  const normalized = message
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\d+\b/g, "N")
    .replace(/["'`]/g, "");

  return createHash("sha256").update(normalized, "utf-8").digest("hex").slice(0, 16);
}

export { hashError as hashErrorForTesting };
