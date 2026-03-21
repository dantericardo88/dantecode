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
