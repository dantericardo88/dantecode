// ============================================================================
// @dantecode/core — FileBridge Adapter
// Human-in-the-loop adapter. Submits tasks as JSON files to a directory and
// polls for result files. Enables any external agent (human, Codex, etc.)
// to participate in a council run by reading/writing files.
// ============================================================================

import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
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

/**
 * Human-in-the-loop file-bridge adapter.
 *
 * Protocol:
 *   SUBMIT:  writes {bridgeDir}/inbox/{sessionId}/task.md + packet.json
 *   STATUS:  polls {bridgeDir}/outbox/{sessionId}/done.json
 *   PATCH:   reads  {bridgeDir}/outbox/{sessionId}/patch.diff
 *
 * The external agent (human or tool) writes done.json and patch.diff
 * to signal completion. The `bridge-listen` CLI command guides humans
 * through this process.
 */
export class FileBridgeAdapter extends BaseCouncilAdapter {
  readonly id = "custom" as const;
  readonly displayName = "FileBridge (human-in-loop)";
  readonly kind = "file-bridge" as const;

  constructor(private readonly bridgeDir: string) {
    super();
  }

  async probeAvailability(): Promise<AdapterAvailability> {
    return { available: true, health: "ready" };
  }

  async estimateCapacity(): Promise<AdapterCapacity> {
    return { remainingCapacity: 100, capSuspicion: "none" };
  }

  async submitTask(packet: CouncilTaskPacket): Promise<AdapterSubmission> {
    const sessionId = randomUUID().slice(0, 12);
    const sessionDir = join(this.bridgeDir, "inbox", sessionId);
    await mkdir(sessionDir, { recursive: true });
    // Write task.md (markdown prompt) and packet.json (raw packet) — same protocol as BridgeListener expects
    const taskMd = this.buildTaskPrompt(packet);
    await Promise.all([
      writeFile(join(sessionDir, "task.md"), taskMd, "utf-8"),
      writeFile(join(sessionDir, "packet.json"), JSON.stringify(packet, null, 2), "utf-8"),
    ]);
    return { sessionId, accepted: true };
  }

  async pollStatus(sessionId: string): Promise<AdapterStatus> {
    const resultPath = join(this.bridgeDir, "outbox", sessionId, "done.json");
    try {
      const raw = await readFile(resultPath, "utf-8");
      const result = JSON.parse(raw) as { success: boolean; exitCode?: number; error?: string };
      return {
        sessionId,
        status: result.success ? "completed" : "failed",
        lastOutputAt: new Date().toISOString(),
        ...(result.error ? { error: result.error } : {}),
      };
    } catch {
      // done.json not present yet — still running
      return { sessionId, status: "running" };
    }
  }

  async collectArtifacts(sessionId: string): Promise<AdapterArtifacts> {
    return {
      sessionId,
      files: [],
      logs: [`FileBridge session ${sessionId} inbox: ${join(this.bridgeDir, "inbox", sessionId)}`],
    };
  }

  async collectPatch(sessionId: string): Promise<AdapterPatch | null> {
    const patchPath = join(this.bridgeDir, "outbox", sessionId, "patch.diff");
    try {
      const diff = await readFile(patchPath, "utf-8");
      return {
        sessionId,
        unifiedDiff: diff,
        changedFiles: diff
          .split("\n")
          .filter((l) => l.startsWith("diff --git"))
          .map((l) => l.match(/b\/(.+)$/)?.[1] ?? "")
          .filter(Boolean),
        sourceBranch: undefined,
      };
    } catch {
      return null;
    }
  }

  async detectRateLimit(_sessionId: string): Promise<RateLimitSignal> {
    return { detected: false, confidence: "none" };
  }

  /** Path where the external agent should write done.json */
  getResultPath(sessionId: string): string {
    return join(this.bridgeDir, "outbox", sessionId, "done.json");
  }

  /** Path where the external agent should write patch.diff */
  getPatchPath(sessionId: string): string {
    return join(this.bridgeDir, "outbox", sessionId, "patch.diff");
  }
}
