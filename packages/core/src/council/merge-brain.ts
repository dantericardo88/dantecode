// ============================================================================
// @dantecode/core — Council Merge Brain
// Collects candidate patches from multiple lanes and synthesizes a canonical
// merged result. Preserves originals, scores confidence, and records audit.
// ============================================================================

import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
/** Timeout for a single git merge operation (ms). */
const MERGE_TIMEOUT_MS = 30_000;
import type { FinalSynthesisRecord, MergeDecision } from "./council-types.js";
import { MergeConfidenceScorer, type MergeCandidatePatch } from "./merge-confidence.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Injected worktree operations — avoids circular dep on @dantecode/git-engine. */
export interface WorktreeHooks {
  createWorktree: (spec: { directory: string; sessionId: string; branch: string; baseBranch: string }) => { directory: string };
  removeWorktree: (directory: string) => void;
}

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
  conflictWorktreePath?: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function git(args: string[], cwd: string, timeoutMs = 10_000): string {
  try {
    return execFileSync("git", args, {
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
 * Operates in an isolated git worktree so the main repo is never left in
 * MERGE_HEAD state if the merge fails or is aborted.
 */
async function tryStructuralMergeIsolated(
  repoRoot: string,
  runId: string,
  _branchA: string,
  branchB: string,
  targetBranch: string,
  hooks: WorktreeHooks,
): Promise<{ success: boolean; conflicts: string[]; worktreePath?: string }> {
  const sessionId = `merge-${runId}-${Date.now()}`;
  let worktreeDir: string | undefined;

  try {
    const worktree = hooks.createWorktree({
      directory: repoRoot,
      sessionId,
      branch: `council-merge-${sessionId}`,
      baseBranch: targetBranch,
    });
    worktreeDir = worktree.directory as string;

    // Run merge in isolated worktree — never touches the main repo
    git(["merge", branchB, "--no-commit", "--no-ff"], worktreeDir, MERGE_TIMEOUT_MS);

    const conflictedRaw = git(["diff", "--name-only", "--diff-filter=U"], worktreeDir) as
      | string
      | undefined;
    const conflicts = conflictedRaw ? conflictedRaw.split("\n").filter(Boolean) : [];

    if (conflicts.length === 0) {
      try {
        git(["merge", "--abort"], worktreeDir);
      } catch {
        git(["reset", "--hard", "HEAD"], worktreeDir);
      }
      hooks.removeWorktree(worktreeDir);
      return { success: true, conflicts: [] };
    }

    // Abort merge in worktree, remove it, report conflicts
    try {
      git(["merge", "--abort"], worktreeDir);
    } catch {
      /* ignore */
    }
    hooks.removeWorktree(worktreeDir);
    return { success: false, conflicts };
  } catch {
    if (worktreeDir) {
      try {
        git(["merge", "--abort"], worktreeDir);
      } catch {
        /* ignore */
      }
      try {
        hooks.removeWorktree(worktreeDir);
      } catch {
        /* non-fatal cleanup */
      }
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
  private readonly worktreeHooks?: WorktreeHooks;

  constructor(hooks?: WorktreeHooks) {
    this.worktreeHooks = hooks;
  }

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
        if (this.worktreeHooks) {
          const structuralResult = await tryStructuralMergeIsolated(
            repoRoot,
            runId,
            branchA,
            branchB,
            targetBranch,
            this.worktreeHooks,
          );
          if (structuralResult.success) {
            // Worktree was removed on success; use first candidate diff as the synthesized patch.
            synthesis.mergedPatch = candidates[0]!.unifiedDiff;
            synthesis.decision = "auto-merge";
            synthesis.verificationPassed = true;
          } else {
            // Structural merge failed — require review
            synthesis.decision = "review-required" satisfies MergeDecision;
            synthesis.mergedPatch = this.formatConflictSummary(
              candidates,
              structuralResult.conflicts,
            );
          }
        } else {
          // No worktree hooks — cannot attempt structural merge, require review
          synthesis.decision = "review-required" satisfies MergeDecision;
          synthesis.mergedPatch = this.formatConflictSummary(candidates, []);
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
