// ============================================================================
// @dantecode/core — Task Complexity Router
// Routes tasks to appropriate models based on complexity analysis.
// Signal-based classification picks cheapest model for simple tasks,
// mid-tier for standard, strongest for complex.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Signals extracted from a task to determine its complexity. */
export interface TaskSignals {
  /** Estimated token count for the task prompt. */
  tokenCount: number;
  /** Number of files involved in the task. */
  fileCount: number;
  /** Depth of reasoning required (0-100 scale). */
  reasoningDepth: number;
  /** Security sensitivity level (0-100 scale). */
  securitySensitivity: number;
  /** Whether the task involves code generation. */
  hasCodeGeneration: boolean;
  /** Whether the task involves edits across multiple files. */
  hasMultiFileEdit: boolean;
}

/** Complexity tier determined by signal analysis. */
export type ComplexityTier = "simple" | "standard" | "complex";

/** A model option available for routing. */
export interface ModelOption {
  /** Unique model identifier (e.g. "grok-3-mini"). */
  modelId: string;
  /** Provider name (e.g. "grok", "anthropic"). */
  provider: string;
  /** Which complexity tier this model is suited for. */
  tier: ComplexityTier;
  /** Cost per 1M tokens (average of input+output). */
  costPerToken: number;
}

/** A recorded routing decision for evidence chain / audit. */
export interface RoutingDecision {
  /** Unique task identifier. */
  taskId: string;
  /** Computed complexity score (0-100). */
  complexity: number;
  /** Assigned complexity tier. */
  tier: ComplexityTier;
  /** Model ID selected for this task. */
  selectedModel: string;
  /** Human-readable reason for the routing decision. */
  reason: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants — Signal Weights
// ────────────────────────────────────────────────────────────────────────────

const WEIGHT_TOKEN_COUNT = 0.2;
const WEIGHT_FILE_COUNT = 0.2;
const WEIGHT_REASONING_DEPTH = 0.25;
const WEIGHT_SECURITY_SENSITIVITY = 0.15;
const WEIGHT_CODE_GENERATION = 0.1;
const WEIGHT_MULTI_FILE_EDIT = 0.1;

/** Tier boundary: below this is "simple". */
const SIMPLE_THRESHOLD = 15;
/** Tier boundary: above this is "complex". */
const COMPLEX_THRESHOLD = 45;

// ────────────────────────────────────────────────────────────────────────────
// TaskComplexityRouter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Routes tasks to the most cost-effective model based on complexity analysis.
 *
 * Complexity is a weighted sum of task signals normalized to 0-100.
 * The router then picks the cheapest model in the appropriate tier,
 * with fallback to the next higher tier if no model matches.
 */
export class TaskComplexityRouter {
  private decisions: RoutingDecision[] = [];

  /**
   * Computes a raw complexity score from task signals.
   * Returns a value between 0 and 100.
   */
  computeComplexity(signals: TaskSignals): number {
    // Normalize each signal to 0-100 range
    const normalizedTokens = Math.min(signals.tokenCount / 100, 100);
    const normalizedFiles = Math.min(signals.fileCount * 5, 100);
    const normalizedReasoning = Math.min(signals.reasoningDepth, 100);
    const normalizedSecurity = Math.min(signals.securitySensitivity, 100);
    const codeGenScore = signals.hasCodeGeneration ? 100 : 0;
    const multiFileScore = signals.hasMultiFileEdit ? 100 : 0;

    const raw =
      normalizedTokens * WEIGHT_TOKEN_COUNT +
      normalizedFiles * WEIGHT_FILE_COUNT +
      normalizedReasoning * WEIGHT_REASONING_DEPTH +
      normalizedSecurity * WEIGHT_SECURITY_SENSITIVITY +
      codeGenScore * WEIGHT_CODE_GENERATION +
      multiFileScore * WEIGHT_MULTI_FILE_EDIT;

    return Math.round(Math.min(raw, 100) * 100) / 100;
  }

  /**
   * Classifies a task into a complexity tier based on its signals.
   */
  classify(signals: TaskSignals): ComplexityTier {
    const score = this.computeComplexity(signals);
    if (score < SIMPLE_THRESHOLD) return "simple";
    if (score > COMPLEX_THRESHOLD) return "complex";
    return "standard";
  }

  /**
   * Routes a task to the best model for its complexity tier.
   *
   * Selection strategy:
   * 1. Filter models matching the target tier
   * 2. Pick the cheapest (lowest costPerToken)
   * 3. If no model matches, escalate to the next higher tier
   * 4. If still no match, pick the cheapest available model overall
   */
  route(tier: ComplexityTier, availableModels: ModelOption[]): ModelOption {
    if (availableModels.length === 0) {
      throw new Error("No models available for routing");
    }

    // Try exact tier match first
    const tierModels = availableModels
      .filter((m) => m.tier === tier)
      .sort((a, b) => a.costPerToken - b.costPerToken);

    if (tierModels.length > 0) {
      return tierModels[0]!;
    }

    // Escalate: simple -> standard -> complex
    const escalationOrder: ComplexityTier[] = ["simple", "standard", "complex"];
    const currentIndex = escalationOrder.indexOf(tier);

    for (let i = currentIndex + 1; i < escalationOrder.length; i++) {
      const escalatedModels = availableModels
        .filter((m) => m.tier === escalationOrder[i])
        .sort((a, b) => a.costPerToken - b.costPerToken);
      if (escalatedModels.length > 0) {
        return escalatedModels[0]!;
      }
    }

    // Final fallback: cheapest model regardless of tier
    const sorted = [...availableModels].sort((a, b) => a.costPerToken - b.costPerToken);
    return sorted[0]!;
  }

  /**
   * Records a routing decision for audit/evidence chain.
   */
  logRoutingDecision(decision: RoutingDecision): void {
    this.decisions.push(decision);
  }

  /**
   * Returns all recorded routing decisions.
   */
  getDecisions(): RoutingDecision[] {
    return [...this.decisions];
  }

  /**
   * Convenience method: classify + route + log in one call.
   */
  routeTask(
    taskId: string,
    signals: TaskSignals,
    availableModels: ModelOption[],
  ): { model: ModelOption; decision: RoutingDecision } {
    const complexity = this.computeComplexity(signals);
    const tier = this.classify(signals);
    const model = this.route(tier, availableModels);

    const decision: RoutingDecision = {
      taskId,
      complexity,
      tier,
      selectedModel: model.modelId,
      reason: `Complexity ${complexity} -> tier "${tier}" -> model "${model.modelId}" (cost: ${model.costPerToken})`,
    };

    this.logRoutingDecision(decision);
    return { model, decision };
  }
}
