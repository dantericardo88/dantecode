// ============================================================================
// packages/dante-trainer/src/model-output-parser.ts
//
// Parses raw text output from the fine-tuned dante-next-edit model into a
// structured NextEditPrediction. Returns null on any parsing failure so
// callers can fall back to heuristics.
// ============================================================================

export interface ParsedNextEdit {
  filePath: string;
  startLine: number;
  endLine: number;
  confidence: number;   // [0.0, 1.0]
  diff?: string;
}

/**
 * Parse the model's text output into a structured prediction.
 *
 * The model is trained to output JSON like:
 * {"filePath":"utils.ts","startLine":42,"endLine":42,"confidence":0.91,"diff":"..."}
 *
 * Returns null if the output is invalid, missing required fields, or
 * confidence is out of range. Callers should fall back to heuristics on null.
 */
export function parseModelOutput(raw: string): ParsedNextEdit | null {
  if (!raw || typeof raw !== "string") return null;

  // Strip leading/trailing whitespace and common model artifacts
  const trimmed = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Try to extract JSON from within the output (model sometimes adds prose)
    const jsonMatch = /\{[^{}]*"filePath"[^{}]*\}/.exec(trimmed);
    if (!jsonMatch) return null;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;

  // Required fields
  if (typeof obj["filePath"] !== "string" || !obj["filePath"]) return null;
  if (typeof obj["startLine"] !== "number") return null;
  if (typeof obj["endLine"] !== "number") return null;

  // Confidence: optional, clamped to [0.0, 1.0]
  let confidence = 0.5;
  if (typeof obj["confidence"] === "number") {
    confidence = Math.max(0.0, Math.min(1.0, obj["confidence"]));
  }

  // Optional diff
  const diff = typeof obj["diff"] === "string" ? obj["diff"] : undefined;

  return {
    filePath: obj["filePath"] as string,
    startLine: Math.max(1, Math.round(obj["startLine"] as number)),
    endLine: Math.max(1, Math.round(obj["endLine"] as number)),
    confidence,
    diff,
  };
}

/**
 * Check whether a parsed output meets the confidence threshold for use.
 * Below threshold, callers should fall back to heuristics.
 */
export function meetsConfidenceThreshold(
  prediction: ParsedNextEdit,
  threshold = 0.65,
): boolean {
  return prediction.confidence >= threshold;
}
