// ============================================================================
// @dantecode/core — SessionProofSynthesizer (Sprint BS — dim 11)
// Synthesizes session completion proofs from recorded artifacts,
// providing verifiable evidence of what a session accomplished.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface SessionArtifact {
  type: "file_written" | "test_passed" | "git_commit" | "tool_result" | "pr_created";
  path?: string;
  description: string;
  timestamp: string;
}

export interface SessionProof {
  sessionId: string;
  taskDescription: string;
  artifacts: SessionArtifact[];
  verifiedAt: string;
  completionConfidence: number; // 0-1 based on artifact count and types
  summary: string; // 1-2 sentence human-readable summary
}

const PROOF_LOG_FILE = ".danteforge/session-proof-log.json";

export function synthesizeSessionProof(
  sessionId: string,
  taskDescription: string,
  artifacts: SessionArtifact[],
): SessionProof {
  // Compute completionConfidence
  let confidence = 0.0;

  // +0.2 per file_written, max 0.4
  const fileWrittenCount = artifacts.filter((a) => a.type === "file_written").length;
  confidence += Math.min(fileWrittenCount * 0.2, 0.4);

  // +0.2 if any test_passed
  if (artifacts.some((a) => a.type === "test_passed")) {
    confidence += 0.2;
  }

  // +0.2 if any git_commit
  if (artifacts.some((a) => a.type === "git_commit")) {
    confidence += 0.2;
  }

  // +0.1 if any pr_created
  if (artifacts.some((a) => a.type === "pr_created")) {
    confidence += 0.1;
  }

  // cap at 1.0
  confidence = Math.min(confidence, 1.0);
  // Round to avoid floating point noise
  confidence = Math.round(confidence * 100) / 100;

  // Build summary: top 2 artifact types present
  const typeCounts: Record<string, number> = {};
  for (const a of artifacts) {
    typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1;
  }
  const topTypes = Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([t]) => t)
    .join(", ");

  const summary =
    artifacts.length === 0
      ? `Session ${sessionId} completed 0 artifact(s). None.`
      : `Session ${sessionId} completed ${artifacts.length} artifact(s). ${topTypes}.`;

  return {
    sessionId,
    taskDescription,
    artifacts,
    verifiedAt: new Date().toISOString(),
    completionConfidence: confidence,
    summary,
  };
}

export function recordSessionProof(proof: SessionProof, projectRoot?: string): void {
  const root = projectRoot ?? resolve(process.cwd());
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(join(root, PROOF_LOG_FILE), JSON.stringify(proof) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
}

export function loadSessionProofs(projectRoot?: string): SessionProof[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, PROOF_LOG_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SessionProof);
  } catch {
    return [];
  }
}

export interface SessionProofStats {
  totalSessions: number;
  avgConfidence: number;
  highConfidenceSessions: number; // confidence >= 0.7
  totalArtifacts: number;
}

export function getSessionProofStats(proofs: SessionProof[]): SessionProofStats {
  if (proofs.length === 0) {
    return { totalSessions: 0, avgConfidence: 0, highConfidenceSessions: 0, totalArtifacts: 0 };
  }
  const totalSessions = proofs.length;
  const avgConfidence =
    Math.round((proofs.reduce((s, p) => s + p.completionConfidence, 0) / totalSessions) * 100) /
    100;
  const highConfidenceSessions = proofs.filter((p) => p.completionConfidence >= 0.7).length;
  const totalArtifacts = proofs.reduce((s, p) => s + p.artifacts.length, 0);
  return { totalSessions, avgConfidence, highConfidenceSessions, totalArtifacts };
}
