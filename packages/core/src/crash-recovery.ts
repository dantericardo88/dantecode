// ============================================================================
// @dantecode/core — CrashRecovery
//
// Implements real automated recovery from interrupted sessions.
// Replaces the no-op stub in RecoveryManager.offerRecovery().
//
// Responsibilities:
//   1. Scan for stale/interrupted sessions on startup
//   2. Auto-select the best candidate (newest resumable session)
//   3. Attempt to restore session context without requiring manual --resume flag
//   4. Feed restored context back to the caller so the agent can continue
//
// Pattern sources:
//   - LangGraph: graph.getState() + graph.updateState() on interruption
//   - OpenHands: AgentController.agent_task_manager restores from event log
//   - SWE-agent: structured exception handler feeds stack into next prompt
// ============================================================================

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { RecoveryManager } from "./recovery-manager.js";
import type { StaleSession } from "./recovery-manager.js";
import { resumeFromCheckpoint } from "./checkpointer.js";
import { JsonlEventStore } from "./durable-event-store.js";
import type { ResumeContext } from "./checkpointer.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Policy for selecting which session to auto-resume. */
export type AutoResumePolicy =
  | "newest"     // Resume the most recently checkpointed session
  | "highest_step" // Resume the session with the most progress
  | "none";      // Never auto-resume; only surface candidates to the caller

/** Options for CrashRecovery. */
export interface CrashRecoveryOptions {
  /** Policy for auto-resume candidate selection. Default: "newest". */
  autoResumePolicy?: AutoResumePolicy;
  /**
   * Maximum age of a session (ms) to be considered resumable.
   * Sessions older than this are considered too stale.
   * Default: 24 * 60 * 60 * 1000 (24 hours).
   */
  maxSessionAgeMs?: number;
  /**
   * Whether to silently recover without emitting any UI messages.
   * Default: false.
   */
  silent?: boolean;
}

/** The result of a crash recovery scan. */
export interface CrashRecoveryScanResult {
  /** Sessions found that could be resumed. */
  resumableSessions: StaleSession[];
  /** Sessions found but classified as too stale or corrupt. */
  staleSessions: StaleSession[];
  /** The session that was automatically selected, if any. */
  selectedSession: StaleSession | null;
}

/** The result of attempting to restore a session. */
export interface CrashRecoveryResult {
  /** Whether recovery succeeded. */
  recovered: boolean;
  /** Session ID that was recovered. */
  sessionId: string | null;
  /** The restored context, if recovery succeeded. */
  resumeContext: ResumeContext | null;
  /** Human-readable status message. */
  message: string;
  /** Number of events replayed. */
  eventsReplayed: number;
}

// ----------------------------------------------------------------------------
// CrashRecovery
// ----------------------------------------------------------------------------

/**
 * CrashRecovery
 *
 * Real automated recovery from interrupted sessions.
 * Scans .dantecode/checkpoints/, selects the best candidate,
 * and restores session context via resumeFromCheckpoint().
 *
 * @example
 * ```ts
 * const recovery = new CrashRecovery(projectRoot);
 * const scan = await recovery.scan();
 * if (scan.selectedSession) {
 *   const result = await recovery.restore(scan.selectedSession.sessionId);
 *   if (result.recovered && result.resumeContext) {
 *     // inject result.resumeContext into agent message history
 *   }
 * }
 * ```
 */
export class CrashRecovery {
  private readonly projectRoot: string;
  private readonly recoveryManager: RecoveryManager;
  private readonly autoResumePolicy: AutoResumePolicy;
  private readonly maxSessionAgeMs: number;
  private readonly silent: boolean;
  private readonly eventsDir: string;

  constructor(projectRoot: string, options: CrashRecoveryOptions = {}) {
    this.projectRoot = projectRoot;
    this.autoResumePolicy = options.autoResumePolicy ?? "newest";
    this.maxSessionAgeMs = options.maxSessionAgeMs ?? 24 * 60 * 60 * 1000;
    this.silent = options.silent ?? false;
    this.eventsDir = join(projectRoot, ".dantecode", "events");
    this.recoveryManager = new RecoveryManager({ projectRoot });
  }

  /**
   * Scan for interrupted sessions and select the best candidate.
   *
   * Does NOT restore anything — call restore() afterward.
   */
  async scan(): Promise<CrashRecoveryScanResult> {
    const allSessions = await this.recoveryManager.scanStaleSessions();
    const now = Date.now();

    // Separate resumable from stale/corrupt
    const resumableSessions: StaleSession[] = [];
    const staleSessions: StaleSession[] = [];

    for (const session of allSessions) {
      if (session.status !== "resumable") {
        staleSessions.push(session);
        continue;
      }

      // Check age if timestamp is present
      if (session.timestamp) {
        const age = now - new Date(session.timestamp).getTime();
        if (age > this.maxSessionAgeMs) {
          staleSessions.push({ ...session, reason: `Too old: ${Math.round(age / 3600000)}h ago` });
          continue;
        }
      }

      resumableSessions.push(session);
    }

    const selectedSession = this.selectCandidate(resumableSessions);

    return { resumableSessions, staleSessions, selectedSession };
  }

  /**
   * Attempt to restore a specific session by ID.
   *
   * Loads the checkpoint + event log and returns a ResumeContext
   * that can be injected into agent message history.
   */
  async restore(sessionId: string): Promise<CrashRecoveryResult> {
    const eventsBaseDir = this.eventsDir;
    const eventStore = new JsonlEventStore(sessionId, eventsBaseDir);
    const checkpointDir = join(this.projectRoot, ".dantecode", "checkpoints");
    const checkpointPath = join(checkpointDir, sessionId, "base_state.json");

    if (!existsSync(checkpointPath)) {
      return {
        recovered: false,
        sessionId,
        resumeContext: null,
        message: `Checkpoint not found: ${checkpointPath}`,
        eventsReplayed: 0,
      };
    }

    try {
      const resumeContext = await resumeFromCheckpoint(this.projectRoot, sessionId, eventStore);

      // Count replayed events for reporting
      const latestEventId = await eventStore.getLatestId().catch(() => 0);

      if (!this.silent) {
        this.emitRecoveryMessage(sessionId, latestEventId);
      }

      return {
        recovered: true,
        sessionId,
        resumeContext,
        message: `Recovered session ${sessionId} (${latestEventId} events replayed)`,
        eventsReplayed: latestEventId,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        recovered: false,
        sessionId,
        resumeContext: null,
        message: `Recovery failed: ${msg}`,
        eventsReplayed: 0,
      };
    }
  }

  /**
   * Convenience: scan then immediately restore the selected session.
   *
   * Returns null result if no candidate found or policy is "none".
   */
  async scanAndRestore(): Promise<CrashRecoveryResult> {
    const scan = await this.scan();

    if (this.autoResumePolicy === "none" || !scan.selectedSession) {
      return {
        recovered: false,
        sessionId: null,
        resumeContext: null,
        message:
          scan.resumableSessions.length === 0
            ? "No resumable sessions found"
            : `Found ${scan.resumableSessions.length} resumable sessions (policy=none, not auto-resuming)`,
        eventsReplayed: 0,
      };
    }

    return this.restore(scan.selectedSession.sessionId);
  }

  /**
   * Build a summary message for the operator about available sessions.
   * Useful for surfacing in CLI startup banners.
   */
  async buildStartupMessage(): Promise<string | null> {
    const scan = await this.scan();
    if (scan.resumableSessions.length === 0) return null;

    const lines: string[] = [
      `[DanteCode] ${scan.resumableSessions.length} interrupted session(s) found:`,
    ];

    for (const s of scan.resumableSessions.slice(0, 3)) {
      const age = s.timestamp
        ? ` (${Math.round((Date.now() - new Date(s.timestamp).getTime()) / 60000)}m ago)`
        : "";
      const step = s.step !== undefined ? `, step ${s.step}` : "";
      lines.push(`  • ${s.sessionId}${age}${step} — resume with --resume=${s.sessionId}`);
    }

    if (scan.resumableSessions.length > 3) {
      lines.push(`  ... and ${scan.resumableSessions.length - 3} more`);
    }

    return lines.join("\n");
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private selectCandidate(sessions: StaleSession[]): StaleSession | null {
    if (sessions.length === 0) return null;
    if (this.autoResumePolicy === "none") return null;

    if (this.autoResumePolicy === "highest_step") {
      return sessions.reduce((best, s) => {
        const bestStep = best.step ?? 0;
        const sStep = s.step ?? 0;
        return sStep > bestStep ? s : best;
      });
    }

    // Default: "newest" — sort by timestamp desc and pick first
    const sorted = [...sessions].sort((a, b) => {
      if (!a.timestamp) return 1;
      if (!b.timestamp) return -1;
      return b.timestamp.localeCompare(a.timestamp);
    });
    return sorted[0] ?? null;
  }

  private emitRecoveryMessage(sessionId: string, eventsReplayed: number): void {
    process.stderr.write(
      `[CrashRecovery] Restored session ${sessionId} (${eventsReplayed} events replayed)\n`,
    );
  }
}

// ----------------------------------------------------------------------------
// AutoforgeSessionScanner — scans for incomplete autoforge sessions
// ----------------------------------------------------------------------------

/**
 * Scans .dantecode/autoforge-checkpoints/ for incomplete sessions
 * and returns those that can be auto-resumed.
 *
 * An autoforge session is considered resumable if:
 *  - Its checkpoint file exists and is valid JSON
 *  - Its last checkpoint does NOT have status "completed" or "escalated"
 *  - It was created within maxAgeMs
 */
export interface AutoforgeResumableSession {
  sessionId: string;
  checkpointPath: string;
  lastStep: number;
  elapsedMs: number;
  triggerCommand: string;
  targetFilePath?: string;
  createdAt: string;
  age: number; // ms since createdAt
}

/**
 * Scan .dantecode/autoforge-checkpoints/ for resumable sessions.
 */
export async function scanAutoforgeResumableSessions(
  projectRoot: string,
  maxAgeMs = 24 * 60 * 60 * 1000,
): Promise<AutoforgeResumableSession[]> {
  const checkpointDir = join(projectRoot, ".dantecode", "autoforge-checkpoints");

  if (!existsSync(checkpointDir)) {
    return [];
  }

  const { readdir } = await import("node:fs/promises");
  const resumable: AutoforgeResumableSession[] = [];
  const now = Date.now();

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(checkpointDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const filePath = join(checkpointDir, entry.name);
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as {
        version?: number;
        sessionId?: string;
        startedAt?: string;
        checkpoints?: Array<{
          id?: string;
          currentStep?: number;
          elapsedMs?: number;
          triggerCommand?: string;
          targetFilePath?: string;
          createdAt?: string;
          metadata?: { escalated?: boolean; completed?: boolean };
        }>;
      };

      if (data.version !== 2 || !Array.isArray(data.checkpoints) || data.checkpoints.length === 0) {
        continue;
      }

      const last = data.checkpoints[data.checkpoints.length - 1]!;

      // Skip if explicitly completed or escalated
      if (last.metadata?.completed || last.metadata?.escalated) {
        continue;
      }

      const createdAt = last.createdAt ?? data.startedAt ?? new Date(0).toISOString();
      const age = now - new Date(createdAt).getTime();

      if (age > maxAgeMs) continue;

      const sessionId = data.sessionId ?? entry.name.replace(/\.json$/, "");

      resumable.push({
        sessionId,
        checkpointPath: filePath,
        lastStep: last.currentStep ?? 0,
        elapsedMs: last.elapsedMs ?? 0,
        triggerCommand: last.triggerCommand ?? "/autoforge",
        targetFilePath: last.targetFilePath,
        createdAt,
        age,
      });
    } catch {
      // Malformed checkpoint — skip
    }
  }

  // Sort newest first
  return resumable.sort((a, b) => a.age - b.age);
}

// ----------------------------------------------------------------------------
// Startup crash recovery hook
// ----------------------------------------------------------------------------

/**
 * Run crash recovery on CLI startup.
 *
 * Scans for stale EventSourced sessions AND incomplete autoforge sessions.
 * Returns a summary for the operator and the best auto-resume candidate.
 *
 * This is the function to call in repl.ts / agent-loop startup.
 */
export interface StartupRecoveryState {
  /** Resumable EventSourced sessions (from .dantecode/checkpoints/). */
  resumableSessions: StaleSession[];
  /** Resumable autoforge sessions (from .dantecode/autoforge-checkpoints/). */
  autoforgeResumable: AutoforgeResumableSession[];
  /** Whether any recovery action was taken automatically. */
  autoRecovered: boolean;
  /** The crash recovery result, if auto-recovery was attempted. */
  recoveryResult: CrashRecoveryResult | null;
  /** Operator-facing startup banner lines (empty if nothing to report). */
  bannerLines: string[];
}

/**
 * Perform startup crash recovery scan.
 *
 * @param projectRoot - Project root directory
 * @param options - Recovery options
 */
export async function runStartupCrashRecovery(
  projectRoot: string,
  options: CrashRecoveryOptions = {},
): Promise<StartupRecoveryState> {
  const crashRecovery = new CrashRecovery(projectRoot, { ...options, silent: true });
  const scan = await crashRecovery.scan();
  const autoforgeResumable = await scanAutoforgeResumableSessions(projectRoot);

  const bannerLines: string[] = [];
  let autoRecovered = false;
  let recoveryResult: CrashRecoveryResult | null = null;

  // Auto-resume EventSourced session if policy allows
  if (scan.selectedSession && options.autoResumePolicy !== "none") {
    recoveryResult = await crashRecovery.restore(scan.selectedSession.sessionId);
    autoRecovered = recoveryResult.recovered;
    if (recoveryResult.recovered) {
      bannerLines.push(
        `[DanteCode] Auto-resumed interrupted session ${recoveryResult.sessionId} ` +
        `(${recoveryResult.eventsReplayed} events replayed)`,
      );
    } else {
      bannerLines.push(
        `[DanteCode] Recovery attempted for ${scan.selectedSession.sessionId} but failed: ${recoveryResult.message}`,
      );
    }
  } else if (scan.resumableSessions.length > 0) {
    bannerLines.push(
      `[DanteCode] ${scan.resumableSessions.length} interrupted session(s) available. ` +
      `Resume with: --resume=${scan.resumableSessions[0]!.sessionId}`,
    );
  }

  // Surface autoforge resumable sessions
  if (autoforgeResumable.length > 0) {
    const newest = autoforgeResumable[0]!;
    const ageMin = Math.round(newest.age / 60000);
    bannerLines.push(
      `[DanteCode] Autoforge session from ${ageMin}m ago (step ${newest.lastStep}) — ` +
      `resume with: /autoforge --resume=${newest.sessionId}`,
    );
  }

  return {
    resumableSessions: scan.resumableSessions,
    autoforgeResumable,
    autoRecovered,
    recoveryResult,
    bannerLines,
  };
}
