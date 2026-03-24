// ============================================================================
// @dantecode/core — Model Adaptation Types (D-12A)
// Single source of truth for all model adaptation type definitions.
// ============================================================================

import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Quirk taxonomy — 10 evidence-based quirk classes
// ---------------------------------------------------------------------------

export type QuirkKey =
  | "tool_call_format_error"
  | "schema_argument_mismatch"
  | "markdown_wrapper_issue"
  | "katex_format_requirement"
  | "stops_before_completion"
  | "skips_synthesis"
  | "ignores_prd_section_order"
  | "overly_verbose_preface"
  | "regeneration_trigger_pattern"
  | "provider_specific_dispatch_shape";

export const ALL_QUIRK_KEYS: readonly QuirkKey[] = [
  "tool_call_format_error",
  "schema_argument_mismatch",
  "markdown_wrapper_issue",
  "katex_format_requirement",
  "stops_before_completion",
  "skips_synthesis",
  "ignores_prd_section_order",
  "overly_verbose_preface",
  "regeneration_trigger_pattern",
  "provider_specific_dispatch_shape",
] as const;

// ---------------------------------------------------------------------------
// Legacy compatibility — D-12 quirk class names
// ---------------------------------------------------------------------------

export type LegacyQuirkClass =
  | "tool-call-json-formatting"
  | "markdown-preference"
  | "premature-summary"
  | "ignoring-workflow-stages"
  | "omitting-edits-after-planning"
  | "stopping-after-tool-execution"
  | "provider-verbosity"
  | "custom";

export const QUIRK_KEY_MIGRATION: Record<LegacyQuirkClass, QuirkKey> = {
  "tool-call-json-formatting": "tool_call_format_error",
  "markdown-preference": "markdown_wrapper_issue",
  "premature-summary": "stops_before_completion",
  "ignoring-workflow-stages": "ignores_prd_section_order",
  "omitting-edits-after-planning": "skips_synthesis",
  "stopping-after-tool-execution": "stops_before_completion",
  "provider-verbosity": "overly_verbose_preface",
  custom: "provider_specific_dispatch_shape",
};

// ---------------------------------------------------------------------------
// Workflow + adaptation mode
// ---------------------------------------------------------------------------

export type WorkflowType = "magic" | "party" | "forge" | "repl" | "other";

export type AdaptationMode = "observe-only" | "staged" | "active";

export const VALID_ADAPTATION_MODES: readonly AdaptationMode[] = [
  "observe-only",
  "staged",
  "active",
] as const;

export function isValidAdaptationMode(value: string): value is AdaptationMode {
  return VALID_ADAPTATION_MODES.includes(value as AdaptationMode);
}

// ---------------------------------------------------------------------------
// Quirk observation — raw evidence from model exchanges
// ---------------------------------------------------------------------------

export interface QuirkObservation {
  id: string;
  quirkKey: QuirkKey;
  provider: string;
  model: string;
  workflow: WorkflowType;
  commandName?: string;
  promptTemplateVersion: string;
  toolSchemaVersion?: string;
  failureTags: string[];
  outputCharacteristics: string[];
  pdseScore?: number;
  completionStatus?: "complete" | "partial" | "failed";
  /** Detection confidence (0-1). Higher = stronger signal. */
  confidence?: number;
  evidenceRefs: string[];
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Candidate override — versioned prompt/template patches
// ---------------------------------------------------------------------------

export interface OverridePatch {
  promptPreamble?: string;
  orderingHints?: string[];
  toolFormattingHints?: string[];
  synthesisRequirements?: string[];
}

export type OverrideStatus =
  | "draft"
  | "testing"
  | "awaiting_review"
  | "promoted"
  | "rejected"
  | "rolled_back";

export interface CandidateOverride {
  id: string;
  provider: string;
  model: string;
  quirkKey: QuirkKey;
  status: OverrideStatus;
  scope: {
    workflow?: string;
    commandName?: string;
  };
  patch: OverridePatch;
  basedOnObservationIds: string[];
  version: number;
  createdAt: string;
  promotedAt?: string;
  rejectedAt?: string;
  rollbackOfVersion?: number;
}

// ---------------------------------------------------------------------------
// Experiment result — bounded A/B comparison
// ---------------------------------------------------------------------------

export interface ExperimentMetrics {
  pdseScore?: number;
  completionStatus?: string;
  successRate?: number;
}

export interface ExperimentResult {
  id: string;
  overrideId: string;
  provider: string;
  model: string;
  quirkKey: QuirkKey;
  baseline: ExperimentMetrics;
  candidate: ExperimentMetrics;
  controlRegression: boolean;
  smokePassed: boolean;
  decision: "promote" | "reject" | "needs_human_review";
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Experiment configuration
// ---------------------------------------------------------------------------

export interface ExperimentConfig {
  maxPerQuirkPerDay: number; // default 5
  maxDurationMs: number; // default 30_000
  /** Factor for control regression detection. Control PDSE < baseline * this = regression. Default 0.95. */
  controlRegressionFactor: number;
}

export const DEFAULT_EXPERIMENT_CONFIG: ExperimentConfig = {
  maxPerQuirkPerDay: 5,
  maxDurationMs: 30_000,
  controlRegressionFactor: 0.95,
};

// ---------------------------------------------------------------------------
// Adaptation configuration — configurable thresholds (D-12A Phase 3)
// ---------------------------------------------------------------------------

export interface AdaptationConfig {
  /** Number of observations required before creating a draft override. */
  draftThreshold: number;
  /** Minimum average confidence of detections for draft creation. */
  confidenceGate: number;
  /** Minimum PDSE improvement (absolute points) for auto-promotion. */
  minPdseImprovement: number;
  /** First N promotions per quirk family require human approval. */
  humanVetoThreshold: number;
  /** PDSE delta below which a rollback is triggered. Default -5. */
  rollbackPdseThreshold: number;
}

export const DEFAULT_ADAPTATION_CONFIG: AdaptationConfig = {
  draftThreshold: 3,
  confidenceGate: 0.6,
  minPdseImprovement: 5,
  humanVetoThreshold: 3,
  rollbackPdseThreshold: -5,
};

// ---------------------------------------------------------------------------
// Promotion + rollback
// ---------------------------------------------------------------------------

export type RollbackTrigger =
  | "pdse_regression"
  | "completion_regression"
  | "control_regression"
  | "repeated_failures"
  | "user_disable"
  | "experiment_corruption";

export interface PromotionGateResult {
  decision: "promote" | "reject" | "needs_human_review";
  reasons: string[];
  requiresHumanApproval: boolean;
}

// ---------------------------------------------------------------------------
// Adaptation report — 7 required sections
// ---------------------------------------------------------------------------

export interface AdaptationReportData {
  quirkDetected: string;
  evidence: string[];
  candidateOverride: string;
  experimentsRun: string[];
  promotionDecision: string;
  rollbackStatus: string;
  plainEnglish: string;
}

// ---------------------------------------------------------------------------
// Store snapshot — serialization format
// ---------------------------------------------------------------------------

export interface ModelAdaptationSnapshot {
  version: 2;
  observations: QuirkObservation[];
  overrides: CandidateOverride[];
  experiments: ExperimentResult[];
  /** Persisted rate limiter state (D-12A Gap 3). */
  rateLimiterState?: Record<string, { date: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function generateId(prefix: string = "ma"): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

export function migrateLegacyQuirkClass(legacy: string): QuirkKey | null {
  return QUIRK_KEY_MIGRATION[legacy as LegacyQuirkClass] ?? null;
}

// ---------------------------------------------------------------------------
// Pipeline events (D-12A Production Hardening — Gaps 1 + 6)
// ---------------------------------------------------------------------------

export type AdaptationEventKind =
  | "adaptation:pipeline:start"
  | "adaptation:pipeline:complete"
  | "adaptation:experiment:start"
  | "adaptation:experiment:complete"
  | "adaptation:gate:decision"
  | "adaptation:promoted"
  | "adaptation:rejected"
  | "adaptation:rate_limited"
  | "adaptation:rollback"
  | "adaptation:observation"
  | "adaptation:save_error";

export interface AdaptationEvent {
  kind: AdaptationEventKind;
  quirkKey?: string;
  overrideId?: string;
  decision?: string;
  reason?: string;
  timestamp: string;
  detail?: Record<string, unknown>;
}

export type AdaptationLogger = (event: AdaptationEvent) => void;
