// ============================================================================
// packages/dante-trainer/src/eval-metrics.ts
//
// Evaluation metrics for next-edit prediction models.
// Measures: accuracy@1, accuracy@3, accuracy@5, file accuracy, diff similarity.
// ============================================================================

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export interface NextEditPrediction {
  filePath: string;
  startLine: number;
  endLine: number;
  confidence?: number;
  diff?: string;
}

export interface NextEditGroundTruth {
  filePath: string;
  startLine: number;
  endLine: number;
  diff?: string;
}

export interface NextEditEvalResult {
  /** Predicted startLine matches ground truth exactly */
  accuracy_at_1: number;
  /** Predicted startLine is within ±3 lines of ground truth */
  accuracy_at_3: number;
  /** Predicted startLine is within ±5 lines of ground truth */
  accuracy_at_5: number;
  /** Predicted file basename matches ground truth */
  file_accuracy: number;
  /** Normalized Levenshtein similarity of predicted diff vs ground truth diff */
  diff_similarity: number;
  /** Number of examples evaluated */
  count: number;
}

// ── Levenshtein distance ──────────────────────────────────────────────────────

/** Normalized Levenshtein similarity [0.0, 1.0] */
export function levenshteinSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j - 1]!, dp[j]!);
      prev = temp;
    }
  }

  const distance = dp[n]!;
  const maxLen = Math.max(m, n);
  return 1.0 - distance / maxLen;
}

// ── Core metric computation ───────────────────────────────────────────────────

/**
 * Compute next-edit accuracy metrics from arrays of predictions and ground truths.
 */
export function computeMetrics(
  predictions: NextEditPrediction[],
  groundTruths: NextEditGroundTruth[],
): NextEditEvalResult {
  const count = Math.min(predictions.length, groundTruths.length);

  if (count === 0) {
    return {
      accuracy_at_1: 0,
      accuracy_at_3: 0,
      accuracy_at_5: 0,
      file_accuracy: 0,
      diff_similarity: 0,
      count: 0,
    };
  }

  let hits1 = 0, hits3 = 0, hits5 = 0, fileHits = 0;
  let totalDiffSim = 0;

  for (let i = 0; i < count; i++) {
    const pred = predictions[i]!;
    const gt = groundTruths[i]!;
    const lineDiff = Math.abs(pred.startLine - gt.startLine);

    if (lineDiff === 0) hits1++;
    if (lineDiff <= 3) hits3++;
    if (lineDiff <= 5) hits5++;

    // File accuracy: compare basenames
    const predBase = pred.filePath.split(/[\\/]/).pop() ?? pred.filePath;
    const gtBase = gt.filePath.split(/[\\/]/).pop() ?? gt.filePath;
    if (predBase === gtBase) fileHits++;

    // Diff similarity
    const predDiff = pred.diff ?? "";
    const gtDiff = gt.diff ?? "";
    totalDiffSim += levenshteinSimilarity(predDiff, gtDiff);
  }

  return {
    accuracy_at_1: hits1 / count,
    accuracy_at_3: hits3 / count,
    accuracy_at_5: hits5 / count,
    file_accuracy: fileHits / count,
    diff_similarity: totalDiffSim / count,
    count,
  };
}

// ── Holdout evaluation ────────────────────────────────────────────────────────

export interface HoldoutRecord {
  input: string;
  expectedOutput: NextEditGroundTruth;
}

/**
 * Read holdout JSONL file and evaluate model predictions.
 * The modelFn receives the input string and returns a prediction or null.
 */
export async function evaluateNextEditModel(
  modelFn: (input: string) => Promise<NextEditPrediction | null>,
  holdoutPath: string,
): Promise<NextEditEvalResult> {
  const records: HoldoutRecord[] = [];
  const rl = createInterface({
    input: createReadStream(holdoutPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as HoldoutRecord);
    } catch { /* skip malformed */ }
  }

  const predictions: NextEditPrediction[] = [];
  const groundTruths: NextEditGroundTruth[] = [];

  for (const record of records) {
    const pred = await modelFn(record.input);
    if (pred) {
      predictions.push(pred);
      groundTruths.push(record.expectedOutput);
    }
  }

  return computeMetrics(predictions, groundTruths);
}
