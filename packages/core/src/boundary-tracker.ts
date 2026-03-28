/**
 * boundary-tracker.ts
 *
 * Detects when agent work expands beyond the original scope established by
 * RunIntake. Tracks mutated files against the requested scope and flags
 * boundary drift when expansion exceeds a configurable threshold.
 *
 * The primary entry point is `checkBoundaryDrift()`, which compares the set
 * of files mutated during a run against the scope paths declared in the
 * RunIntake. When the count of out-of-scope mutations exceeds the threshold
 * percentage of the original scope size, drift is flagged.
 */

import type { RunIntake } from "./run-intake.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BoundaryState {
  /** The run ID from the associated RunIntake. */
  runId: string;
  /** File paths (or path fragments) from the original RunIntake scope. */
  originalScope: string[];
  /** All file paths that have been mutated during the run so far. */
  currentMutations: string[];
  /** True when expansion exceeds the configured threshold. */
  driftDetected: boolean;
  /** Percentage of scope expansion (out-of-scope mutations / scope size * 100). */
  expansionPercent: number;
  /** List of mutated files that fall outside the original scope. */
  outOfScopeFiles: string[];
  /** ISO-8601 timestamp of this boundary check. */
  timestamp: string;
}

export interface BoundaryDriftOptions {
  /**
   * Expansion percentage threshold above which drift is flagged.
   * Default: 120 (i.e., out-of-scope mutations exceed 120% of original scope size).
   */
  thresholdPercent?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default expansion threshold percentage. */
const DEFAULT_THRESHOLD_PERCENT = 120;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalize a file path for comparison: forward slashes, lowercase, trim.
 * This ensures Windows backslash paths match Unix-style scope entries.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase().trim();
}

/**
 * Check whether a mutated file path matches any scope entry.
 * Uses bidirectional substring matching so that:
 * - scope "src/foo.ts" matches mutation "src/foo.ts" (exact)
 * - scope "src/" matches mutation "src/bar.ts" (directory scope)
 * - scope "packages/core/src/index.ts" matches mutation containing that path
 */
function isInScope(mutatedFile: string, scopePaths: string[]): boolean {
  const normalizedMutation = normalizePath(mutatedFile);
  return scopePaths.some((scopePath) => {
    const normalizedScope = normalizePath(scopePath);
    return (
      normalizedMutation.includes(normalizedScope) ||
      normalizedScope.includes(normalizedMutation)
    );
  });
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

/**
 * Check whether the set of mutated files has drifted beyond the original
 * scope declared in the RunIntake.
 *
 * @param runIntake    - The RunIntake capturing the user's original intent boundary.
 * @param mutatedFiles - Array of file paths that have been written/edited during the run.
 * @param options      - Optional configuration for threshold tuning.
 * @returns A BoundaryState snapshot describing the current drift status.
 */
export function checkBoundaryDrift(
  runIntake: RunIntake,
  mutatedFiles: string[],
  options?: BoundaryDriftOptions,
): BoundaryState {
  const thresholdPercent = options?.thresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
  const originalScope = runIntake.requestedScope;

  // When original scope is empty (no files mentioned in prompt), any mutation
  // is technically "out of scope" but we treat empty scope as unconstrained
  // to avoid false positives on freeform prompts like "fix the bug".
  if (originalScope.length === 0) {
    return {
      runId: runIntake.runId,
      originalScope,
      currentMutations: mutatedFiles,
      driftDetected: false,
      expansionPercent: 0,
      outOfScopeFiles: [],
      timestamp: new Date().toISOString(),
    };
  }

  // When no files have been mutated, there is no drift.
  if (mutatedFiles.length === 0) {
    return {
      runId: runIntake.runId,
      originalScope,
      currentMutations: [],
      driftDetected: false,
      expansionPercent: 0,
      outOfScopeFiles: [],
      timestamp: new Date().toISOString(),
    };
  }

  // Deduplicate mutations for accurate counting
  const uniqueMutations = [...new Set(mutatedFiles.map(normalizePath))];

  // Identify files mutated outside original scope
  const outOfScopeFiles = uniqueMutations.filter(
    (file) => !isInScope(file, originalScope),
  );

  const scopeSize = originalScope.length;
  const expansionPercent = (outOfScopeFiles.length / scopeSize) * 100;
  const driftDetected = expansionPercent > thresholdPercent;

  return {
    runId: runIntake.runId,
    originalScope,
    currentMutations: mutatedFiles,
    driftDetected,
    expansionPercent,
    outOfScopeFiles,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format a human-readable drift warning message for display to the user.
 * Returns an empty string when no drift has been detected.
 *
 * @param state - The BoundaryState from a previous `checkBoundaryDrift()` call.
 * @returns A formatted multi-line string describing the drift, or empty string.
 */
export function formatDriftMessage(state: BoundaryState): string {
  if (!state.driftDetected) return "";

  const lines: string[] = [
    `Boundary drift detected: ${state.expansionPercent.toFixed(0)}% expansion beyond original scope`,
    `Original scope (${state.originalScope.length} path(s)): ${state.originalScope.join(", ")}`,
    `Out-of-scope files (${state.outOfScopeFiles.length}): ${state.outOfScopeFiles.join(", ")}`,
    `Continue with expanded scope?`,
  ];

  return lines.join("\n");
}

/**
 * Incremental tracker that accumulates mutated files across tool rounds
 * and provides boundary-state snapshots on demand.
 */
export class BoundaryTracker {
  private readonly runIntake: RunIntake;
  private readonly mutatedFiles: string[] = [];
  private readonly options: BoundaryDriftOptions;
  private lastState: BoundaryState | null = null;

  constructor(runIntake: RunIntake, options?: BoundaryDriftOptions) {
    this.runIntake = runIntake;
    this.options = options ?? {};
  }

  /**
   * Record one or more file mutations from the latest tool round.
   */
  recordMutations(files: string[]): void {
    for (const file of files) {
      if (!this.mutatedFiles.includes(file)) {
        this.mutatedFiles.push(file);
      }
    }
  }

  /**
   * Check current boundary state against all accumulated mutations.
   */
  check(): BoundaryState {
    this.lastState = checkBoundaryDrift(this.runIntake, this.mutatedFiles, this.options);
    return this.lastState;
  }

  /**
   * Return the last computed boundary state (without recalculating).
   * Returns `null` if `check()` has never been called.
   */
  getLastState(): BoundaryState | null {
    return this.lastState;
  }

  /**
   * Return all tracked mutated files so far.
   */
  getMutatedFiles(): readonly string[] {
    return this.mutatedFiles;
  }
}
