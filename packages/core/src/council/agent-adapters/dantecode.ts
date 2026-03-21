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

interface SelfSession {
  sessionId: string;
  packet: CouncilTaskPacket;
  startedAt: number;
  status: "pending" | "running" | "completed" | "failed";
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
    this.sessions.set(sessionId, {
      sessionId,
      packet,
      startedAt: Date.now(),
      status: "pending",
    });
    // Mark running immediately — actual execution is handled by the agent loop
    const session = this.sessions.get(sessionId)!;
    session.status = "running";
    return { sessionId, accepted: true };
  }

  async pollStatus(sessionId: string): Promise<AdapterStatus> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { sessionId, status: "unknown" };
    }
    return {
      sessionId,
      status: session.status,
      lastOutputAt: new Date().toISOString(),
    };
  }

  async collectArtifacts(sessionId: string): Promise<AdapterArtifacts> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { sessionId, files: [], logs: [] };
    }
    return {
      sessionId,
      files: [],
      logs: [`Self-lane session ${sessionId} for run ${session.packet.runId}`],
    };
  }

  async collectPatch(sessionId: string): Promise<AdapterPatch | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    try {
      const diff = execSync("git diff HEAD", {
        cwd: session.packet.worktreePath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: GIT_TIMEOUT_MS,
      }).trim();

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
}
