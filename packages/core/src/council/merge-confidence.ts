// ============================================================================
// @dantecode/core — Merge Confidence Scorer
// Scores candidate merge patches to decide whether auto-merge is safe.
// ============================================================================

import type { MergeConfidenceBucket, MergeDecision } from "./council-types.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface MergeCandidatePatch {
  laneId: string;
  unifiedDiff: string;
  changedFiles: string[];
  /** Source branch name — used by MergeBrain for structural merges. */
  sourceBranch?: string;
  /** Tests the lane reported passing (optional). */
  passedTests?: string[];
  /** Tests still pending or failing. */
  failedTests?: string[];
}

export interface ConfidenceFactors {
  /** 0-1 — how structurally safe the merge is (no hunk overlap). */
  structuralSafety: number;
  /** 0-1 — test coverage (1 = all tests pass, 0 = failures present). */
  testCoverage: number;
  /** 0-1 — whether the candidates have compatible intent. */
  intentCompatibility: number;
  /** 0-1 — whether contract/API surfaces are preserved. */
  contractPreservation: number;
}

export interface MergeConfidenceScore {
  bucket: MergeConfidenceBucket;
  decision: MergeDecision;
  /** 0-100 composite confidence score. */
  score: number;
  factors: ConfidenceFactors;
  reasoning: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Detect hunk overlap between two patches.
 * Returns 0-1 where 0 = full overlap (dangerous), 1 = no overlap (safe).
 */
function computeStructuralSafety(patchA: string, patchB: string): number {
  const hunksA = extractHunkHeaders(patchA);
  const hunksB = extractHunkHeaders(patchB);

  if (hunksA.length === 0 && hunksB.length === 0) return 1.0;

  let overlap = 0;
  for (const hA of hunksA) {
    for (const hB of hunksB) {
      if (hA.file === hB.file && rangesOverlap(hA.start, hA.end, hB.start, hB.end)) {
        overlap++;
      }
    }
  }

  const total = Math.max(hunksA.length, hunksB.length);
  if (total === 0) return 1.0;
  return Math.max(0, 1 - overlap / total);
}

interface HunkHeader {
  file: string;
  start: number;
  end: number;
}

function extractHunkHeaders(patch: string): HunkHeader[] {
  const result: HunkHeader[] = [];
  let currentFile = "";

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/);
      currentFile = match?.[1] ?? "";
    } else if (line.startsWith("@@")) {
      // @@ -a,b +c,d @@
      const match = line.match(/@@ [+-](\d+)(?:,(\d+))? [+-](\d+)(?:,(\d+))? @@/);
      if (match && currentFile) {
        const newStart = parseInt(match[3]!, 10);
        const newLen = parseInt(match[4] ?? "1", 10);
        result.push({ file: currentFile, start: newStart, end: newStart + newLen });
      }
    }
  }

  return result;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Compute test coverage score from passed/failed test lists.
 */
function computeTestCoverage(candidates: MergeCandidatePatch[]): number {
  const totalPassed = candidates.reduce((s, c) => s + (c.passedTests?.length ?? 0), 0);
  const totalFailed = candidates.reduce((s, c) => s + (c.failedTests?.length ?? 0), 0);

  if (totalPassed + totalFailed === 0) return 0.7; // unknown — assume partial
  return totalPassed / (totalPassed + totalFailed);
}

/**
 * Compute contract preservation score by detecting export symbol conflicts.
 * A conflict occurs when one patch removes a symbol that another patch adds
 * (rename/rewrite collision) or both patches modify the same exported symbol.
 *
 * Uses regex extraction from unified diff lines — no AST required.
 */
function computeContractPreservation(candidates: MergeCandidatePatch[]): number {
  if (candidates.length < 2) return 1.0;

  const ADDED_EXPORT_RE =
    /^\+export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/gm;
  const REMOVED_EXPORT_RE =
    /^-export\s+(?:default\s+)?(?:function|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/gm;

  interface ExportChanges {
    added: Set<string>;
    removed: Set<string>;
  }

  const extractChanges = (diff: string): ExportChanges => {
    const added = new Set([...diff.matchAll(ADDED_EXPORT_RE)].map((m) => m[1]!));
    const removed = new Set([...diff.matchAll(REMOVED_EXPORT_RE)].map((m) => m[1]!));
    return { added, removed };
  };

  const [changesA, changesB] = [
    extractChanges(candidates[0]!.unifiedDiff),
    extractChanges(candidates[1]!.unifiedDiff),
  ];

  // Conflict: A removes a symbol that B also removes (both delete the same API)
  // or A adds a symbol that B removes (one creates, other deletes — incompatible)
  let conflicts = 0;
  for (const sym of changesA.removed) {
    if (changesB.removed.has(sym)) conflicts++; // both delete same export
    if (changesB.added.has(sym)) conflicts++; // A removes, B adds (rename conflict)
  }
  for (const sym of changesA.added) {
    if (changesB.removed.has(sym)) conflicts++; // A adds, B removes (rename conflict)
  }

  const totalChanged =
    changesA.added.size + changesA.removed.size + changesB.added.size + changesB.removed.size;
  if (totalChanged === 0) return 1.0; // no export changes — contracts preserved

  return Math.max(0, 1 - conflicts / Math.max(totalChanged, 1));
}

/**
 * Heuristic intent compatibility: checks if both patches modify the same files.
 * Same-file modifications are more dangerous (lower score).
 */
function computeIntentCompatibility(candidates: MergeCandidatePatch[]): number {
  if (candidates.length < 2) return 1.0;

  const [a, b] = candidates;
  const setA = new Set(a!.changedFiles);
  const setB = new Set(b!.changedFiles);

  const overlap = [...setA].filter((f) => setB.has(f)).length;
  const total = Math.max(setA.size, setB.size);

  if (total === 0) return 1.0;
  return Math.max(0, 1 - overlap / total);
}

// ----------------------------------------------------------------------------
// MergeConfidenceScorer
// ----------------------------------------------------------------------------

/**
 * Scores a merge candidate set and returns a confidence bucket and decision.
 *
 * Confidence buckets:
 * - high  (>= 75) → auto-merge allowed
 * - medium (50-74) → synthesize then require review
 * - low   (< 50)  → preserve candidates and block
 */
export class MergeConfidenceScorer {
  score(candidates: MergeCandidatePatch[]): MergeConfidenceScore {
    if (candidates.length === 0) {
      return {
        bucket: "low",
        decision: "blocked",
        score: 0,
        factors: {
          structuralSafety: 0,
          testCoverage: 0,
          intentCompatibility: 0,
          contractPreservation: 0,
        },
        reasoning: "No candidate patches provided",
      };
    }

    if (candidates.length === 1) {
      // Single patch — no merge conflict possible
      const testCoverage = computeTestCoverage(candidates);
      const compositeScore = 60 + testCoverage * 40;
      const bucket: MergeConfidenceBucket = compositeScore >= 75 ? "high" : "medium";
      return {
        bucket,
        decision: bucket === "high" ? "auto-merge" : "review-required",
        score: Math.round(compositeScore),
        factors: {
          structuralSafety: 1.0,
          testCoverage,
          intentCompatibility: 1.0,
          contractPreservation: 1.0,
        },
        reasoning: "Single candidate — no merge conflict. Confidence depends on test coverage.",
      };
    }

    const [patchA, patchB] = candidates;
    const structural = computeStructuralSafety(patchA!.unifiedDiff, patchB!.unifiedDiff);
    const testCoverage = computeTestCoverage(candidates);
    const intentCompat = computeIntentCompatibility(candidates);
    const contractPreservation = computeContractPreservation(candidates);

    // Weighted composite
    const score =
      structural * 40 + testCoverage * 25 + intentCompat * 20 + contractPreservation * 15;

    const roundedScore = Math.round(score);
    let bucket: MergeConfidenceBucket;
    let decision: MergeDecision;

    if (roundedScore >= 75) {
      bucket = "high";
      decision = "auto-merge";
    } else if (roundedScore >= 50) {
      bucket = "medium";
      decision = "review-required";
    } else {
      bucket = "low";
      decision = "blocked";
    }

    const reasons: string[] = [];
    if (structural < 0.5) reasons.push("hunk overlap detected");
    if (testCoverage < 0.7) reasons.push("test failures present");
    if (intentCompat < 0.6) reasons.push("same files modified by multiple lanes");

    return {
      bucket,
      decision,
      score: roundedScore,
      factors: {
        structuralSafety: structural,
        testCoverage,
        intentCompatibility: intentCompat,
        contractPreservation,
      },
      reasoning:
        reasons.length > 0
          ? `Confidence reduced by: ${reasons.join("; ")}`
          : "Candidates appear structurally compatible",
    };
  }
}
