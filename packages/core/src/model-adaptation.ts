// ============================================================================
// Model Adaptation Quirk Detector (D-12A)
// Detects behavioural quirks in model responses, generates template-based
// overrides, and integrates with ModelAdaptationStore for cross-session learning.
// 10 evidence-based quirk classes. NO LLM — pure template overrides.
// ============================================================================

import type {
  QuirkKey,
  QuirkObservation,
  CandidateOverride,
  OverridePatch,
  WorkflowType,
  AdaptationLogger,
  AdaptationConfig,
} from "./model-adaptation-types.js";
import { generateId, DEFAULT_ADAPTATION_CONFIG } from "./model-adaptation-types.js";
import { ModelAdaptationStore } from "./model-adaptation-store.js";
import type { ModelAdaptationKey } from "./model-adaptation-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Context for quirk detection — scopes the detection to a model + prompt. */
export interface QuirkDetectionContext {
  modelKey: ModelAdaptationKey;
  promptType?: "tool-call" | "planning" | "implementation" | "verification";
  toolCallsInRound?: number;
  hadToolCalls?: boolean;
  workflow?: WorkflowType;
  commandName?: string;
  promptTemplateVersion?: string;
  toolSchemaVersion?: string;
  pdseScore?: number;
}

// ---------------------------------------------------------------------------
// Detection patterns — one per quirk class (10 total)
// ---------------------------------------------------------------------------

const PREMATURE_SUMMARY_RE =
  /(?:in\s+summary|to\s+summarize|to\s+recap|in\s+conclusion|overall)[,:]?\s*$/im;

const PLANNING_LANGUAGE_RE = /(?:plan|approach|strategy|steps?)\s*:/i;

// Heuristic: model acknowledges tool execution (requires hadToolCalls context)
const TOOL_ACKNOWLEDGEMENT_RE = /(?:I\s+(?:ran|executed|called|used)\s+the|(?:the|this)\s+(?:tool|command|search|query)\s+(?:returned|showed|produced|found)|running\s+the)/i;

const MALFORMED_JSON_RE =
  /\{\s*"(?:name|type)"\s*:\s*"[^"]*"\s*,\s*"(?:value|args|parameters)"\s*:\s*(?=[^"{\[\d\-tn\s}])/;

const MARKDOWN_HEADER_RE = /^#{1,3}\s/m;

const NUMBERED_STAGES_RE = /^\d+[.)]/m;

// New D-12A patterns
const SCHEMA_MISMATCH_RE = /(?:unknown\s+(?:parameter|argument|field)|unexpected\s+key|invalid\s+(?:property|field))/i;

const KATEX_FORMAT_RE = /(?:\$\$[^$]+\$\$|\\\[|\\\(|\\begin\{(?:equation|align|matrix)\})/;

const REGENERATION_LOOP_RE = /(?:let\s+me\s+try\s+again|attempting\s+again|retrying|re-?generating)/i;

// ---------------------------------------------------------------------------
// Override templates — one per QuirkKey (NO LLM, pure template)
// ---------------------------------------------------------------------------

const OVERRIDE_TEMPLATES: Record<QuirkKey, OverridePatch> = {
  tool_call_format_error: {
    toolFormattingHints: [
      "Ensure all tool call parameters are valid JSON with properly quoted strings and escaped special characters.",
    ],
  },
  schema_argument_mismatch: {
    toolFormattingHints: [
      "Use only the exact parameter names defined in the tool schema. Do not add, rename, or omit parameters.",
    ],
  },
  markdown_wrapper_issue: {
    promptPreamble:
      "When generating tool calls, use plain text. Reserve markdown formatting for user-facing output only.",
  },
  katex_format_requirement: {
    promptPreamble:
      "Do not use LaTeX/KaTeX math formatting unless explicitly requested. Use plain text or code for technical output.",
  },
  stops_before_completion: {
    promptPreamble:
      "Do not summarize until all tool executions are complete and verified. Finish all work before any recap. After every tool result, synthesize what happened and determine the next action.",
  },
  skips_synthesis: {
    promptPreamble:
      "After planning, immediately execute the edits. Planning without execution is not acceptable.",
    synthesisRequirements: ["Execute all planned changes before responding."],
  },
  ignores_prd_section_order: {
    orderingHints: [
      "Follow numbered workflow stages in order. Do not skip stages. Complete each stage before moving to the next.",
    ],
  },
  overly_verbose_preface: {
    promptPreamble:
      "Be concise. Lead with actions, not explanations. Skip preamble and unnecessary context.",
  },
  regeneration_trigger_pattern: {
    promptPreamble:
      "When a generation fails, diagnose the root cause before retrying. Do not blindly regenerate.",
  },
  provider_specific_dispatch_shape: {
    toolFormattingHints: [
      "Follow the exact dispatch format specified in the tool schema. Do not adapt formatting based on provider conventions.",
    ],
  },
};

// ---------------------------------------------------------------------------
// 1. detectQuirks — 10 evidence-based detectors
// ---------------------------------------------------------------------------

/**
 * Regex-based detection for 10 quirk classes.
 * Returns an array of QuirkObservation drafts. A single response can
 * trigger multiple detections.
 */
export function detectQuirks(
  response: string,
  context: QuirkDetectionContext & { sessionId: string },
): QuirkObservation[] {
  const observations: QuirkObservation[] = [];
  const now = new Date().toISOString();
  const provider = context.modelKey.provider;
  const model = context.modelKey.modelId;
  const workflow = context.workflow ?? "repl";

  const makeObs = (quirkKey: QuirkKey, tags: string[], chars: string[], confidence: number = 0.7): QuirkObservation => ({
    id: generateId("obs"),
    quirkKey,
    provider,
    model,
    workflow,
    commandName: context.commandName,
    promptTemplateVersion: context.promptTemplateVersion ?? "1.3.0",
    toolSchemaVersion: context.toolSchemaVersion,
    failureTags: tags,
    outputCharacteristics: chars,
    pdseScore: context.pdseScore,
    confidence,
    evidenceRefs: [],
    createdAt: now,
  });

  // 1. stops_before_completion (merged: premature-summary + stopping-after-tool-execution)
  if (response.length > 500 && PREMATURE_SUMMARY_RE.test(response)) {
    observations.push(
      makeObs("stops_before_completion", ["premature-summary"], ["ends-with-summary"], 0.8),
    );
  }
  // 1b. stops_before_completion — abrupt end after tool acknowledgement
  if (context.hadToolCalls && TOOL_ACKNOWLEDGEMENT_RE.test(response)) {
    const ackMatches = response.match(new RegExp(TOOL_ACKNOWLEDGEMENT_RE.source, "gi"));
    if (ackMatches) {
      const lastAck = ackMatches[ackMatches.length - 1]!;
      const lastIdx = response.lastIndexOf(lastAck);
      const afterAckContent = response.slice(lastIdx).trim();
      // Skip if after-ack content contains follow-up action verbs (not a false positive)
      const hasFollowUpAction = /\b(fix|update|create|run|check|next|then|proceed|let me|I'll|now)\b/i.test(afterAckContent);
      if (afterAckContent.length < 100 && !hasFollowUpAction) {
        observations.push(
          makeObs("stops_before_completion", ["stops-after-tool"], ["abrupt-end-after-tool-ack"], Math.min(1, 1 - afterAckContent.length / 100)),
        );
      }
    }
  }

  // 2. skips_synthesis (was: omitting-edits-after-planning)
  if (
    context.promptType === "implementation" &&
    PLANNING_LANGUAGE_RE.test(response) &&
    context.hadToolCalls === false
  ) {
    observations.push(
      makeObs("skips_synthesis", ["planning-without-execution"], ["has-plan-no-edits"], 0.75),
    );
  }

  // 3. overly_verbose_preface (was: provider-verbosity)
  if (context.promptType !== "planning") {
    const wordCount = response.split(/\s+/).filter(Boolean).length;
    if (wordCount > 1000) {
      observations.push(
        makeObs("overly_verbose_preface", ["excessive-verbosity"], [`${wordCount}-words`], Math.min(1, wordCount / 2000)),
      );
    }
  }

  // 4. tool_call_format_error (was: tool-call-json-formatting)
  if (MALFORMED_JSON_RE.test(response)) {
    observations.push(
      makeObs("tool_call_format_error", ["malformed-json"], ["unquoted-value-in-json"], 0.9),
    );
  }

  // 5. markdown_wrapper_issue (was: markdown-preference)
  if (context.promptType === "tool-call" && MARKDOWN_HEADER_RE.test(response)) {
    observations.push(
      makeObs("markdown_wrapper_issue", ["markdown-in-tool-call"], ["has-markdown-headers"], 0.6),
    );
  }

  // 6. ignores_prd_section_order (was: ignoring-workflow-stages)
  if (
    context.promptType === "implementation" &&
    response.length > 800 &&
    !NUMBERED_STAGES_RE.test(response) &&
    /(?:stage|step|phase)\s*\d/i.test(response)
  ) {
    observations.push(
      makeObs("ignores_prd_section_order", ["skipped-stages"], ["no-numbered-stages"], 0.6),
    );
  }

  // 7. schema_argument_mismatch (NEW)
  if (SCHEMA_MISMATCH_RE.test(response)) {
    observations.push(
      makeObs("schema_argument_mismatch", ["schema-mismatch"], ["unknown-parameter-reference"], 0.85),
    );
  }

  // 8. katex_format_requirement (NEW)
  if (context.promptType !== "planning" && KATEX_FORMAT_RE.test(response)) {
    observations.push(
      makeObs("katex_format_requirement", ["katex-formatting"], ["has-latex-notation"], 0.9),
    );
  }

  // 9. regeneration_trigger_pattern (NEW)
  if (REGENERATION_LOOP_RE.test(response)) {
    const matches = response.match(new RegExp(REGENERATION_LOOP_RE.source, "gi"));
    if (matches && matches.length >= 2) {
      observations.push(
        makeObs("regeneration_trigger_pattern", ["regeneration-loop"], [`${matches.length}-retry-phrases`], Math.min(1, matches.length / 4)),
      );
    }
  }

  // 10. provider_specific_dispatch_shape — detected when tool-call context has
  // provider-specific patterns (e.g., XML tool calls, non-standard function wrapping)
  if (
    context.promptType === "tool-call" &&
    (/<function_call>|<tool_use>|<invoke>/.test(response))
  ) {
    observations.push(
      makeObs("provider_specific_dispatch_shape", ["non-standard-dispatch"], ["xml-tool-format"], 0.8),
    );
  }

  return observations;
}

// ---------------------------------------------------------------------------
// 2. generateOverride — template-based (NO LLM)
// ---------------------------------------------------------------------------

/**
 * Generate a draft override from a detected quirk.
 * Returns a partial CandidateOverride ready for `store.addDraft()`.
 */
export function generateOverride(
  quirkKey: QuirkKey,
  key: ModelAdaptationKey,
  _evidenceCount: number,
  observationIds: string[] = [],
): Omit<CandidateOverride, "id" | "version" | "status" | "createdAt"> {
  const patch = OVERRIDE_TEMPLATES[quirkKey];
  return {
    provider: key.provider,
    model: key.modelId,
    quirkKey,
    scope: {},
    patch,
    basedOnObservationIds: observationIds,
  };
}

// ---------------------------------------------------------------------------
// 3. applyOverrides — append override instructions to system prompt
// ---------------------------------------------------------------------------

/**
 * Append model adaptation override instructions to a system prompt.
 * Extracts promptPreamble, orderingHints, and synthesisRequirements
 * from each override's patch object.
 */
export function applyOverrides(
  systemPrompt: string,
  overrides: CandidateOverride[],
): string {
  if (overrides.length === 0) return systemPrompt;

  const instructions: string[] = [];

  for (const o of overrides) {
    // Support both D-12A patch-based and legacy payload-based overrides
    if (o.patch) {
      if (o.patch.promptPreamble) instructions.push(o.patch.promptPreamble);
      if (o.patch.orderingHints) instructions.push(...o.patch.orderingHints);
      if (o.patch.synthesisRequirements) instructions.push(...o.patch.synthesisRequirements);
      if (o.patch.toolFormattingHints) instructions.push(...o.patch.toolFormattingHints);
    } else if ("payload" in o && typeof (o as Record<string, unknown>).payload === "string") {
      // Legacy D-12 override format
      const payload = (o as Record<string, unknown>).payload as string;
      if (payload) instructions.push(payload);
    }
  }

  if (instructions.length === 0) return systemPrompt;
  return `${systemPrompt}\n\n## Model Adaptation Overrides\n\n${instructions.join("\n")}`;
}

// ---------------------------------------------------------------------------
// 4. observeAndAdapt — full observe-detect-adapt pipeline
// ---------------------------------------------------------------------------

/**
 * Full observe-detect-adapt pipeline.
 *
 * 1. Detect quirks in the response
 * 2. Store each observation
 * 3. For each unique quirk key, check if the observation count has reached
 *    the draft-creation threshold (3)
 * 4. If threshold met AND no existing draft/testing/promoted override exists
 *    for this quirk+key combo, create a draft override
 * 5. Persist the store (non-fatal)
 * 6. Return any newly created drafts
 */
export async function observeAndAdapt(
  store: ModelAdaptationStore,
  response: string,
  context: QuirkDetectionContext & { sessionId: string },
  logger?: AdaptationLogger,
  config?: Partial<AdaptationConfig>,
): Promise<CandidateOverride[]> {
  const draftThreshold = config?.draftThreshold ?? DEFAULT_ADAPTATION_CONFIG.draftThreshold;
  const confidenceGate = config?.confidenceGate ?? DEFAULT_ADAPTATION_CONFIG.confidenceGate;
  const observations = detectQuirks(response, context);
  const newDrafts: CandidateOverride[] = [];

  // Record each observation in the store
  for (const obs of observations) {
    store.addObservation(obs);
  }

  // Deduplicate quirk keys from this detection round
  const uniqueQuirkKeys = [...new Set(observations.map((o) => o.quirkKey))];

  for (const quirkKey of uniqueQuirkKeys) {
    const count = store.countObservations(quirkKey, context.modelKey);
    if (count < draftThreshold) continue;

    // Confidence gate: only enforce when this round's detections cross the threshold
    const thisRoundDetections = observations.filter(o => o.quirkKey === quirkKey);
    const prevCount = count - thisRoundDetections.length;
    if (prevCount < draftThreshold && thisRoundDetections.length > 0) {
      const avgConfidence = thisRoundDetections.reduce(
        (sum, o) => sum + (o.confidence ?? 0.7), 0
      ) / thisRoundDetections.length;
      if (avgConfidence < confidenceGate) continue;
    }

    // Check for existing draft/testing/awaiting_review/promoted overrides
    const existingOverrides = store.getOverrides(context.modelKey);
    const alreadyExists = existingOverrides.some(
      (o) =>
        o.quirkKey === quirkKey &&
        (o.status === "draft" || o.status === "testing" || o.status === "awaiting_review" || o.status === "promoted"),
    );
    if (alreadyExists) continue;

    const observationIds = observations
      .filter((o) => o.quirkKey === quirkKey)
      .map((o) => o.id);
    const draft = generateOverride(quirkKey, context.modelKey, count, observationIds);
    const created = store.addDraft(draft);
    newDrafts.push(created);
  }

  // Persist — non-fatal but logged
  await store.save().catch((err) => {
    try {
      logger?.({
        kind: "adaptation:save_error",
        timestamp: new Date().toISOString(),
        reason: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } catch { /* logger itself is non-fatal */ }
  });

  return newDrafts;
}

// ---------------------------------------------------------------------------
// 5. promoteOverride — legacy promotion (see model-adaptation-promotion.ts
//    for the full D-12A promotion gate)
// ---------------------------------------------------------------------------

/**
 * Promote a draft/testing override to "promoted" status.
 * Requires passing tests AND smoke tests. Returns false if evidence is
 * insufficient or the override is not found.
 */
export async function promoteOverride(
  store: ModelAdaptationStore,
  overrideId: string,
  evidence: { testsPass: boolean; smokePass: boolean; pdseScore?: number },
): Promise<boolean> {
  if (!evidence.testsPass || !evidence.smokePass) return false;
  const result = store.updateStatus(overrideId, "promoted", evidence);
  if (result) await store.save().catch(() => {});
  return result;
}
