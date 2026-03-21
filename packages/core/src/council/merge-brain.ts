// ============================================================================
// @dantecode/core — Council Merge Brain
// Collects candidate patches from multiple lanes and synthesizes a canonical
// merged result. Preserves originals, scores confidence, and records audit.
// ============================================================================

import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/** Timeout for a single git merge operation (ms). */
const MERGE_TIMEOUT_MS = 30_000;
import type { FinalSynthesisRecord, MergeDecision } from "./council-types.js";
import { MergeConfidenceScorer, type MergeCandidatePatch } from "./merge-confidence.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface MergeBrainInput {
  runId: string;
  candidates: MergeCandidatePatch[];
  /** Absolute path to the main working tree (for applying merges). */
  repoRoot: string;
  /** Branch to merge into. */
  targetBranch: string;
  /** Whether to allow auto-merge on high confidence. Default true. */
  allowAutoMerge?: boolean;
  /** Path where audit bundles should be written. */
  auditDir?: string;
}

export interface MergeBrainResult {
  success: boolean;
  synthesis: FinalSynthesisRecord;
  error?: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function git(args: string, cwd: string, timeoutMs = 10_000): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
      timeout: timeoutMs,
    }).trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string; signal?: string };
    if (e.signal === "SIGTERM") {
      throw new Error(`git operation timed out after ${timeoutMs}ms`);
    }
    throw new Error((e.stderr ?? e.message ?? "git error").trim());
  }
}

/**
 * Attempt a structural (non-semantic) merge of two patches by applying each
 * to the target branch and letting git resolve non-conflicting hunks.
 * Returns the merged diff, or null if conflicts remain.
 */
function tryStructuralMerge(
  repoRoot: string,
  _branchA: string,
  branchB: string,
): { success: boolean; conflicts: string[] } {
  try {
    // Try a fast-forward merge with timeout guard
    git(`merge "${branchB}" --no-commit --no-ff`, repoRoot, MERGE_TIMEOUT_MS);

    // Check for remaining conflicts
    const conflictedRaw = git("diff --name-only --diff-filter=U", repoRoot);
    const conflicted = conflictedRaw ? conflictedRaw.split("\n").filter(Boolean) : [];

    if (conflicted.length === 0) {
      return { success: true, conflicts: [] };
    }

    // Abort the merge — conflicts need semantic synthesis
    try {
      git("merge --abort", repoRoot);
    } catch {
      // ignore abort errors
    }
    return { success: false, conflicts: conflicted };
  } catch {
    try {
      git("merge --abort", repoRoot);
    } catch {
      // ignore
    }
    return { success: false, conflicts: [] };
  }
}

// ----------------------------------------------------------------------------
// MergeBrain
// ----------------------------------------------------------------------------

/**
 * The core synthesis and merge decision engine.
 *
 * Pipeline:
 * 1. Collect candidate patches
 * 2. Score confidence (MergeConfidenceScorer)
 * 3. Attempt structural merge if confidence >= medium
 * 4. If blocked: preserve originals and emit review-required record
 * 5. Produce audit bundle
 */
export class MergeBrain {
  private readonly scorer = new MergeConfidenceScorer();

  async synthesize(input: MergeBrainInput): Promise<MergeBrainResult> {
    const { runId, candidates, repoRoot, targetBranch, allowAutoMerge = true } = input;
    const auditDir = input.auditDir ?? join(repoRoot, ".dantecode", "council", runId, "audits");

    const confidence = this.scorer.score(candidates);

    // Preserve all original candidate patches
    const preservedCandidates: Record<string, string> = {};
    for (const c of candidates) {
      preservedCandidates[c.laneId] = c.unifiedDiff;
    }

    const synthesisId = `synth-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const auditBundlePath = join(auditDir, `${synthesisId}.json`);

    // Build synthesis record
    const synthesis: FinalSynthesisRecord = {
      id: synthesisId,
      councilRunId: runId,
      candidateLanes: candidates.map((c) => c.laneId),
      mergedPatch: "",
      rationale: confidence.reasoning,
      preservedCandidates,
      confidence: confidence.bucket,
      decision: confidence.decision,
      verificationPassed: false,
      auditBundlePath,
      createdAt: new Date().toISOString(),
    };

    // Decision routing
    if (confidence.decision === "blocked") {
      synthesis.mergedPatch = this.formatBlockedPlaceholder(candidates, confidence.reasoning);
      await this.writeAuditBundle(auditBundlePath, synthesis, confidence, []);
      return { success: false, synthesis, error: `Merge blocked: ${confidence.reasoning}` };
    }

    // Attempt structural merge for medium/high confidence with multiple candidates
    if (candidates.length >= 2) {
      const branchA = this.extractBranchFromPatch(candidates[0]!);
      const branchB = this.extractBranchFromPatch(candidates[1]!);

      if (branchA && branchB) {
        const structuralResult = tryStructuralMerge(repoRoot, branchA, branchB);
        if (structuralResult.success) {
          try {
            synthesis.mergedPatch = git(`diff ${targetBranch} HEAD`, repoRoot);
            synthesis.decision = "auto-merge";
            synthesis.verificationPassed = true;
          } catch {
            synthesis.mergedPatch = candidates[0]!.unifiedDiff;
          }
        } else {
          // Structural merge failed — require review
          synthesis.decision = "review-required" satisfies MergeDecision;
          synthesis.mergedPatch = this.formatConflictSummary(
            candidates,
            structuralResult.conflicts,
          );
        }
      } else {
        // No branch info — use first candidate
        synthesis.mergedPatch = candidates[0]!.unifiedDiff;
      }
    } else if (candidates.length === 1) {
      synthesis.mergedPatch = candidates[0]!.unifiedDiff;
      synthesis.verificationPassed = confidence.score >= 60;
    }

    // Auto-merge gate: only execute if confidence is high AND explicitly allowed
    if (synthesis.decision === "auto-merge" && !allowAutoMerge) {
      synthesis.decision = "review-required";
    }

    await this.writeAuditBundle(auditBundlePath, synthesis, confidence, candidates);

    return {
      success: synthesis.decision !== "blocked",
      synthesis,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private extractBranchFromPatch(candidate: MergeCandidatePatch): string | null {
    return candidate.sourceBranch ?? null;
  }

  private formatBlockedPlaceholder(candidates: MergeCandidatePatch[], reason: string): string {
    return [
      `# Merge Blocked`,
      ``,
      `Reason: ${reason}`,
      ``,
      `## Candidate patches (preserved):`,
      ...candidates.map((c) => `### Lane: ${c.laneId}\n${c.unifiedDiff.slice(0, 500)}...`),
    ].join("\n");
  }

  private formatConflictSummary(candidates: MergeCandidatePatch[], conflicts: string[]): string {
    return [
      `# Merge Requires Review`,
      ``,
      `Conflicted files: ${conflicts.join(", ")}`,
      ``,
      `## Candidate A (Lane ${candidates[0]?.laneId ?? "unknown"}):`,
      candidates[0]?.unifiedDiff.slice(0, 1000) ?? "(no patch)",
      ``,
      `## Candidate B (Lane ${candidates[1]?.laneId ?? "unknown"}):`,
      candidates[1]?.unifiedDiff.slice(0, 1000) ?? "(no patch)",
    ].join("\n");
  }

  private async writeAuditBundle(
    path: string,
    synthesis: FinalSynthesisRecord,
    confidence: ReturnType<MergeConfidenceScorer["score"]>,
    candidates: MergeCandidatePatch[],
  ): Promise<void> {
    try {
      await mkdir(dirname(path), { recursive: true });
      const bundle = {
        synthesis,
        confidence,
        candidateSummaries: candidates.map((c) => ({
          laneId: c.laneId,
          changedFiles: c.changedFiles,
          passedTests: c.passedTests ?? [],
          failedTests: c.failedTests ?? [],
        })),
        writtenAt: new Date().toISOString(),
      };
      await writeFile(path, JSON.stringify(bundle, null, 2), "utf-8");
    } catch {
      // Non-fatal — audit write failure should not block the run
    }
  }
}
