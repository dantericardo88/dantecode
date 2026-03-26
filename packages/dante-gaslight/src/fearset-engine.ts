/**
 * fearset-engine.ts
 *
 * DanteFearSet bounded iteration engine — grand masterpiece edition.
 *
 * Runs the 5-column Fear-Setting loop (Define → Prevent → Repair → Benefits → Inaction)
 * inside DanteGaslight with:
 * - Per-column token + time budget enforced BEFORE and AFTER each LLM call
 * - DanteForge robustness gate with dynamic per-column scoring
 * - Synthesized go/no-go/conditional recommendation after gate
 * - RuntimeEvent emission at every key transition
 * - Column content validation (warns on thin/empty columns)
 * - Simulation integrity enforcement (can't claim "simulated" without evidence)
 * - stopReason + stoppedAt tracking
 * - User stop signal checked between every column
 */

import { randomUUID } from "node:crypto";
import type {
  FearSetConfig,
  FearSetResult,
  FearSetTrigger,
  FearColumn,
  FearSetColumnName,
  FearSetRobustnessScore,
  FearSetRecommendation,
  PreventionAction,
  RepairPlan,
  InactionCost,
} from "@dantecode/runtime-spine";
import { DEFAULT_FEARSET_CONFIG, buildRuntimeEvent } from "@dantecode/runtime-spine";
import type { RuntimeEvent } from "@dantecode/runtime-spine";
import {
  FEARSET_SYSTEM_PROMPT,
  buildFearSetColumnPrompt,
  parseFearSetColumnOutput,
  buildFearSetRobustnessPrompt,
} from "./gaslighter-role.js";

// ─── Column execution order ───────────────────────────────────────────────────

const STANDARD_COLUMNS: FearSetColumnName[] = [
  "define",
  "prevent",
  "repair",
  "benefits",
  "inaction",
];
const LITE_COLUMNS: FearSetColumnName[] = ["define", "prevent", "repair"];

// ─── Callbacks ────────────────────────────────────────────────────────────────

export interface FearSetCallbacks {
  /** Called for each column. Returns LLM output text or null (use fallback). */
  onColumn?: (
    systemPrompt: string,
    userPrompt: string,
    column: FearSetColumnName,
  ) => Promise<string | null>;

  /** Called for DanteForge robustness gate. Returns raw JSON string or null. */
  onGate?: (prompt: string) => Promise<string | null>;

  /** Called to synthesize a final recommendation from columns. Returns text or null. */
  onSynthesize?: (columnsMarkdown: string) => Promise<string | null>;

  /**
   * LLM semantic classifier — Tier 2 of the two-tier hybrid risk classifier.
   * Called only when Tier 1 regex returns shouldTrigger=false (in maybeFearSet).
   * Receives the user message and a structured 4-question rubric prompt.
   * Must return a JSON string matching LlmClassificationResult, or null.
   * If null or unparseable, falls back to no-trigger (backward compatible).
   */
  onClassify?: (message: string, rubricPrompt: string) => Promise<string | null>;

  /** Called when a Prevent/Repair action is simulatable. Returns evidence or null. */
  onSandboxSimulate?: (action: string, kind: "prevent" | "repair") => Promise<string | null>;

  /** Progress callback fired as each column completes (includes validation warnings). */
  onColumnComplete?: (column: FearSetColumnName, result: FearColumn, warnings: string[]) => void;

  /** Called when the full run completes (pass or fail). */
  onComplete?: (result: FearSetResult) => void;

  /** RuntimeEvent bus — fired at every key transition for observability. */
  onEvent?: (event: RuntimeEvent) => void;

  /** Check whether the user has signalled "stop fear setting". */
  isStopped?: () => boolean;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface FearSetEngineOptions {
  config?: Partial<FearSetConfig>;
  priorLessons?: string[];
}

// ─── Budget tracking ──────────────────────────────────────────────────────────

interface ColumnBudget {
  startedAt: number;
  tokensUsed: number;
}

function newColumnBudget(): ColumnBudget {
  return { startedAt: Date.now(), tokensUsed: 0 };
}

function isColumnBudgetExhausted(budget: ColumnBudget, config: FearSetConfig): boolean {
  return (
    (Date.now() - budget.startedAt) / 1000 > config.maxSecondsPerColumn ||
    budget.tokensUsed > config.maxTokensPerColumn
  );
}

// ─── RuntimeEvent helper ──────────────────────────────────────────────────────

function emitEvent(
  callbacks: FearSetCallbacks,
  kind: RuntimeEvent["kind"],
  taskId: string,
  payload: Record<string, unknown> = {},
): void {
  const event = buildRuntimeEvent({
    at: new Date().toISOString(),
    kind,
    taskId,
    payload,
  });
  callbacks.onEvent?.(event);
}

// ─── Column content validation ────────────────────────────────────────────────

function validateColumn(col: FearColumn): string[] {
  const warnings: string[] = [];
  switch (col.name) {
    case "define":
      if (col.worstCases.length === 0)
        warnings.push("no worst-cases extracted — define column may be too shallow");
      break;
    case "prevent":
      if (col.preventionActions.length === 0) warnings.push("no prevention actions extracted");
      else if (col.preventionActions.every((a) => !a.mechanism || a.mechanism.trim() === ""))
        warnings.push("all prevention actions are missing mechanism descriptions");
      break;
    case "repair":
      if (col.repairPlans.length === 0) warnings.push("no repair plans extracted");
      else if (col.repairPlans.every((p) => p.steps.length === 0))
        warnings.push("all repair plans have no steps");
      break;
    case "benefits":
      if (col.benefits.length === 0) warnings.push("no benefits extracted");
      break;
    case "inaction":
      if (col.inactionCosts.length === 0) warnings.push("no inaction costs extracted");
      break;
  }
  return warnings;
}

// ─── Fallback column ─────────────────────────────────────────────────────────

function buildFallbackColumn(column: FearSetColumnName, context: string): FearColumn {
  return {
    name: column,
    rawOutput: `[FearSet offline mode] Column "${column}" skipped for: ${context.slice(0, 80)}`,
    worstCases: [],
    preventionActions: [],
    repairPlans: [],
    benefits: [],
    inactionCosts: [],
    stoppedByBudget: false,
    validationWarnings: [`column "${column}" not generated (offline mode)`],
    completedAt: new Date().toISOString(),
  };
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

function parseDefineColumn(parsed: Record<string, unknown>): Pick<FearColumn, "worstCases"> {
  const wc = parsed["worstCases"];
  return {
    worstCases: Array.isArray(wc) ? (wc as string[]).filter((s) => typeof s === "string") : [],
  };
}

function parsePreventColumn(
  parsed: Record<string, unknown>,
): Pick<FearColumn, "preventionActions"> {
  const actions = parsed["preventionActions"];
  if (!Array.isArray(actions)) return { preventionActions: [] };
  return {
    preventionActions: (actions as unknown[]).map((a) => {
      const r = a as Record<string, unknown>;
      const rawStatus = r["simulationStatus"] as string;
      const VALID = new Set([
        "simulatable",
        "partially-simulatable",
        "non-simulatable",
        "simulated",
        "simulation-failed",
      ]);
      const simStatus: PreventionAction["simulationStatus"] = VALID.has(rawStatus)
        ? (rawStatus as PreventionAction["simulationStatus"])
        : "non-simulatable";
      // Integrity: can't claim "simulated" without evidence
      const evidence =
        typeof r["simulationEvidence"] === "string" && r["simulationEvidence"].trim() !== ""
          ? r["simulationEvidence"]
          : undefined;
      const enforcedStatus: PreventionAction["simulationStatus"] =
        simStatus === "simulated" && !evidence ? "partially-simulatable" : simStatus;
      return {
        id: typeof r["id"] === "string" ? r["id"] : randomUUID(),
        description: typeof r["description"] === "string" ? r["description"] : "",
        mechanism: typeof r["mechanism"] === "string" ? r["mechanism"] : "",
        riskReduction:
          typeof r["riskReduction"] === "number"
            ? Math.min(1, Math.max(0, r["riskReduction"]))
            : undefined,
        simulationStatus: enforcedStatus,
        simulationEvidence: evidence,
      };
    }),
  };
}

function parseRepairColumn(parsed: Record<string, unknown>): Pick<FearColumn, "repairPlans"> {
  const plans = parsed["repairPlans"];
  if (!Array.isArray(plans)) return { repairPlans: [] };
  return {
    repairPlans: (plans as unknown[]).map((p) => {
      const r = p as Record<string, unknown>;
      const rawStatus = r["simulationStatus"] as string;
      const VALID = new Set([
        "simulatable",
        "partially-simulatable",
        "non-simulatable",
        "simulated",
        "simulation-failed",
      ]);
      const simStatus: RepairPlan["simulationStatus"] = VALID.has(rawStatus)
        ? (rawStatus as RepairPlan["simulationStatus"])
        : "non-simulatable";
      const evidence =
        typeof r["simulationEvidence"] === "string" && r["simulationEvidence"].trim() !== ""
          ? r["simulationEvidence"]
          : undefined;
      const enforcedStatus: RepairPlan["simulationStatus"] =
        simStatus === "simulated" && !evidence ? "partially-simulatable" : simStatus;
      return {
        id: typeof r["id"] === "string" ? r["id"] : randomUUID(),
        description: typeof r["description"] === "string" ? r["description"] : "",
        steps: Array.isArray(r["steps"]) ? (r["steps"] as string[]) : [],
        estimatedRecovery:
          typeof r["estimatedRecovery"] === "string" ? r["estimatedRecovery"] : undefined,
        simulationStatus: enforcedStatus,
        simulationEvidence: evidence,
      };
    }),
  };
}

function parseBenefitsColumn(parsed: Record<string, unknown>): Pick<FearColumn, "benefits"> {
  const b = parsed["benefits"];
  return { benefits: Array.isArray(b) ? (b as string[]).filter((s) => typeof s === "string") : [] };
}

function parseInactionColumn(parsed: Record<string, unknown>): Pick<FearColumn, "inactionCosts"> {
  const costs = parsed["inactionCosts"];
  if (!Array.isArray(costs)) return { inactionCosts: [] };
  const VALID_SEV = new Set(["low", "medium", "high", "critical"]);
  return {
    inactionCosts: (costs as unknown[]).map((c) => {
      const r = c as Record<string, unknown>;
      return {
        description: typeof r["description"] === "string" ? r["description"] : "",
        timeHorizon: typeof r["timeHorizon"] === "string" ? r["timeHorizon"] : undefined,
        severity: VALID_SEV.has(r["severity"] as string)
          ? (r["severity"] as InactionCost["severity"])
          : "medium",
      } satisfies InactionCost;
    }),
  };
}

function applyParsedToColumn(column: FearColumn, parsed: Record<string, unknown>): FearColumn {
  switch (column.name) {
    case "define":
      return { ...column, ...parseDefineColumn(parsed) };
    case "prevent":
      return { ...column, ...parsePreventColumn(parsed) };
    case "repair":
      return { ...column, ...parseRepairColumn(parsed) };
    case "benefits":
      return { ...column, ...parseBenefitsColumn(parsed) };
    case "inaction":
      return { ...column, ...parseInactionColumn(parsed) };
  }
}

// ─── Heuristic robustness gate ────────────────────────────────────────────────

function heuristicRobustnessScore(
  columns: FearColumn[],
  config: FearSetConfig,
): FearSetRobustnessScore {
  const byName = Object.fromEntries(columns.map((c) => [c.name, c])) as Partial<
    Record<FearSetColumnName, FearColumn>
  >;

  const defineScore = (byName.define?.worstCases.length ?? 0) > 0 ? 0.85 : 0.25;
  const preventScore = (byName.prevent?.preventionActions.length ?? 0) > 0 ? 0.8 : 0.25;
  const repairScore = (byName.repair?.repairPlans.length ?? 0) > 0 ? 0.8 : 0.25;
  const benefitsScore = (byName.benefits?.benefits.length ?? 0) > 0 ? 0.8 : 0.3;
  const inactionScore = (byName.inaction?.inactionCosts.length ?? 0) > 0 ? 0.8 : 0.3;

  const hasSimulation = columns.some((c) =>
    [...(c.preventionActions ?? []), ...(c.repairPlans ?? [])].some(
      (a) => a.simulationStatus === "simulated" && a.simulationEvidence,
    ),
  );

  const avgRiskReduction = (byName.prevent?.preventionActions ?? [])
    .map((a) => a.riskReduction ?? 0)
    .reduce((sum, v, _, arr) => (arr.length ? sum + v / arr.length : sum), 0);

  const columnsPresent = columns.length;
  const weightedAvg =
    columnsPresent >= 3
      ? defineScore * 0.3 +
        preventScore * 0.3 +
        repairScore * 0.2 +
        benefitsScore * 0.1 +
        inactionScore * 0.1
      : (defineScore + preventScore + repairScore) / 3;

  const gateDecision: FearSetRobustnessScore["gateDecision"] =
    weightedAvg >= config.robustnessPassThreshold && avgRiskReduction >= config.minRiskReduction
      ? "pass"
      : weightedAvg >= config.robustnessPassThreshold * 0.75
        ? "review-required"
        : "fail";

  return {
    overall: weightedAvg,
    byColumn: {
      define: defineScore,
      prevent: preventScore,
      repair: repairScore,
      benefits: benefitsScore,
      inaction: inactionScore,
    },
    hasSimulationEvidence: hasSimulation,
    estimatedRiskReduction: avgRiskReduction,
    gateDecision,
    justification:
      gateDecision === "pass"
        ? `Heuristic: define(${defineScore.toFixed(2)}) prevent(${preventScore.toFixed(2)}) repair(${repairScore.toFixed(2)}) — plan has concrete content.`
        : gateDecision === "review-required"
          ? `Heuristic: one or more columns are thin (overall ${weightedAvg.toFixed(2)} < threshold ${config.robustnessPassThreshold}) — review required.`
          : `Heuristic: columns too shallow or risk reduction (${(avgRiskReduction * 100).toFixed(0)}%) below minimum — plan fails gate.`,
    scoredAt: new Date().toISOString(),
  };
}

function parseRobustnessScore(raw: string): FearSetRobustnessScore | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const p = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const VALID_DECISIONS = new Set(["pass", "fail", "review-required"]);
    const decision = VALID_DECISIONS.has(p["gateDecision"] as string)
      ? (p["gateDecision"] as FearSetRobustnessScore["gateDecision"])
      : "fail";
    return {
      overall: typeof p["overall"] === "number" ? Math.min(1, Math.max(0, p["overall"])) : 0,
      byColumn:
        typeof p["byColumn"] === "object" && p["byColumn"] !== null
          ? (p["byColumn"] as FearSetRobustnessScore["byColumn"])
          : undefined,
      hasSimulationEvidence: p["hasSimulationEvidence"] === true,
      estimatedRiskReduction:
        typeof p["estimatedRiskReduction"] === "number"
          ? Math.min(1, Math.max(0, p["estimatedRiskReduction"]))
          : undefined,
      gateDecision: decision,
      justification:
        typeof p["justification"] === "string" ? p["justification"] : "Gate scored by LLM.",
      scoredAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ─── Synthesized recommendation ───────────────────────────────────────────────

function heuristicRecommendation(robustness: FearSetRobustnessScore): FearSetRecommendation {
  const riskReduction = robustness.estimatedRiskReduction ?? 0;
  const hasSimulation = robustness.hasSimulationEvidence;

  if (robustness.gateDecision === "fail") {
    return {
      decision: "no-go",
      reasoning:
        "The fear-set plan did not pass the DanteForge robustness gate. Too many risks are unmitigated or unrepaired.",
      conditions: [],
    };
  }
  if (robustness.gateDecision === "review-required") {
    return {
      decision: "conditional",
      reasoning:
        "Plan passes minimum threshold but has gaps requiring human review before committing.",
      conditions: [
        "Human review of all highlighted warnings",
        "Confirm prevention actions with domain expert",
      ],
    };
  }
  // pass
  if (riskReduction >= 0.5 && hasSimulation) {
    return {
      decision: "go",
      reasoning: `Strong plan: ${(riskReduction * 100).toFixed(0)}% estimated risk reduction with sandbox-verified actions. Proceed.`,
      conditions: [],
    };
  }
  if (riskReduction >= 0.3) {
    return {
      decision: "conditional",
      reasoning: `Reasonable risk reduction (${(riskReduction * 100).toFixed(0)}%) but some prevention/repair steps are unverified.`,
      conditions: hasSimulation
        ? ["Monitor closely during execution"]
        : [
            "Sandbox-test key prevention actions before proceeding",
            "Monitor closely during execution",
          ],
    };
  }
  return {
    decision: "conditional",
    reasoning:
      "Gate passed but estimated risk reduction is low. Proceed cautiously with monitoring.",
    conditions: [
      "Enable detailed logging",
      "Set up automated rollback triggers",
      "Limit blast radius (feature flags, staged rollout)",
    ],
  };
}

function parseSynthesizedRecommendation(raw: string): FearSetRecommendation | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const p = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const VALID_DECISIONS = new Set(["go", "no-go", "conditional"]);
    if (!VALID_DECISIONS.has(p["decision"] as string)) return null;
    return {
      decision: p["decision"] as FearSetRecommendation["decision"],
      reasoning: typeof p["reasoning"] === "string" ? p["reasoning"] : "",
      conditions: Array.isArray(p["conditions"]) ? (p["conditions"] as string[]) : [],
    };
  } catch {
    return null;
  }
}

// ─── Sandbox simulation ───────────────────────────────────────────────────────

async function simulateColumn(
  column: FearColumn,
  callbacks: FearSetCallbacks,
  resultId: string,
): Promise<FearColumn> {
  if (!callbacks.onSandboxSimulate) return column;

  const updatedPreventionActions = await Promise.all(
    column.preventionActions.map(async (action) => {
      if (
        action.simulationStatus !== "simulatable" &&
        action.simulationStatus !== "partially-simulatable"
      )
        return action;
      const evidence = await callbacks.onSandboxSimulate!(action.description, "prevent");
      if (evidence && evidence.trim()) {
        emitEvent(callbacks, "fearset.sandbox.simulated", resultId, {
          kind: "prevent",
          description: action.description,
        });
        return { ...action, simulationStatus: "simulated" as const, simulationEvidence: evidence };
      }
      return { ...action, simulationStatus: "simulation-failed" as const };
    }),
  );

  const updatedRepairPlans = await Promise.all(
    column.repairPlans.map(async (plan) => {
      if (
        plan.simulationStatus !== "simulatable" &&
        plan.simulationStatus !== "partially-simulatable"
      )
        return plan;
      const evidence = await callbacks.onSandboxSimulate!(plan.steps.join("; "), "repair");
      if (evidence && evidence.trim()) {
        emitEvent(callbacks, "fearset.sandbox.simulated", resultId, {
          kind: "repair",
          description: plan.description,
        });
        return { ...plan, simulationStatus: "simulated" as const, simulationEvidence: evidence };
      }
      return { ...plan, simulationStatus: "simulation-failed" as const };
    }),
  );

  return {
    ...column,
    preventionActions: updatedPreventionActions,
    repairPlans: updatedRepairPlans,
  };
}

// ─── Main engine ──────────────────────────────────────────────────────────────

/**
 * Run a bounded DanteFearSet session.
 *
 * Column loop:
 *   1. Check stop signal
 *   2. Check pre-LLM column budget
 *   3. Call LLM (onColumn callback)
 *   4. Add tokens to budget → check post-LLM budget → flag stoppedByBudget
 *   5. Parse column → apply parsed data → validate content
 *   6. Sandbox simulate (prevent/repair)
 *   7. Emit events + fire onColumnComplete
 *
 * After columns:
 *   8. DanteForge robustness gate
 *   9. Synthesized recommendation
 *   10. Emit completion event
 */
export async function runFearSetEngine(
  context: string,
  trigger: FearSetTrigger,
  callbacks: FearSetCallbacks = {},
  options: FearSetEngineOptions = {},
): Promise<FearSetResult> {
  const config: FearSetConfig = { ...DEFAULT_FEARSET_CONFIG, ...options.config };
  const resultId = randomUUID();
  const columns: FearColumn[] = [];
  const columnOrder = config.mode === "lite" ? LITE_COLUMNS : STANDARD_COLUMNS;
  const priorColumnOutputs: Partial<Record<FearSetColumnName, string>> = {};
  const capturedEvents: RuntimeEvent[] = [];
  const trackingCallbacks: FearSetCallbacks = {
    ...callbacks,
    onEvent: (e) => { capturedEvents.push(e); callbacks.onEvent?.(e); },
  };

  emitEvent(trackingCallbacks, "fearset.triggered", resultId, {
    channel: trigger.channel,
    context: context.slice(0, 80),
  });

  const result: FearSetResult = {
    id: resultId,
    trigger,
    context,
    columns: [],
    passed: false,
    mode: config.mode,
    startedAt: new Date().toISOString(),
  };

  // ── Column loop ──────────────────────────────────────────────────────────────
  for (const columnName of columnOrder) {
    // 1. Stop signal check
    if (callbacks.isStopped?.()) {
      result.stopReason = "user-stop";
      result.stoppedAt = new Date().toISOString();
      emitEvent(trackingCallbacks, "fearset.stopped", resultId, {
        reason: "user-stop",
        column: columnName,
      });
      break;
    }

    emitEvent(trackingCallbacks, "fearset.column.started", resultId, { column: columnName });

    const budget = newColumnBudget();
    const userPrompt = buildFearSetColumnPrompt(
      context,
      columnName,
      priorColumnOutputs,
      options.priorLessons ?? [],
    );

    // 2. Pre-LLM budget check
    let stoppedByBudget = false;
    let rawOutput: string | null = null;

    if (!isColumnBudgetExhausted(budget, config) && callbacks.onColumn) {
      rawOutput = await callbacks.onColumn(FEARSET_SYSTEM_PROMPT, userPrompt, columnName);
      // 4. Post-LLM budget check
      budget.tokensUsed += Math.ceil((rawOutput?.length ?? 0) / 4);
      if (isColumnBudgetExhausted(budget, config)) {
        stoppedByBudget = true;
      }
    } else if (isColumnBudgetExhausted(budget, config)) {
      stoppedByBudget = true;
    }

    let column: FearColumn = rawOutput
      ? {
          name: columnName,
          rawOutput,
          worstCases: [],
          preventionActions: [],
          repairPlans: [],
          benefits: [],
          inactionCosts: [],
          stoppedByBudget,
          validationWarnings: [],
          completedAt: new Date().toISOString(),
        }
      : { ...buildFallbackColumn(columnName, context), stoppedByBudget };

    // 5. Parse + validate
    if (rawOutput) {
      const parsed = parseFearSetColumnOutput(rawOutput, columnName);
      if (parsed) column = applyParsedToColumn(column, parsed);
    }
    const warnings = validateColumn(column);
    column = { ...column, validationWarnings: warnings };

    // 6. Sandbox simulation (prevent/repair)
    if (config.sandboxSimulation && (columnName === "prevent" || columnName === "repair")) {
      column = await simulateColumn(column, trackingCallbacks, resultId);
    }

    columns.push(column);
    priorColumnOutputs[columnName] = column.rawOutput;

    emitEvent(trackingCallbacks, "fearset.column.completed", resultId, {
      column: columnName,
      hasContent:
        column.worstCases.length > 0 ||
        column.preventionActions.length > 0 ||
        column.repairPlans.length > 0,
      warnings,
      stoppedByBudget,
    });

    callbacks.onColumnComplete?.(columnName, column, warnings);
  }

  result.columns = columns;

  // Early exit if stopped by user
  if (result.stopReason === "user-stop") {
    result.completedAt = new Date().toISOString();
    result.runtimeEvents = capturedEvents;
    callbacks.onComplete?.(result);
    return result;
  }

  // ── DanteForge robustness gate ────────────────────────────────────────────
  let robustnessScore: FearSetRobustnessScore;

  if (callbacks.onGate) {
    const gatePrompt = buildFearSetRobustnessPrompt(
      columns.map((c) => ({ name: c.name, rawOutput: c.rawOutput })),
      context,
    );
    const gateRaw = await callbacks.onGate(gatePrompt);
    robustnessScore = gateRaw
      ? (parseRobustnessScore(gateRaw) ?? heuristicRobustnessScore(columns, config))
      : heuristicRobustnessScore(columns, config);
  } else {
    robustnessScore = heuristicRobustnessScore(columns, config);
  }

  result.robustnessScore = robustnessScore;
  result.passed = robustnessScore.gateDecision === "pass";

  const gateEvent = result.passed ? "fearset.danteforge.passed" : "fearset.danteforge.failed";
  emitEvent(trackingCallbacks, gateEvent, resultId, {
    overall: robustnessScore.overall,
    gateDecision: robustnessScore.gateDecision,
    estimatedRiskReduction: robustnessScore.estimatedRiskReduction,
  });

  // ── Synthesized recommendation ─────────────────────────────────────────────
  if (callbacks.onSynthesize && columns.length > 0) {
    const md = columns
      .map((c) => `### ${c.name.toUpperCase()}\n${c.rawOutput}`)
      .join("\n\n---\n\n");
    const synthRaw = await callbacks.onSynthesize(md);
    result.synthesizedRecommendation = synthRaw
      ? (parseSynthesizedRecommendation(synthRaw) ?? heuristicRecommendation(robustnessScore))
      : heuristicRecommendation(robustnessScore);
  } else {
    result.synthesizedRecommendation = heuristicRecommendation(robustnessScore);
  }

  if (!result.stopReason) {
    result.stopReason = "completed";
  }
  result.completedAt = new Date().toISOString();
  result.runtimeEvents = capturedEvents;

  callbacks.onComplete?.(result);
  return result;
}
