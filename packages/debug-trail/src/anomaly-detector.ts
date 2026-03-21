// ============================================================================
// @dantecode/debug-trail — Anomaly Detector
// Heuristic detection of suspicious patterns: burst deletions, large rewrites,
// phantom commits, unusual erasure sequences. Advisory-only, never blocking.
// ============================================================================

import { dirname } from "node:path";
import type { TrailEvent } from "./types.js";

// ---------------------------------------------------------------------------
// Anomaly types
// ---------------------------------------------------------------------------

export type AnomalyType =
  | "burst_deletion" // multiple files deleted in rapid succession
  | "large_rewrite" // file rewritten with > threshold content change
  | "phantom_commit" // git commit with zero file modifications
  | "recursive_delete" // deletion of directories / many files at once
  | "rapid_loop" // same action repeated > N times in short window
  | "untracked_write" // write to a file that was never read (potential confab)
  | "missing_before_state" // deletion without captured before-state
  | "high_error_rate"; // error events > threshold in window

export interface AnomalyFlag {
  anomalyType: AnomalyType;
  severity: "low" | "medium" | "high";
  description: string;
  relatedEventIds: string[];
  detectedAt: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Detector config
// ---------------------------------------------------------------------------

export interface AnomalyDetectorConfig {
  /** Files deleted in N seconds triggers burst_deletion. Default: 3 in 5s */
  burstDeletionCount: number;
  burstDeletionWindowMs: number;
  /** Write size change > fraction triggers large_rewrite flag. Default: 0.8 */
  largeRewriteThreshold: number;
  /** Error events per N events triggers high_error_rate. Default: 0.3 */
  errorRateThreshold: number;
  /** Same action repeated > N times in window. Default: 5 in 30s */
  rapidLoopCount: number;
  rapidLoopWindowMs: number;
  /**
   * Enable untracked_write detection. Default: false.
   * Only meaningful when callers explicitly log tool_call events before writes
   * (establishing read→write causality). Off by default to avoid false positives
   * from direct logFileWrite() calls that have no preceding tool_call.
   */
  detectUntrackedWrites: boolean;
}

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  burstDeletionCount: 3,
  burstDeletionWindowMs: 5_000,
  largeRewriteThreshold: 0.8,
  errorRateThreshold: 0.3,
  rapidLoopCount: 5,
  rapidLoopWindowMs: 30_000,
  detectUntrackedWrites: false,
};

// ---------------------------------------------------------------------------
// Anomaly Detector
// ---------------------------------------------------------------------------

export class AnomalyDetector {
  private config: AnomalyDetectorConfig;

  constructor(config?: Partial<AnomalyDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Update configuration after construction. Allows mid-session reconfiguration. */
  updateConfig(partial: Partial<AnomalyDetectorConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** Get a readonly snapshot of the current configuration. */
  getConfig(): Readonly<AnomalyDetectorConfig> {
    return { ...this.config };
  }

  /**
   * Analyze a window of events and return detected anomalies.
   * Advisory only — results should be logged as anomaly_flag events.
   */
  analyze(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    const flags: AnomalyFlag[] = [];

    flags.push(...this.detectBurstDeletions(events, sessionId));
    flags.push(...this.detectRapidLoop(events, sessionId));
    flags.push(...this.detectHighErrorRate(events, sessionId));
    flags.push(...this.detectMissingBeforeState(events, sessionId));
    flags.push(...this.detectPhantomCommit(events, sessionId));
    flags.push(...this.detectLargeRewrite(events, sessionId));
    flags.push(...this.detectRecursiveDelete(events, sessionId));
    flags.push(...this.detectUntrackedWrite(events, sessionId));

    return flags;
  }

  // -------------------------------------------------------------------------
  // Burst deletion
  // -------------------------------------------------------------------------

  private detectBurstDeletions(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    const deletions = events.filter((e) => e.kind === "file_delete");
    if (deletions.length < this.config.burstDeletionCount) return [];

    const flags: AnomalyFlag[] = [];
    const window = this.config.burstDeletionWindowMs;
    // Pre-compute timestamps once to avoid repeated Date construction in the inner loop
    const deletionTimestamps = deletions.map((e) => new Date(e.timestamp).getTime());

    for (let i = 0; i <= deletions.length - this.config.burstDeletionCount; i++) {
      const start = deletionTimestamps[i]!;
      const end = deletionTimestamps[i + this.config.burstDeletionCount - 1]!;
      if (end - start <= window) {
        // Extend to capture all deletions within the burst window (not just the first N)
        let j = i + this.config.burstDeletionCount;
        while (j < deletions.length) {
          const extentMs = deletionTimestamps[j]! - start;
          if (extentMs <= window) {
            j++;
          } else {
            break;
          }
        }
        const relatedEventIds = deletions.slice(i, j).map((e) => e.id);
        flags.push({
          anomalyType: "burst_deletion",
          severity: "high",
          description: `${relatedEventIds.length} files deleted within ${window / 1000}s`,
          relatedEventIds,
          detectedAt: new Date().toISOString(),
          sessionId: sessionId ?? deletions[i]!.provenance.sessionId,
        });
        break; // Don't report overlapping windows
      }
    }
    return flags;
  }

  // -------------------------------------------------------------------------
  // Rapid loop detection
  // -------------------------------------------------------------------------

  private detectRapidLoop(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    if (events.length < this.config.rapidLoopCount) return [];

    const flags: AnomalyFlag[] = [];
    const window = this.config.rapidLoopWindowMs;
    // Pre-compute timestamps once to avoid repeated Date construction in the window check
    const eventTimestamps = events.map((e) => new Date(e.timestamp).getTime());

    // Fingerprint includes operation target — different files/summaries are NOT a loop
    const fingerprints = events.map(
      (e) => `${e.actor}:${e.kind}:${String(e.payload["filePath"] ?? e.summary).slice(0, 60)}`,
    );

    for (let i = 0; i <= fingerprints.length - this.config.rapidLoopCount; i++) {
      const fp = fingerprints[i]!;
      const isLoop = fingerprints.slice(i, i + this.config.rapidLoopCount).every((f) => f === fp);
      if (!isLoop) continue;

      const start = eventTimestamps[i]!;
      const end = eventTimestamps[i + this.config.rapidLoopCount - 1]!;
      if (end - start <= window) {
        const relatedEventIds = events.slice(i, i + this.config.rapidLoopCount).map((e) => e.id);
        flags.push({
          anomalyType: "rapid_loop",
          severity: "medium",
          description: `Action ${fp} repeated ${this.config.rapidLoopCount}x in ${window / 1000}s`,
          relatedEventIds,
          detectedAt: new Date().toISOString(),
          sessionId: sessionId ?? events[i]!.provenance.sessionId,
        });
        break;
      }
    }
    return flags;
  }

  // -------------------------------------------------------------------------
  // High error rate
  // -------------------------------------------------------------------------

  private detectHighErrorRate(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    if (events.length < 5) return [];
    const errorCount = events.filter((e) => e.kind === "error" || e.kind === "retry").length;
    const rate = errorCount / events.length;
    if (rate <= this.config.errorRateThreshold) return [];

    const relatedEventIds = events
      .filter((e) => e.kind === "error" || e.kind === "retry")
      .map((e) => e.id);

    return [
      {
        anomalyType: "high_error_rate",
        severity: "medium",
        description: `Error rate ${(rate * 100).toFixed(0)}% in ${events.length} events (threshold: ${(this.config.errorRateThreshold * 100).toFixed(0)}%)`,
        relatedEventIds,
        detectedAt: new Date().toISOString(),
        sessionId: sessionId ?? events[0]!.provenance.sessionId,
      },
    ];
  }

  // -------------------------------------------------------------------------
  // Missing before-state on deletion
  // -------------------------------------------------------------------------

  private detectMissingBeforeState(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    const badDeletes = events.filter(
      (e) => e.kind === "file_delete" && !e.beforeSnapshotId && !e.beforeHash,
    );
    if (badDeletes.length === 0) return [];

    return badDeletes.map((e) => ({
      anomalyType: "missing_before_state" as AnomalyType,
      severity: "high" as const,
      description: `File deleted without before-state capture: ${e.payload["filePath"] ?? "unknown"}`,
      relatedEventIds: [e.id],
      detectedAt: new Date().toISOString(),
      sessionId: sessionId ?? e.provenance.sessionId,
    }));
  }

  // -------------------------------------------------------------------------
  // Phantom commit (commit with 0 modified files in session window)
  // -------------------------------------------------------------------------

  private detectPhantomCommit(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    // F4: case-insensitive substring match — consistent with all other detectors in this file.
    const COMMIT_ACTORS = ["gitcommit", "gitpush", "git_commit", "git_push"];
    const commitEvents = events.filter(
      (e) => e.kind === "tool_call" && COMMIT_ACTORS.some((a) => e.actor.toLowerCase().includes(a)),
    );
    if (commitEvents.length === 0) return [];

    const flags: AnomalyFlag[] = [];
    for (const commitEvent of commitEvents) {
      // Look at file writes in the 60s window before this commit
      const commitTime = new Date(commitEvent.timestamp).getTime();
      const windowStart = commitTime - 60_000;
      const precedingFileWrites = events.filter(
        (e) =>
          e.kind === "file_write" &&
          new Date(e.timestamp).getTime() >= windowStart &&
          new Date(e.timestamp).getTime() < commitTime,
      );

      if (precedingFileWrites.length === 0) {
        flags.push({
          anomalyType: "phantom_commit",
          severity: "high",
          description: `Git commit/push with no file writes detected in preceding 60s window`,
          relatedEventIds: [commitEvent.id],
          detectedAt: new Date().toISOString(),
          sessionId: sessionId ?? commitEvent.provenance.sessionId,
        });
      }
    }
    return flags;
  }

  // -------------------------------------------------------------------------
  // Large rewrite (file rewritten 3+ times with content changes)
  // -------------------------------------------------------------------------

  private detectLargeRewrite(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    // Group file_write events by filePath where beforeHash !== afterHash (both present)
    // Flag files that have 3+ hash-changing writes
    const writes = events.filter(
      (e) => e.kind === "file_write" && e.beforeHash && e.afterHash && e.beforeHash !== e.afterHash,
    );
    const byFile = new Map<string, TrailEvent[]>();
    for (const w of writes) {
      const fp = String(w.payload["filePath"] ?? "unknown");
      if (!byFile.has(fp)) byFile.set(fp, []);
      byFile.get(fp)!.push(w);
    }
    const flags: AnomalyFlag[] = [];
    for (const [fp, evts] of byFile) {
      if (evts.length >= 3) {
        flags.push({
          anomalyType: "large_rewrite",
          severity: "medium",
          description: `File ${fp} rewritten ${evts.length} times with content changes`,
          relatedEventIds: evts.map((e) => e.id),
          detectedAt: new Date().toISOString(),
          sessionId: sessionId ?? evts[0]!.provenance.sessionId,
        });
      }
    }
    return flags;
  }

  // -------------------------------------------------------------------------
  // Recursive delete (3+ files deleted from same directory)
  // -------------------------------------------------------------------------

  private detectRecursiveDelete(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    // Group file_delete events by parent directory
    // Flag directories where 3+ files deleted
    const deletions = events.filter((e) => e.kind === "file_delete");
    if (deletions.length < 3) return [];

    const byDir = new Map<string, TrailEvent[]>();
    for (const d of deletions) {
      const fp = String(d.payload["filePath"] ?? "");
      const dir = fp ? dirname(fp) || fp : ".";
      if (!byDir.has(dir)) byDir.set(dir, []);
      byDir.get(dir)!.push(d);
    }
    const flags: AnomalyFlag[] = [];
    for (const [dir, evts] of byDir) {
      if (evts.length >= 3) {
        flags.push({
          anomalyType: "recursive_delete",
          severity: "high",
          description: `${evts.length} files deleted from directory ${dir}`,
          relatedEventIds: evts.map((e) => e.id),
          detectedAt: new Date().toISOString(),
          sessionId: sessionId ?? evts[0]!.provenance.sessionId,
        });
      }
    }
    return flags;
  }

  // -------------------------------------------------------------------------
  // Untracked write (write to path never seen in a preceding read tool call)
  // -------------------------------------------------------------------------

  private detectUntrackedWrite(events: TrailEvent[], sessionId?: string): AnomalyFlag[] {
    // Extract the filePath referenced by a tool_call event (either direct payload or args).
    const toolCallFilePath = (e: TrailEvent): string | null => {
      const direct = e.payload["filePath"];
      if (typeof direct === "string") return direct;
      const args = e.payload["args"];
      if (args && typeof args === "object" && args !== null) {
        const fp = (args as Record<string, unknown>)["file_path"];
        if (typeof fp === "string") return fp;
      }
      return null;
    };

    // Auto-detect mode (default): only activate when callers have established
    // tool_call → file_write causality by logging at least one tool_call with a filePath.
    // Without this guard every direct logFileWrite() call (no preceding tool_call) would fire.
    if (!this.config.detectUntrackedWrites) {
      const hasAnyToolCallRead = events.some(
        (e) => e.kind === "tool_call" && toolCallFilePath(e) !== null,
      );
      if (!hasAnyToolCallRead) return [];
    }

    // Per-write causality: for each file_write at position i, check whether any
    // tool_call event at position j < i references the same file path.
    // This prevents a single incidental tool_call for fileA from suppressing
    // detection of an unrelated untracked write to fileB.
    const flags: AnomalyFlag[] = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (e.kind !== "file_write") continue;
      const fp = String(e.payload["filePath"] ?? "");
      if (!fp) continue;

      const hasPrecedingRead = events
        .slice(0, i)
        .some((prior) => prior.kind === "tool_call" && toolCallFilePath(prior) === fp);

      if (!hasPrecedingRead) {
        flags.push({
          anomalyType: "untracked_write",
          severity: "medium",
          description: `Write to ${fp} with no preceding Read tool call`,
          relatedEventIds: [e.id],
          detectedAt: new Date().toISOString(),
          sessionId: sessionId ?? e.provenance.sessionId,
        });
      }
    }
    return flags;
  }
}
