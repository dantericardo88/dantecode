// ============================================================================
// @dantecode/core — DanteCode Self Adapter
// Native self-lane adapter. DanteCode orchestrating itself as a lane.
// Uses direct in-process coordination rather than spawning a subprocess.
// ============================================================================

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

const GIT_TIMEOUT_MS = 10_000;
import { BaseCouncilAdapter } from "./base.js";
import type {
  AdapterAvailability,
  AdapterCapacity,
  AdapterSubmission,
  AdapterStatus,
  AdapterArtifacts,
  AdapterPatch,
  RateLimitSignal,
} from "./base.js";
import type { CouncilTaskPacket } from "../council-types.js";

/**
 * Executor function type for running the real DanteCode agent loop.
 * Lane D wires in the concrete implementation at CLI startup.
 */
export type SelfLaneExecutor = (
  prompt: string,
  projectRoot: string,
  options?: { maxRounds?: number; worktreePath?: string; abortSignal?: AbortSignal },
) => Promise<{ output: string; touchedFiles: string[]; success: boolean; error?: string }>;

interface SelfSession {
  sessionId: string;
  packet: CouncilTaskPacket;
  startedAt: number;
  status: "pending" | "running" | "completed" | "failed" | "aborted";
  executionPromise?: Promise<void>;
  abortController?: AbortController;
  touchedFiles?: string[];
  error?: string;
}

/**
 * DanteCode self-adapter. The orchestrator can assign a lane to itself,
 * executing work in its own native agent loop via a CLI sub-process.
 */
export class DanteCodeAdapter extends BaseCouncilAdapter {
  readonly id = "dantecode" as const;
  readonly displayName = "DanteCode (self)";
  readonly kind = "native-cli" as const;

  private readonly sessions = new Map<string, SelfSession>();
  private readonly executor?: SelfLaneExecutor;

  constructor(options?: { executor?: SelfLaneExecutor }) {
    super();
    this.executor = options?.executor;
  }

  async probeAvailability(): Promise<AdapterAvailability> {
    // DanteCode is always self-available
    return { available: true, health: "ready" };
  }

  async estimateCapacity(): Promise<AdapterCapacity> {
    // Self adapter has no external cap
    return { remainingCapacity: 100, capSuspicion: "none" };
  }

  async submitTask(packet: CouncilTaskPacket): Promise<AdapterSubmission> {
    const sessionId = randomUUID().slice(0, 12);
    const session: SelfSession = {
      sessionId,
      packet,
      startedAt: Date.now(),
      status: "pending",
    };
    this.sessions.set(sessionId, session);

    if (this.executor) {
      // Real execution path: fire agent loop as fire-and-forget background Promise
      session.status = "running";
      const ac = new AbortController();
      session.abortController = ac;
      const prompt = this.buildTaskPrompt(packet); // inherited from BaseCouncilAdapter
      const execPromise = this.executor(prompt, packet.worktreePath, {
        maxRounds: 80,
        worktreePath: packet.worktreePath,
        abortSignal: ac.signal,
      })
        .then((result) => {
          session.status = result.success ? "completed" : "failed";
          session.touchedFiles = result.touchedFiles;
          if (!result.success) {
            session.error = result.error ?? "Executor reported failure";
          }
        })
        .catch((err: unknown) => {
          // If the AbortController was signalled, this is an intentional cancellation
          const isAbort = ac.signal.aborted;
          session.status = isAbort ? "aborted" : "failed";
          session.error = err instanceof Error ? err.message : String(err);
        });
      // Store as void promise — fire-and-forget, errors handled in .catch() above
      session.executionPromise = execPromise;
    } else {
      // Legacy path: no executor — mark running immediately; operator drives execution
      session.status = "running";
    }

    return { sessionId, accepted: true };
  }

  async pollStatus(sessionId: string): Promise<AdapterStatus> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { sessionId, status: "unknown" };
    }

    // When an executor is wired in, derive status directly from the session
    // field that the Promise callbacks keep up-to-date.
    return {
      sessionId,
      status: session.status,
      lastOutputAt: new Date().toISOString(),
      ...(session.error ? { progressSummary: `Error: ${session.error}` } : {}),
    };
  }

  async collectArtifacts(sessionId: string): Promise<AdapterArtifacts> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { sessionId, files: [], logs: [] };
    }
    const touchedFiles = session.touchedFiles ?? [];
    return {
      sessionId,
      // files shape is { path, content }[]; touched paths are surfaced in logs
      files: [],
      logs: [
        `Self-lane session ${sessionId} for run ${session.packet.runId}`,
        ...(touchedFiles.length > 0 ? [`Touched files: ${touchedFiles.join(", ")}`] : []),
        ...(session.error ? [`Error: ${session.error}`] : []),
      ],
    };
  }

  async collectPatch(sessionId: string): Promise<AdapterPatch | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    try {
      // Diff against the base branch to capture all commits in this worktree.
      // "git diff HEAD" only shows uncommitted changes (empty after commits).
      // "git diff <baseBranch>...HEAD" shows all commits since branching from base.
      const baseBranch = session.packet.baseBranch || "main";
      let diff = "";
      try {
        diff = execSync(`git diff ${baseBranch}...HEAD`, {
          cwd: session.packet.worktreePath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: GIT_TIMEOUT_MS,
        }).trim();
      } catch {
        // Fallback: base branch may not exist in this worktree — try uncommitted changes
        diff = execSync("git diff HEAD", {
          cwd: session.packet.worktreePath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: GIT_TIMEOUT_MS,
        }).trim();
      }

      const changedFiles = diff
        .split("\n")
        .filter((l) => l.startsWith("diff --git"))
        .map((l) => {
          const match = l.match(/b\/(.+)$/);
          return match?.[1] ?? "";
        })
        .filter(Boolean);

      // Resolve current branch for MergeBrain
      let sourceBranch: string | undefined;
      try {
        sourceBranch = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: session.packet.worktreePath,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: GIT_TIMEOUT_MS,
        }).trim();
      } catch {
        sourceBranch = session.packet.branch;
      }

      return { sessionId, unifiedDiff: diff, changedFiles, sourceBranch };
    } catch {
      return null;
    }
  }

  async detectRateLimit(_sessionId: string): Promise<RateLimitSignal> {
    // Self adapter never hits external rate limits
    return { detected: false, confidence: "none" };
  }

  /** Mark a session as completed. */
  markCompleted(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.status = "completed";
  }

  /** Mark a session as failed. */
  markFailed(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.status = "failed";
  }

  override async abortTask(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session?.abortController) {
      session.abortController.abort();
    }
  }
}
