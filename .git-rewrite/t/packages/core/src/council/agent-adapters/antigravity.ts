// ============================================================================
// @dantecode/core — Antigravity / Gemini Agent Adapter
// File-bridge adapter for Antigravity (Google Gemini-based coding agent).
// ============================================================================

import { randomUUID } from "node:crypto";
import { writeFile, readFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
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

interface AntigravitySession {
  sessionId: string;
  inboxPath: string;
  outboxPath: string;
  branch: string;
  startedAt: number;
  lastOutputAt?: number;
}

const STALL_THRESHOLD_MS = 6 * 60 * 1000; // 6 minutes — Gemini can be slower

/**
 * Antigravity/Gemini file-bridge adapter.
 * Long-context tasks are Antigravity's strength; route accordingly.
 */
export class AntigravityAdapter extends BaseCouncilAdapter {
  readonly id = "antigravity" as const;
  readonly displayName = "Antigravity / Gemini";
  readonly kind = "file-bridge" as const;

  private readonly bridgeDir: string;
  private readonly sessions = new Map<string, AntigravitySession>();

  constructor(bridgeDir: string) {
    super();
    this.bridgeDir = bridgeDir;
  }

  async probeAvailability(): Promise<AdapterAvailability> {
    try {
      await stat(this.bridgeDir);
      return { available: true, health: "ready" };
    } catch {
      return {
        available: false,
        health: "offline",
        reason: `Bridge directory not found: ${this.bridgeDir}`,
      };
    }
  }

  async estimateCapacity(): Promise<AdapterCapacity> {
    return { remainingCapacity: 75, capSuspicion: "low" };
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

    try {
      const logStat = await stat(join(session.outboxPath, "output.log"));
      session.lastOutputAt = logStat.mtimeMs;
    } catch {
      // No log
    }

    const elapsed = Date.now() - (session.lastOutputAt ?? session.startedAt);
    if (elapsed > STALL_THRESHOLD_MS) {
      return { sessionId, status: "stalled" };
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

    try {
      const diff = await readFile(join(session.outboxPath, "patch.diff"), "utf-8");
      const changedFiles = diff
        .split("\n")
        .filter((l) => l.startsWith("diff --git"))
        .map((l) => {
          const m = l.match(/b\/(.+)$/);
          return m?.[1] ?? "";
        })
        .filter(Boolean);

      return { sessionId, unifiedDiff: diff, changedFiles, sourceBranch: session.branch };
    } catch {
      return null;
    }
  }

  async detectRateLimit(sessionId: string): Promise<RateLimitSignal> {
    const status = await this.pollStatus(sessionId);
    if (status.status === "stalled") {
      return {
        detected: true,
        confidence: "medium",
        reason: "No output for extended period",
        retryAfterMs: 30 * 60 * 1000,
      };
    }
    return { detected: false, confidence: "none" };
  }
}
