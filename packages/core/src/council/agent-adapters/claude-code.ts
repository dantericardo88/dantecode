// ============================================================================
// @dantecode/core — Claude Code Agent Adapter
// File-bridge adapter for Anthropic's Claude Code CLI.
// Claude Code has subscription caps that require active monitoring.
// ============================================================================

import { randomUUID } from "node:crypto";
import { writeFile, readFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { execSync } from "node:child_process";
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

const GIT_TIMEOUT_MS = 10_000;

interface ClaudeSession {
  sessionId: string;
  inboxPath: string;
  outboxPath: string;
  worktreePath: string;
  branch: string;
  startedAt: number;
  lastOutputAt?: number;
}

const CAP_SIGNALS = [
  "claude.ai/upgrade",
  "rate limit",
  "usage limit",
  "subscription",
  "too many requests",
  "429",
];

const STALL_THRESHOLD_MS = 4 * 60 * 1000; // 4 minutes — Claude caps degrade output fast

/**
 * Claude Code file-bridge adapter.
 * Writes task packets to a watched directory; Claude Code picks them up
 * and writes results to the outbox directory.
 *
 * When no formal CLI integration exists, this falls back to detecting
 * cap signals in log files written by the Claude Code process.
 */
export class ClaudeCodeAdapter extends BaseCouncilAdapter {
  readonly id = "claude-code" as const;
  readonly displayName = "Claude Code";
  readonly kind = "file-bridge" as const;

  private readonly bridgeDir: string;
  private readonly sessions = new Map<string, ClaudeSession>();

  constructor(bridgeDir: string) {
    super();
    this.bridgeDir = bridgeDir;
  }

  async probeAvailability(): Promise<AdapterAvailability> {
    // Check if claude CLI is on PATH
    try {
      execSync("claude --version", { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
      return { available: true, health: "ready" };
    } catch {
      // Fall back to file-bridge availability check
      try {
        await stat(this.bridgeDir);
        return { available: true, health: "degraded", reason: "CLI not found; using file bridge" };
      } catch {
        return {
          available: false,
          health: "offline",
          reason: "Claude Code CLI not found and bridge directory missing",
        };
      }
    }
  }

  async estimateCapacity(): Promise<AdapterCapacity> {
    // Claude Code subscription caps are not queryable — use log heuristics
    return { remainingCapacity: 60, capSuspicion: "low" };
  }

  async submitTask(packet: CouncilTaskPacket): Promise<AdapterSubmission> {
    const sessionId = randomUUID().slice(0, 12);
    const inboxDir = join(this.bridgeDir, "inbox", sessionId);
    const outboxDir = join(this.bridgeDir, "outbox", sessionId);

    try {
      await mkdir(inboxDir, { recursive: true });
      await mkdir(outboxDir, { recursive: true });

      const prompt = this.buildTaskPrompt(packet);
      await writeFile(join(inboxDir, "task.md"), prompt, "utf-8");
      await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet, null, 2), "utf-8");

      this.sessions.set(sessionId, {
        sessionId,
        inboxPath: inboxDir,
        outboxPath: outboxDir,
        worktreePath: packet.worktreePath,
        branch: packet.branch,
        startedAt: Date.now(),
      });

      return { sessionId, accepted: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { sessionId, accepted: false, reason: msg };
    }
  }

  async pollStatus(sessionId: string): Promise<AdapterStatus> {
    const session = this.sessions.get(sessionId);
    if (!session) return { sessionId, status: "unknown" };

    try {
      await stat(join(session.outboxPath, "done.json"));
      return { sessionId, status: "completed", lastOutputAt: new Date().toISOString() };
    } catch {
      // Not done
    }

    // Check for cap signals in output log
    try {
      const log = await readFile(join(session.outboxPath, "output.log"), "utf-8");
      const lower = log.toLowerCase();
      if (CAP_SIGNALS.some((sig) => lower.includes(sig))) {
        return { sessionId, status: "capped", progressSummary: "Cap signal detected in output" };
      }
      const logStat = await stat(join(session.outboxPath, "output.log"));
      session.lastOutputAt = logStat.mtimeMs;
    } catch {
      // No log yet
    }

    const elapsed = Date.now() - (session.lastOutputAt ?? session.startedAt);
    if (elapsed > STALL_THRESHOLD_MS) {
      return { sessionId, status: "stalled", progressSummary: "No output for extended period" };
    }

    return {
      sessionId,
      status: "running",
      lastOutputAt: session.lastOutputAt ? new Date(session.lastOutputAt).toISOString() : undefined,
    };
  }

  async collectArtifacts(sessionId: string): Promise<AdapterArtifacts> {
    const session = this.sessions.get(sessionId);
    if (!session) return { sessionId, files: [], logs: [] };

    const logs: string[] = [];
    try {
      const logContent = await readFile(join(session.outboxPath, "output.log"), "utf-8");
      logs.push(logContent);
    } catch {
      // No log
    }

    return { sessionId, files: [], logs };
  }

  async collectPatch(sessionId: string): Promise<AdapterPatch | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // First try explicit patch file
    try {
      const diff = await readFile(join(session.outboxPath, "patch.diff"), "utf-8");
      return {
        sessionId,
        unifiedDiff: diff,
        changedFiles: this.extractChangedFiles(diff),
      };
    } catch {
      // No patch file — try git diff in worktree
    }

    try {
      const diff = execSync("git diff HEAD", {
        cwd: session.worktreePath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: GIT_TIMEOUT_MS,
      }).trim();

      if (!diff) return null;
      return {
        sessionId,
        unifiedDiff: diff,
        changedFiles: this.extractChangedFiles(diff),
        sourceBranch: session.branch,
      };
    } catch {
      return null;
    }
  }

  async detectRateLimit(sessionId: string): Promise<RateLimitSignal> {
    const status = await this.pollStatus(sessionId);
    if (status.status === "capped") {
      return {
        detected: true,
        confidence: "high",
        reason: "Cap signal found in output logs",
        retryAfterMs: 60 * 60 * 1000, // suggest 1 hour cooldown
      };
    }
    if (status.status === "stalled") {
      return {
        detected: true,
        confidence: "medium",
        reason: "No output for extended period — possible silent cap",
        retryAfterMs: 30 * 60 * 1000,
      };
    }
    return { detected: false, confidence: "none" };
  }

  private extractChangedFiles(diff: string): string[] {
    return diff
      .split("\n")
      .filter((l) => l.startsWith("diff --git"))
      .map((l) => {
        const match = l.match(/b\/(.+)$/);
        return match?.[1] ?? "";
      })
      .filter(Boolean);
  }
}
