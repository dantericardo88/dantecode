/**
 * risk-classifier.ts
 *
 * Classifies tasks/messages for DanteFearSet trigger eligibility.
 * Used by auto-trigger and trigger detection logic.
 */

import type { FearSetTriggerChannel } from "@dantecode/runtime-spine";
import type { FearSetConfig } from "@dantecode/runtime-spine";

// ─── Risk signals ──────────────────────────────────────────────────────────────

/** Keywords that indicate destructive or irreversible operations. */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bdrop\s+(table|database|schema)\b/i,
  /\bdelete\b.*\bpermanently\b/i,
  /\birreversible\b/i,
  /\bwipe\b.*\bdisk\b/i,
  /\bformat\b.*\bdrive\b/i,
  /\bpurge\b.*\bdata\b/i,
  /\bnuke\b/i,
  /\bdestructive\b/i,
];

/** Patterns that indicate long-horizon or multi-step planning. */
const LONG_HORIZON_PATTERNS = [
  /\bover\s+the\s+(next\s+)?(week|month|quarter|year)\b/i,
  /\blong.?term\b/i,
  /\bmulti.?phase\b/i,
  /\broad.?map\b/i,
  /\barchitecture\s+(decision|change)\b/i,
  /\bmigration\s+plan\b/i,
  /\brefactor\s+.*(entire|whole|full)\b/i,
  /\b(10|20|30|50|100)\s+steps?\b/i,
];

/** Patterns that indicate explicit fear-setting request. */
const EXPLICIT_FEARSET_PATTERNS = [
  /^\/fearset\b/i,
  /\bfear.?set\b/i,
  /\bworst.?case\b.*\bscenario\b/i,
  /\bwhat\s+(could|can)\s+(go\s+wrong|fail)\b/i,
  /\bshould\s+i\s+(do|launch|deploy|delete|migrate)\b/i,
];

// ─── Classification result ────────────────────────────────────────────────────

export interface RiskClassification {
  /** Whether FearSet should trigger. */
  shouldTrigger: boolean;
  /** Primary trigger channel. */
  channel: FearSetTriggerChannel | null;
  /** Supporting reasons. */
  reasons: string[];
  /** 0-1 confidence in the classification. */
  confidence: number;
}

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a message/task for FearSet trigger eligibility.
 *
 * @param message - The user message or task description.
 * @param opts - Optional context for classification.
 */
export function classifyRisk(
  message: string,
  opts: {
    taskClass?: string;
    verificationScore?: number;
    priorFailureCount?: number;
    config?: Pick<FearSetConfig, "policyTaskClasses" | "enabled">;
  } = {},
): RiskClassification {
  if (!opts.config?.enabled) {
    return { shouldTrigger: false, channel: null, reasons: ["FearSet disabled"], confidence: 1 };
  }

  const reasons: string[] = [];
  let channel: FearSetTriggerChannel | null = null;
  let confidence = 0;

  // 1. Explicit user trigger
  if (EXPLICIT_FEARSET_PATTERNS.some((p) => p.test(message))) {
    channel = "explicit-user";
    reasons.push("Explicit /fearset or worst-case language detected.");
    confidence = 1.0;
  }

  // 2. Destructive patterns
  if (!channel && DESTRUCTIVE_PATTERNS.some((p) => p.test(message))) {
    channel = "destructive";
    reasons.push("Destructive or irreversible operation pattern detected.");
    confidence = 0.9;
  }

  // 3. Long-horizon patterns
  if (!channel && LONG_HORIZON_PATTERNS.some((p) => p.test(message))) {
    channel = "long-horizon";
    reasons.push("Long-horizon or multi-phase plan detected.");
    confidence = 0.75;
  }

  // 4. Policy task class
  if (!channel && opts.taskClass && opts.config?.policyTaskClasses?.includes(opts.taskClass)) {
    channel = "policy";
    reasons.push(`Task class "${opts.taskClass}" is in FearSet policy classes.`);
    confidence = 0.85;
  }

  // 5. Weak robustness score from DanteForge/Gaslight
  if (!channel && opts.verificationScore !== undefined && opts.verificationScore < 0.5) {
    channel = "weak-robustness";
    reasons.push(`Low verification/robustness score (${opts.verificationScore.toFixed(2)}) — plan may be fragile.`);
    confidence = 0.8;
  }

  // 6. Repeated failure pattern
  if (!channel && (opts.priorFailureCount ?? 0) >= 2) {
    channel = "repeated-failure";
    reasons.push(`Repeated failure pattern detected (${opts.priorFailureCount} prior failures).`);
    confidence = 0.85;
  }

  return {
    shouldTrigger: channel !== null,
    channel,
    reasons,
    confidence,
  };
}

// ─── Tier 2: LLM semantic classifier ─────────────────────────────────────────

/**
 * Result returned by the LLM semantic classifier (Tier 2).
 * Parsed from the JSON response of the `onClassify` callback.
 */
export interface LlmClassificationResult {
  shouldTrigger: boolean;
  channel: "destructive" | "long-horizon" | "policy" | "weak-robustness";
  /** Confidence score, 0-1 (clamped). */
  confidence: number;
  rationale: string;
}

/**
 * Structured 4-question rubric prompt passed to the LLM classifier.
 * Designed to catch nuanced destructive intent that regex misses:
 * "should we sunset the old API?", "refactor auth — getting complex", etc.
 */
export const FEARSET_CLASSIFY_RUBRIC = `You are a risk classifier for software engineering tasks. Evaluate the following message against these rubric questions:

1. Does this involve irreversible changes to production data or systems (database drops, bulk deletes, migrations, credential rotations, data purges)?
2. Does this span multiple phases over time (roadmaps, multi-quarter efforts, staged migrations, long-term plans)?
3. Does this involve deleting, retiring, replacing, or sunsetting a critical system, service, or API?
4. Is the user expressing uncertainty or risk-awareness ("should I", "worried about", "is this risky", "thinking through whether", "can you help me think through")?

If ANY rubric question is clearly YES, trigger FearSet. Assign the most specific channel:
- "destructive" for rubric 1 and 3
- "long-horizon" for rubric 2
- "weak-robustness" for rubric 4 (user is uncertain about plan quality)
- "policy" only if an explicit policy class is mentioned

Respond ONLY with JSON (no markdown, no other text):
{"shouldTrigger": boolean, "channel": "destructive"|"long-horizon"|"policy"|"weak-robustness", "confidence": 0.0-1.0, "rationale": "one sentence max"}

If no rubric questions apply: {"shouldTrigger": false, "channel": "weak-robustness", "confidence": 0.95, "rationale": "No risk signals detected."}`;

const LLM_CLASSIFY_VALID_CHANNELS = new Set([
  "destructive",
  "long-horizon",
  "policy",
  "weak-robustness",
]);

/**
 * Parse an LLM classifier response string into a typed result.
 * Returns null on any parse failure — caller must fall back to no-trigger.
 */
export function parseLlmClassification(raw: string): LlmClassificationResult | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const p = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (typeof p["shouldTrigger"] !== "boolean") return null;
    if (!LLM_CLASSIFY_VALID_CHANNELS.has(p["channel"] as string)) return null;
    return {
      shouldTrigger: p["shouldTrigger"],
      channel: p["channel"] as LlmClassificationResult["channel"],
      confidence:
        typeof p["confidence"] === "number"
          ? Math.min(1, Math.max(0, p["confidence"]))
          : 0.7,
      rationale:
        typeof p["rationale"] === "string"
          ? p["rationale"]
          : "LLM classifier result.",
    };
  } catch {
    return null;
  }
}

/**
 * Two-tier hybrid risk classifier.
 *
 * Tier 1 (synchronous, zero latency): Fast regex pre-filter.
 * Returns immediately on any regex match — LLM is never called.
 * This preserves sub-millisecond performance for all known-bad patterns.
 *
 * Tier 2 (async LLM): Only invoked when Tier 1 returns shouldTrigger=false
 * AND an onClassify callback is provided. Scores the message against a
 * structured 4-question rubric that catches nuanced risk signals regex misses.
 * On any failure (null response, parse error, throw), falls back to Tier 1
 * result — backward compatible, non-fatal.
 *
 * @param message    - The user message or task description.
 * @param opts       - Classification context (taskClass, scores, config).
 * @param onClassify - Optional LLM callback. Absent = behaves as classifyRisk().
 */
export async function classifyRiskWithLlm(
  message: string,
  opts: {
    taskClass?: string;
    verificationScore?: number;
    priorFailureCount?: number;
    config?: Pick<FearSetConfig, "policyTaskClasses" | "enabled">;
  } = {},
  onClassify?: (message: string, rubricPrompt: string) => Promise<string | null>,
): Promise<RiskClassification> {
  // Disabled check — mirrors classifyRisk(). LLM never called when FearSet is off.
  if (!opts.config?.enabled) {
    return { shouldTrigger: false, channel: null, reasons: ["FearSet disabled"], confidence: 1 };
  }

  // Tier 1: synchronous regex — always run first (fast path)
  const tier1 = classifyRisk(message, opts);
  if (tier1.shouldTrigger) return tier1;

  // No LLM callback provided — behave identically to classifyRisk()
  if (!onClassify) return tier1;

  // Tier 2: LLM semantic classifier
  let raw: string | null = null;
  try {
    raw = await onClassify(message, FEARSET_CLASSIFY_RUBRIC);
  } catch {
    return tier1; // LLM error is non-fatal
  }

  if (!raw) return tier1;

  const llmResult = parseLlmClassification(raw);
  if (!llmResult?.shouldTrigger) return tier1;

  // LLM says trigger — build classification from LLM result
  return {
    shouldTrigger: true,
    channel: llmResult.channel,
    reasons: [`LLM semantic classifier: ${llmResult.rationale}`],
    confidence: llmResult.confidence,
  };
}

/**
 * Build a FearSetTrigger from a RiskClassification.
 * Returns null if classification says no trigger.
 */
export function buildFearSetTrigger(
  classification: RiskClassification,
  opts: { taskClass?: string; sessionId?: string } = {},
) {
  if (!classification.shouldTrigger || !classification.channel) return null;
  return {
    channel: classification.channel,
    taskClass: opts.taskClass,
    sessionId: opts.sessionId,
    rationale: classification.reasons.join(" "),
    at: new Date().toISOString(),
  };
}
