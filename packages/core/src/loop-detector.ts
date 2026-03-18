// ============================================================================
// @dantecode/core — Stuck-Loop Detection Middleware
// CrewAI-inspired loop detection with actual action fingerprinting.
// Monitors action history and breaks repetitive patterns.
// Goes beyond CrewAI's simple iteration counter by detecting:
// - Identical consecutive actions (same fingerprint repeated)
// - Repetitive patterns (ABAB or ABCABC cycles)
// - Max iteration ceiling (CrewAI-style fallback)
// ============================================================================

import { createHash } from "node:crypto";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A recorded action in the history. */
export interface ActionRecord {
  /** Action type (e.g. "tool_call", "edit", "bash", "llm_response"). */
  type: string;
  /** SHA-256 fingerprint of the normalized action content. */
  fingerprint: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Step/iteration number. */
  step: number;
  /** Raw action content (truncated to 500 chars). */
  content: string;
}

/** Result of a loop detection check. */
export interface LoopDetectionResult {
  /** Whether the agent is stuck in a loop. */
  stuck: boolean;
  /** Why the loop was detected. */
  reason?: "max_iterations" | "identical_consecutive" | "cyclic_pattern";
  /** Human-readable explanation. */
  details?: string;
  /** Current iteration count. */
  iterationCount: number;
  /** Number of consecutive identical actions. */
  consecutiveRepeats: number;
}

/** Configuration for the loop detector. */
export interface LoopDetectorOptions {
  /** Maximum iterations before forced stop. Default: 25 (CrewAI default). */
  maxIterations?: number;
  /** Number of consecutive identical actions to trigger detection. Default: 3. */
  identicalThreshold?: number;
  /** Window size for cyclic pattern detection. Default: 10. */
  patternWindowSize?: number;
  /** Minimum cycle length to detect. Default: 2. */
  minCycleLength?: number;
  /** Maximum cycle length to detect. Default: 5. */
  maxCycleLength?: number;
  /** Action types that are allowed to repeat (e.g. "continue", "empty"). */
  allowedRepeatTypes?: string[];
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const DEFAULT_MAX_ITERATIONS = 25;
const DEFAULT_IDENTICAL_THRESHOLD = 3;
const DEFAULT_PATTERN_WINDOW = 10;
const DEFAULT_MIN_CYCLE = 2;
const DEFAULT_MAX_CYCLE = 5;

// ----------------------------------------------------------------------------
// LoopDetector
// ----------------------------------------------------------------------------

/**
 * Stuck-loop detection middleware that monitors action history
 * and detects repetitive patterns.
 *
 * Detection strategies (ordered by specificity):
 *
 * 1. **Identical consecutive** — Same fingerprint repeated N times in a row.
 *    Catches: agent calling the same tool with same args repeatedly.
 *
 * 2. **Cyclic pattern** — A sequence of K actions repeating (ABAB, ABCABC).
 *    Catches: agent alternating between two failing approaches.
 *
 * 3. **Max iterations** — Hard ceiling on total iterations.
 *    Catches: everything else (CrewAI-style fallback).
 *
 * Exception: Actions with types in `allowedRepeatTypes` are exempt from
 * identical-consecutive detection (e.g. "continue", "empty" responses).
 */
export class LoopDetector {
  private readonly maxIterations: number;
  private readonly identicalThreshold: number;
  private readonly patternWindowSize: number;
  private readonly minCycleLength: number;
  private readonly maxCycleLength: number;
  private readonly allowedRepeatTypes: Set<string>;
  private history: ActionRecord[] = [];
  private iterations = 0;

  constructor(options: LoopDetectorOptions = {}) {
    this.maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    this.identicalThreshold = options.identicalThreshold ?? DEFAULT_IDENTICAL_THRESHOLD;
    this.patternWindowSize = options.patternWindowSize ?? DEFAULT_PATTERN_WINDOW;
    this.minCycleLength = options.minCycleLength ?? DEFAULT_MIN_CYCLE;
    this.maxCycleLength = options.maxCycleLength ?? DEFAULT_MAX_CYCLE;
    this.allowedRepeatTypes = new Set(options.allowedRepeatTypes ?? ["continue", "empty"]);
  }

  /**
   * Records an action and checks for loop patterns.
   * Call this after every agent action/step.
   */
  recordAction(type: string, content: string): LoopDetectionResult {
    const fingerprint = fingerprintAction(type, content);
    const record: ActionRecord = {
      type,
      fingerprint,
      timestamp: new Date().toISOString(),
      step: this.iterations,
      content: content.slice(0, 500),
    };

    this.history.push(record);
    this.iterations++;

    // Check 1: Max iterations
    if (this.iterations >= this.maxIterations) {
      return {
        stuck: true,
        reason: "max_iterations",
        details: `Reached maximum iteration limit (${this.maxIterations})`,
        iterationCount: this.iterations,
        consecutiveRepeats: this.countConsecutiveRepeats(),
      };
    }

    // Check 2: Identical consecutive (unless allowed type)
    if (!this.allowedRepeatTypes.has(type)) {
      const consecutive = this.countConsecutiveRepeats();
      if (consecutive >= this.identicalThreshold) {
        return {
          stuck: true,
          reason: "identical_consecutive",
          details: `Same action repeated ${consecutive} times consecutively (type: ${type})`,
          iterationCount: this.iterations,
          consecutiveRepeats: consecutive,
        };
      }
    }

    // Check 3: Cyclic pattern detection
    const cycle = this.detectCyclicPattern();
    if (cycle) {
      return {
        stuck: true,
        reason: "cyclic_pattern",
        details: `Detected repeating cycle of length ${cycle.cycleLength} (repeated ${cycle.repetitions} times)`,
        iterationCount: this.iterations,
        consecutiveRepeats: this.countConsecutiveRepeats(),
      };
    }

    return {
      stuck: false,
      iterationCount: this.iterations,
      consecutiveRepeats: this.countConsecutiveRepeats(),
    };
  }

  /** Resets all state for a new task. */
  reset(): void {
    this.history = [];
    this.iterations = 0;
  }

  /** Returns the current iteration count. */
  getIterationCount(): number {
    return this.iterations;
  }

  /** Returns the full action history. */
  getActionHistory(): ActionRecord[] {
    return [...this.history];
  }

  /** Returns the max iterations setting. */
  getMaxIterations(): number {
    return this.maxIterations;
  }

  // --------------------------------------------------------------------------
  // Private — Detection algorithms
  // --------------------------------------------------------------------------

  /**
   * Counts how many consecutive identical fingerprints at the end of history.
   */
  private countConsecutiveRepeats(): number {
    if (this.history.length === 0) return 0;

    const lastFingerprint = this.history[this.history.length - 1]!.fingerprint;
    let count = 0;

    for (let i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i]!.fingerprint === lastFingerprint) {
        count++;
      } else {
        break;
      }
    }

    return count;
  }

  /**
   * Detects cyclic patterns in the recent action history.
   * Looks for repeating subsequences of length K (minCycleLength..maxCycleLength).
   *
   * Example: fingerprints [A, B, A, B, A, B] → cycle of length 2, repeated 3 times.
   */
  private detectCyclicPattern(): { cycleLength: number; repetitions: number } | null {
    const window = this.history.slice(-this.patternWindowSize);
    if (window.length < this.minCycleLength * 2) return null;

    const fingerprints = window.map((a) => a.fingerprint);

    for (
      let cycleLen = this.minCycleLength;
      cycleLen <= Math.min(this.maxCycleLength, Math.floor(fingerprints.length / 2));
      cycleLen++
    ) {
      const candidate = fingerprints.slice(-cycleLen);
      let repetitions = 1;
      let pos = fingerprints.length - cycleLen * 2;

      while (pos >= 0) {
        const segment = fingerprints.slice(pos, pos + cycleLen);
        if (arraysEqual(segment, candidate)) {
          repetitions++;
          pos -= cycleLen;
        } else {
          break;
        }
      }

      // Require at least 2 full repetitions to declare a cycle
      if (repetitions >= 2) {
        return { cycleLength: cycleLen, repetitions };
      }
    }

    return null;
  }
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

/** Creates a stable fingerprint for an action (type + normalized content). */
export function fingerprintAction(type: string, content: string): string {
  const normalized = `${type}:${content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\d+\b/g, "N")
    .replace(/["'`]/g, "")}`;

  return createHash("sha256").update(normalized, "utf-8").digest("hex").slice(0, 16);
}

/** Checks if two arrays are element-wise equal. */
function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
