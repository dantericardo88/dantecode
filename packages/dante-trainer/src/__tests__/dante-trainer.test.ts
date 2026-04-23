// ============================================================================
// packages/dante-trainer/src/__tests__/dante-trainer.test.ts
// 15 tests: EvalMetrics, TrainingConfig, ModelOutputParser
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  levenshteinSimilarity,
  type NextEditPrediction,
  type NextEditGroundTruth,
} from "../eval-metrics.js";
import {
  validateTrainingConfig,
  serializeConfig,
  DEFAULT_NEXT_EDIT_CONFIG,
  type TrainingConfig,
} from "../training-config.js";
import { parseModelOutput, meetsConfidenceThreshold } from "../model-output-parser.js";

// ── EvalMetrics ───────────────────────────────────────────────────────────────

describe("computeMetrics", () => {
  it("accuracy_at_1 = 1.0 on exact line match", () => {
    const preds: NextEditPrediction[] = [{ filePath: "utils.ts", startLine: 42, endLine: 42 }];
    const gts: NextEditGroundTruth[] = [{ filePath: "utils.ts", startLine: 42, endLine: 42 }];
    const result = computeMetrics(preds, gts);
    expect(result.accuracy_at_1).toBe(1.0);
  });

  it("accuracy_at_3 = 1.0 when predicted line is within +/-3", () => {
    const preds: NextEditPrediction[] = [{ filePath: "f.ts", startLine: 12, endLine: 12 }];
    const gts: NextEditGroundTruth[] = [{ filePath: "f.ts", startLine: 10, endLine: 10 }];
    const result = computeMetrics(preds, gts);
    expect(result.accuracy_at_1).toBe(0);
    expect(result.accuracy_at_3).toBe(1.0);
  });

  it("accuracy_at_3 = 0.0 when line diff > 3", () => {
    const preds: NextEditPrediction[] = [{ filePath: "f.ts", startLine: 50, endLine: 50 }];
    const gts: NextEditGroundTruth[] = [{ filePath: "f.ts", startLine: 10, endLine: 10 }];
    const result = computeMetrics(preds, gts);
    expect(result.accuracy_at_3).toBe(0.0);
  });

  it("file_accuracy = 1.0 when basename matches", () => {
    const preds: NextEditPrediction[] = [{ filePath: "utils.ts", startLine: 1, endLine: 1 }];
    const gts: NextEditGroundTruth[] = [{ filePath: "src/utils.ts", startLine: 5, endLine: 5 }];
    const result = computeMetrics(preds, gts);
    expect(result.file_accuracy).toBe(1.0);
  });

  it("diff_similarity uses normalized Levenshtein", () => {
    const preds: NextEditPrediction[] = [{ filePath: "f.ts", startLine: 1, endLine: 1, diff: "abc" }];
    const gts: NextEditGroundTruth[] = [{ filePath: "f.ts", startLine: 1, endLine: 1, diff: "abc" }];
    const result = computeMetrics(preds, gts);
    expect(result.diff_similarity).toBe(1.0);
  });

  it("returns 0.0 counts on empty arrays without divide-by-zero", () => {
    const result = computeMetrics([], []);
    expect(result.count).toBe(0);
    expect(result.accuracy_at_1).toBe(0);
    expect(result.file_accuracy).toBe(0);
    expect(result.diff_similarity).toBe(0);
  });
});

describe("levenshteinSimilarity", () => {
  it("identical strings = 1.0", () => {
    expect(levenshteinSimilarity("hello", "hello")).toBe(1.0);
  });

  it("empty strings = 1.0", () => {
    expect(levenshteinSimilarity("", "")).toBe(1.0);
  });

  it("one empty string = 0.0", () => {
    expect(levenshteinSimilarity("hello", "")).toBe(0.0);
  });

  it("completely different strings < 0.5", () => {
    expect(levenshteinSimilarity("abc", "xyz")).toBeLessThan(0.5);
  });
});

// ── TrainingConfig ────────────────────────────────────────────────────────────

describe("validateTrainingConfig", () => {
  it("accepts valid default config", () => {
    const result = validateTrainingConfig(DEFAULT_NEXT_EDIT_CONFIG);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects missing modelName", () => {
    const cfg: TrainingConfig = { ...DEFAULT_NEXT_EDIT_CONFIG, modelName: "" };
    const result = validateTrainingConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("modelName"))).toBe(true);
  });

  it("rejects invalid LoRA rank", () => {
    const cfg = { ...DEFAULT_NEXT_EDIT_CONFIG, loraRank: 99 } as unknown as TrainingConfig;
    const result = validateTrainingConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("loraRank"))).toBe(true);
  });

  it("rejects learning rate > 1e-2", () => {
    const cfg: TrainingConfig = { ...DEFAULT_NEXT_EDIT_CONFIG, learningRate: 0.1 };
    const result = validateTrainingConfig(cfg);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("learningRate"))).toBe(true);
  });

  it("serializes config to valid JSON", () => {
    const json = serializeConfig(DEFAULT_NEXT_EDIT_CONFIG);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json);
    expect(parsed.modelName).toBe(DEFAULT_NEXT_EDIT_CONFIG.modelName);
  });
});

// ── ModelOutputParser ─────────────────────────────────────────────────────────

describe("parseModelOutput", () => {
  it("parses valid JSON output", () => {
    const raw = JSON.stringify({ filePath: "utils.ts", startLine: 42, endLine: 42, confidence: 0.91 });
    const result = parseModelOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe("utils.ts");
    expect(result!.startLine).toBe(42);
    expect(result!.confidence).toBe(0.91);
  });

  it("returns null on invalid JSON", () => {
    expect(parseModelOutput("not json at all")).toBeNull();
  });

  it("returns null on missing startLine", () => {
    const raw = JSON.stringify({ filePath: "utils.ts", endLine: 42, confidence: 0.9 });
    expect(parseModelOutput(raw)).toBeNull();
  });

  it("clamps confidence to [0.0, 1.0]", () => {
    const raw = JSON.stringify({ filePath: "f.ts", startLine: 1, endLine: 1, confidence: 1.5 });
    const result = parseModelOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
  });

  it("handles extra whitespace and newlines in output", () => {
    const raw = `\n  \n${JSON.stringify({ filePath: "app.ts", startLine: 5, endLine: 5, confidence: 0.8 })}\n  `;
    const result = parseModelOutput(raw);
    expect(result).not.toBeNull();
    expect(result!.startLine).toBe(5);
  });
});

describe("meetsConfidenceThreshold", () => {
  it("returns true when confidence >= threshold", () => {
    expect(meetsConfidenceThreshold({ filePath: "f.ts", startLine: 1, endLine: 1, confidence: 0.9 })).toBe(true);
  });

  it("returns false when confidence < threshold", () => {
    expect(meetsConfidenceThreshold({ filePath: "f.ts", startLine: 1, endLine: 1, confidence: 0.4 })).toBe(false);
  });
});
