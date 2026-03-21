// ============================================================================
// @dantecode/core — Codex Agent Adapter
// File-bridge adapter for OpenAI Codex CLI.
// Writes task packets as markdown files to a watched inbox directory,
// then polls for output in the outbox directory.
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

interface CodexSession {
  sessionId: string;
  inboxPath: string;
  outboxPath: string;
  branch: string;
  startedAt: number;
}

const STALL_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes without output = stalled

/**
 * Codex adapter using a file inbox/outbox bridge.
 * Priority: native-cli path preferred; falls back to file-bridge if not available.
 */
export class CodexAdapter extends BaseCouncilAdapter {
  readonly id = "codex" as const;
  readonly displayName = "OpenAI Codex";
  readonly kind = "file-bridge" as const;

  private readonly bridgeDir: string;
  private readonly sessions = new Map<string, CodexSession>();

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
    // File bridge has no direct cap visibility — return conservative estimate
    return { remainingCapacity: 70, capSuspicion: "low" };
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
      const donePath = join(session.outboxPath, "done.json");
      await stat(donePath);
      return { sessionId, status: "completed", lastOutputAt: new Date().toISOString() };
    } catch {
      // Not done — check for stall
    }

    try {
      const patchPath = join(session.outboxPath, "patch.diff");
      const patchStat = await stat(patchPath);
      const elapsed = Date.now() - patchStat.mtimeMs;
      if (elapsed > STALL_THRESHOLD_MS) {
        return { sessionId, status: "stalled", lastOutputAt: new Date(patchStat.mtimeMs).toISOString() };
      }
      return { sessionId, status: "running", lastOutputAt: new Date(patchStat.mtimeMs).toISOString() };
    } catch {
      const elapsed = Date.now() - session.startedAt;
      if (elapsed > STALL_THRESHOLD_MS) {
        return { sessionId, status: "stalled" };
      }
      return { sessionId, status: "pending" };
    }
  }

  async collectArtifacts(sessionId: string): Promise<AdapterArtifacts> {
    const session = this.sessions.get(sessionId);
    if (!session) return { sessionId, files: [], logs: [] };

    const logs: string[] = [];
    try {
      const logContent = await readFile(join(session.outboxPath, "output.log"), "utf-8");
      logs.push(logContent);
    } catch {
      // No log file
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
          const match = l.match(/b\/(.+)$/);
          return match?.[1] ?? "";
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
        reason: "No output for extended period — possible cap or stall",
      };
    }
    return { detected: false, confidence: "none" };
  }
}
