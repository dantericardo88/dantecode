// ============================================================================
// @dantecode/core — Council Handoff Engine
// Creates, validates, serializes, and consumes HandoffPacket objects.
// Solves the usage-cap problem: work does not die when an agent stops.
// ============================================================================

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import type { HandoffPacket, AgentKind } from "./council-types.js";
import { newHandoffId } from "./council-types.js";
import type { AgentSessionState } from "./council-types.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface HandoffCreationOptions {
  session: AgentSessionState;
  reason: HandoffPacket["reason"];
  diffSummary?: string;
  completedChecks?: string[];
  pendingTests?: string[];
  openQuestions?: string[];
  assumptions?: string[];
  blockerReason?: string;
  recommendedNextAgent?: AgentKind;
}

export interface HandoffValidationResult {
  valid: boolean;
  errors: string[];
}

// ----------------------------------------------------------------------------
// HandoffEngine
// ----------------------------------------------------------------------------

/**
 * Creates, validates, persists, and loads HandoffPacket objects.
 *
 * Hard rules from PRD:
 * - No handoff packet may omit touched files or pending tests.
 * - Packets are persisted to the council run directory.
 * - Packets must be rehydratable by any supported agent adapter.
 */
export class HandoffEngine {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
  }

  // --------------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------------

  /**
   * Build a HandoffPacket from a session state.
   * Automatically computes the current diff if not provided.
   */
  createPacket(options: HandoffCreationOptions): HandoffPacket {
    const { session, reason } = options;

    const diffSummary = options.diffSummary ?? this.computeDiffSummary(session.worktreePath);

    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: session.laneId,
      reason,
      createdAt: new Date().toISOString(),
      objective: session.objective,
      branch: session.branch,
      worktreePath: session.worktreePath,
      touchedFiles: session.touchedFiles,
      diffSummary,
      assumptions: options.assumptions ?? [],
      completedChecks: options.completedChecks ?? [],
      pendingTests: options.pendingTests ?? [],
      openQuestions: options.openQuestions ?? [],
      recommendedNextAgent: options.recommendedNextAgent,
      blockerReason: options.blockerReason,
    };

    return packet;
  }

  // --------------------------------------------------------------------------
  // Validate
  // --------------------------------------------------------------------------

  /**
   * Validate that a packet is complete enough for a replacement agent to use.
   * Hard gates from PRD: must not omit touched files or pending tests.
   */
  validate(packet: HandoffPacket): HandoffValidationResult {
    const errors: string[] = [];

    if (!packet.objective || packet.objective.trim().length === 0) {
      errors.push("objective is required");
    }
    if (!packet.branch || packet.branch.trim().length === 0) {
      errors.push("branch is required");
    }
    if (!packet.worktreePath || packet.worktreePath.trim().length === 0) {
      errors.push("worktreePath is required");
    }
    // PRD hard gate: touched files must not be omitted
    if (!Array.isArray(packet.touchedFiles)) {
      errors.push("touchedFiles must be an array (may be empty)");
    }
    // PRD hard gate: pending tests must not be omitted
    if (!Array.isArray(packet.pendingTests)) {
      errors.push("pendingTests must be an array (may be empty)");
    }
    if (!packet.id || !packet.laneId || !packet.reason || !packet.createdAt) {
      errors.push("id, laneId, reason, and createdAt are required");
    }

    return { valid: errors.length === 0, errors };
  }

  // --------------------------------------------------------------------------
  // Persist / load
  // --------------------------------------------------------------------------

  /** Persist a packet to <repoRoot>/.dantecode/council/<runId>/handoffs/<id>.json */
  async savePacket(runId: string, packet: HandoffPacket): Promise<string> {
    const path = join(
      this.repoRoot,
      ".dantecode",
      "council",
      runId,
      "handoffs",
      `${packet.id}.json`,
    );
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(packet, null, 2), "utf-8");
    return path;
  }

  /** Load a packet from disk. */
  async loadPacket(runId: string, packetId: string): Promise<HandoffPacket> {
    const path = join(
      this.repoRoot,
      ".dantecode",
      "council",
      runId,
      "handoffs",
      `${packetId}.json`,
    );
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as HandoffPacket;
  }

  /** Try to load a packet, returning null if not found. */
  async tryLoadPacket(runId: string, packetId: string): Promise<HandoffPacket | null> {
    try {
      return await this.loadPacket(runId, packetId);
    } catch {
      return null;
    }
  }

  // --------------------------------------------------------------------------
  // Redact
  // --------------------------------------------------------------------------

  /**
   * Redact any secrets from a packet before passing it to an external adapter.
   * Simple heuristic: replace values that look like tokens or keys.
   */
  redactSecrets(packet: HandoffPacket): HandoffPacket {
    const SECRET_RE =
      /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|xoxb-[A-Za-z0-9-]+|AIza[A-Za-z0-9_-]+|AKIA[A-Za-z0-9]+)\b/g;

    const redact = (s: string) => s.replace(SECRET_RE, "[REDACTED]");

    return {
      ...packet,
      objective: redact(packet.objective),
      diffSummary: redact(packet.diffSummary),
      assumptions: packet.assumptions.map(redact),
      completedChecks: packet.completedChecks.map(redact),
      pendingTests: packet.pendingTests.map(redact),
      openQuestions: packet.openQuestions.map(redact),
      blockerReason: packet.blockerReason ? redact(packet.blockerReason) : undefined,
    };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private computeDiffSummary(worktreePath: string): string {
    try {
      const diff = execSync("git diff HEAD --stat", {
        cwd: worktreePath,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 1024 * 1024,
      }).trim();
      return diff || "(no uncommitted changes)";
    } catch {
      return "(could not compute diff)";
    }
  }
}
