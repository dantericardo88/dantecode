// ============================================================================
// Extended ReAct Reasoning Chain — Think → Critique → Distill → Act
// Harvested from OpenHands CodeAct + Aider verification chains + Qwen long-CoT.
// Provides tiered reasoning (quick/deep/expert), PDSE-driven self-critique,
// and playbook distillation for cross-session learning.
// ============================================================================

import { tokenize, jaccardSimilarity } from "./approach-memory.js";
import { verifyOutput, type OutputVerificationReport, type VerificationCriteria } from "./qa-harness.js";
import type { VerificationRail } from "./rails-enforcer.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single phase within a reasoning chain. */
export interface ReasoningPhase {
  /** The kind of reasoning phase. */
  type: "thinking" | "critique" | "action" | "observe";
  /** The textual content of this phase. */
  content: string;
  /** PDSE score (0-1) if this phase was critiqued. */
  pdseScore?: number;
  /** ISO timestamp of when this phase was created. */
  timestamp: string;
}

/** Configuration options for the reasoning chain. */
export interface ReasoningChainOptions {
  /** Run self-critique every N turns. Default: 5 */
  critiqueEveryNTurns: number;
  /** PDSE threshold below which the chain auto-escalates tier. Default: 0.75 */
  autoEscalateThreshold: number;
  /** Maximum chain depth before forced termination. Default: 50 */
  maxChainDepth: number;
  /** Whether to distill successful patterns into playbook bullets. Default: true */
  playbookDistill: boolean;
}

/** A single recorded step in the chain. */
export interface ChainStep {
  /** 1-based step number. */
  stepNumber: number;
  /** The reasoning phase for this step. */
  phase: ReasoningPhase;
  /** Root cause identified during critique (if any). */
  rootCause?: string;
  /** Playbook bullets distilled from this step (if any). */
  playbookBullets?: string[];
  /** Whether the tier was escalated during this step. */
  escalated: boolean;
}

/** Reasoning complexity tier. */
export type ReasoningTier = "quick" | "deep" | "expert";

/** Result of a PDSE-driven self-critique. */
export interface CritiqueResult {
  /** The PDSE score (0-1). */
  score: number;
  /** Root cause analysis if score is below threshold. */
  rootCause?: string;
  /** Whether the chain should escalate to a higher tier. */
  shouldEscalate: boolean;
  /** Human-readable recommendation based on the score. */
  recommendation: string;
}

/** Optional verification configuration for a reasoning phase. */
export interface VerifyReasoningPhaseOptions {
  /** Verification criteria applied to the phase content. */
  criteria?: VerificationCriteria;
  /** Runtime rails applied to the phase content. */
  rails?: VerificationRail[];
}

/** Result of verifying a reasoning phase against the QA harness. */
export interface ReasoningVerificationResult {
  /** Full QA report for the phase content. */
  report: OutputVerificationReport;
  /** Self-critique derived from the QA score. */
  critique: CritiqueResult;
  /** Recorded chain step with PDSE score attached to the phase. */
  step: ChainStep;
  /** Current tier after any automatic escalation. */
  tierAfterReview: ReasoningTier;
}

// ----------------------------------------------------------------------------
// Defaults
// ----------------------------------------------------------------------------

const DEFAULT_OPTIONS: ReasoningChainOptions = {
  critiqueEveryNTurns: 5,
  autoEscalateThreshold: 0.75,
  maxChainDepth: 50,
  playbookDistill: true,
};

// ----------------------------------------------------------------------------
// Root cause patterns used by selfCritique
// ----------------------------------------------------------------------------

const ROOT_CAUSE_PATTERNS: Array<{ pattern: RegExp; cause: string }> = [
  { pattern: /\b(missing|lack|no)\b.*\b(context|information|data)\b/i, cause: "missing context" },
  { pattern: /\b(incomplete|partial|half)\b.*\b(analysis|review|check)\b/i, cause: "incomplete analysis" },
  { pattern: /\b(wrong|incorrect|bad)\b.*\b(approach|method|strategy)\b/i, cause: "wrong approach" },
];

// ----------------------------------------------------------------------------
// ReasoningChain
// ----------------------------------------------------------------------------

/**
 * Extended ReAct reasoning chain with tiered thinking, PDSE-driven
 * self-critique, and playbook distillation.
 *
 * Usage:
 *   const chain = new ReasoningChain({ critiqueEveryNTurns: 3 });
 *   const tier = chain.decideTier(0.6, { errorCount: 1, toolCalls: 8 });
 *   const thought = chain.think("Fix the auth bug", "user login fails", tier);
 *   chain.recordStep(thought);
 *   if (chain.shouldCritique()) {
 *     const critique = chain.selfCritique(thought, 0.72);
 *     // ...
 *   }
 */
export class ReasoningChain {
  private history: ChainStep[] = [];
  private stepCounter = 0;
  private currentTier: ReasoningTier = "quick";
  private readonly options: ReasoningChainOptions;
  private tierOutcomes: Map<ReasoningTier, { totalPdse: number; count: number }> = new Map([
    ["quick", { totalPdse: 0, count: 0 }],
    ["deep", { totalPdse: 0, count: 0 }],
    ["expert", { totalPdse: 0, count: 0 }],
  ]);

  constructor(options?: Partial<ReasoningChainOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  // --------------------------------------------------------------------------
  // Tier selection
  // --------------------------------------------------------------------------

  /**
   * Decide reasoning tier based on task complexity and context.
   *
   * - quick: complexity < 0.3 OR (errorCount === 0 AND toolCalls < 5)
   * - deep:  complexity < 0.7 OR errorCount < 3
   * - expert: everything else
   */
  decideTier(
    taskComplexity: number,
    context: {
      errorCount: number;
      toolCalls: number;
      costMultiplier?: number;
      remainingBudget?: number;
    },
  ): ReasoningTier {
    const costMult = context.costMultiplier ?? 1.0;
    const budgetPressure = context.remainingBudget !== undefined && context.remainingBudget < 50000;
    const costBias = costMult > 3.0 ? 0.15 : costMult > 1.5 ? 0.05 : 0;
    const budgetBias = budgetPressure ? 0.1 : 0;
    const adaptiveBias = this.getAdaptiveBias();
    const adjustedComplexity = taskComplexity - costBias - budgetBias + adaptiveBias;

    if (adjustedComplexity < 0.3 || (context.errorCount === 0 && context.toolCalls < 5)) {
      this.currentTier = "quick";
      return "quick";
    }
    if (adjustedComplexity < 0.7 || context.errorCount < 3) {
      this.currentTier = "deep";
      return "deep";
    }
    this.currentTier = "expert";
    return "expert";
  }

  // --------------------------------------------------------------------------
  // Thinking
  // --------------------------------------------------------------------------

  /**
   * Generate a thinking phase for the given task and context.
   * The prompt depth varies by tier.
   */
  think(task: string, context: string, tier?: ReasoningTier): ReasoningPhase {
    const effectiveTier = tier ?? this.currentTier;

    let content: string;
    switch (effectiveTier) {
      case "quick":
        content = `Consider the most direct approach to: ${task}`;
        break;
      case "deep":
        content =
          `Analyze step-by-step: 1) What is being asked 2) What tools/files are needed ` +
          `3) What could go wrong 4) Best approach for: ${task}`;
        break;
      case "expert":
        content =
          `Deep analysis required: 1) Decompose the problem 2) Consider edge cases ` +
          `3) Review similar past approaches 4) Identify dependencies ` +
          `5) Plan verification strategy for: ${task}`;
        break;
    }

    if (context) {
      content += `\nContext: ${context}`;
    }

    return {
      type: "thinking",
      content,
      timestamp: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // Self-critique
  // --------------------------------------------------------------------------

  /**
   * PDSE-driven self-critique of a thinking phase.
   *
   * - score is the PDSE score passed through
   * - If score < 0.8, attempts to identify root cause from content patterns
   * - shouldEscalate when score < autoEscalateThreshold
   * - Recommendation ranges:
   *   - >= 0.9 "Proceed with current approach"
   *   - >= 0.8 "Minor adjustments recommended"
   *   - >= autoEscalateThreshold "Re-evaluate approach — consider alternative strategies"
   *   - below "Escalate to higher reasoning tier — significant issues detected"
   */
  selfCritique(thought: ReasoningPhase, pdseScore: number, context?: string): CritiqueResult {
    const shouldEscalate = pdseScore < this.options.autoEscalateThreshold;

    // Root cause analysis for lower scores
    let rootCause: string | undefined;
    if (pdseScore < 0.8) {
      const textToAnalyze = context ? `${thought.content} ${context}` : thought.content;
      for (const { pattern, cause } of ROOT_CAUSE_PATTERNS) {
        if (pattern.test(textToAnalyze)) {
          rootCause = cause;
          break;
        }
      }
      // Fallback root cause if no pattern matched
      if (!rootCause) {
        rootCause = "unidentified issue — needs deeper investigation";
      }
    }

    // Recommendation based on score ranges
    let recommendation: string;
    if (pdseScore >= 0.9) {
      recommendation = "Proceed with current approach";
    } else if (pdseScore >= 0.8) {
      recommendation = "Minor adjustments recommended";
    } else if (pdseScore >= this.options.autoEscalateThreshold) {
      recommendation = "Re-evaluate approach — consider alternative strategies";
    } else {
      recommendation = "Escalate to higher reasoning tier — significant issues detected";
    }

    return { score: pdseScore, rootCause, shouldEscalate, recommendation };
  }

  // --------------------------------------------------------------------------
  // Critique timing
  // --------------------------------------------------------------------------

  /**
   * Returns true when self-critique should be run this turn.
   * Fires every `critiqueEveryNTurns` steps, never on step 0.
   */
  shouldCritique(): boolean {
    return this.stepCounter > 0 && this.stepCounter % this.options.critiqueEveryNTurns === 0;
  }

  // --------------------------------------------------------------------------
  // Playbook distillation
  // --------------------------------------------------------------------------

  /**
   * Distill winning approaches from chain steps into playbook bullets.
   * - Extracts from steps where pdseScore >= 0.85
   * - Deduplicates via Jaccard similarity (> 0.8 = duplicate)
   * - Returns at most 5 bullets
   */
  distillPlaybook(steps: ChainStep[]): string[] {
    // Extract successful patterns
    const candidates = steps
      .filter((s) => s.phase.pdseScore !== undefined && s.phase.pdseScore >= 0.85)
      .map((s) => s.phase.content);

    if (candidates.length === 0) return [];

    // Deduplicate via Jaccard similarity
    const unique: string[] = [];
    for (const candidate of candidates) {
      const candidateTokens = tokenize(candidate);
      const isDuplicate = unique.some(
        (existing) => jaccardSimilarity(candidateTokens, tokenize(existing)) > 0.8,
      );
      if (!isDuplicate) {
        unique.push(candidate);
      }
    }

    // Return top 5
    return unique.slice(0, 5);
  }

  // --------------------------------------------------------------------------
  // Step recording
  // --------------------------------------------------------------------------

  /**
   * Record a completed step and add it to history.
   * Increments the step counter.
   */
  recordStep(
    phase: ReasoningPhase,
    rootCause?: string,
    playbookBullets?: string[],
    escalated = false,
  ): ChainStep {
    this.stepCounter++;
    const step: ChainStep = {
      stepNumber: this.stepCounter,
      phase,
      rootCause,
      playbookBullets,
      escalated,
    };
    this.history.push(step);
    return step;
  }

  // --------------------------------------------------------------------------
  // Prompt formatting
  // --------------------------------------------------------------------------

  /**
   * Format the chain for prompt injection, showing the last `limit` steps.
   * Format: "[Think] content" or "[Critique PDSE=0.85] content" etc.
   */
  formatChainForPrompt(limit = 10): string {
    if (this.history.length === 0) return "";

    const steps = this.history.slice(-limit);

    return steps
      .map((step) => {
        const { phase } = step;
        let prefix: string;
        switch (phase.type) {
          case "thinking":
            prefix = "[Think]";
            break;
          case "critique":
            prefix = phase.pdseScore !== undefined ? `[Critique PDSE=${phase.pdseScore}]` : "[Critique]";
            break;
          case "action":
            prefix = "[Act]";
            break;
          case "observe":
            prefix = "[Observe]";
            break;
        }
        return `${prefix} ${phase.content}`;
      })
      .join("\n");
  }

  // --------------------------------------------------------------------------
  // Accessors
  // --------------------------------------------------------------------------

  /** Get current reasoning tier. */
  getCurrentTier(): ReasoningTier {
    return this.currentTier;
  }

  /** Get full step history. */
  getHistory(): ChainStep[] {
    return [...this.history];
  }

  /** Get current step count. */
  getStepCount(): number {
    return this.stepCounter;
  }

  /**
   * Verify a reasoning phase with the shared QA harness, record it in history,
   * and auto-escalate the tier when the score falls below the configured threshold.
   */
  verifyPhase(
    task: string,
    phase: ReasoningPhase,
    options: VerifyReasoningPhaseOptions = {},
  ): ReasoningVerificationResult {
    const report = verifyOutput({
      task,
      output: phase.content,
      ...(options.criteria ? { criteria: options.criteria } : {}),
      ...(options.rails ? { rails: options.rails } : {}),
    });
    const scoredPhase: ReasoningPhase = {
      ...phase,
      pdseScore: report.pdseScore,
    };
    const critique = this.selfCritique(
      scoredPhase,
      report.pdseScore,
      report.warnings.join(" "),
    );

    if (critique.shouldEscalate) {
      this.currentTier = this.escalateTier();
    }

    const playbookBullets =
      this.options.playbookDistill && report.pdseScore >= 0.85
        ? this.distillPlaybook([
            {
              stepNumber: this.stepCounter + 1,
              phase: scoredPhase,
              escalated: critique.shouldEscalate,
            },
          ])
        : undefined;

    const step = this.recordStep(
      scoredPhase,
      critique.rootCause,
      playbookBullets,
      critique.shouldEscalate,
    );

    return {
      report,
      critique,
      step,
      tierAfterReview: this.currentTier,
    };
  }

  // --------------------------------------------------------------------------
  // Reset
  // --------------------------------------------------------------------------

  /** Reset chain for a new task. Clears history, counter, and tier. */
  reset(): void {
    this.history = [];
    this.stepCounter = 0;
    this.currentTier = "quick";
    this.tierOutcomes = new Map([
      ["quick", { totalPdse: 0, count: 0 }],
      ["deep", { totalPdse: 0, count: 0 }],
      ["expert", { totalPdse: 0, count: 0 }],
    ]);
  }

  /**
   * Record a PDSE outcome for a tier to feed the adaptive bias system.
   */
  recordTierOutcome(tier: ReasoningTier, pdseScore: number): void {
    const entry = this.tierOutcomes.get(tier)!;
    entry.totalPdse += pdseScore;
    entry.count += 1;
  }

  /**
   * Returns average PDSE per tier, or undefined if fewer than 3 samples.
   */
  getTierPerformance(): Partial<Record<ReasoningTier, number>> {
    const result: Partial<Record<ReasoningTier, number>> = {};
    for (const [tier, { totalPdse, count }] of this.tierOutcomes) {
      if (count >= 3) {
        result[tier] = totalPdse / count;
      }
    }
    return result;
  }

  /**
   * Compute adaptive bias from historical tier performance.
   * Returns a negative value to reduce effective complexity (biases toward lower tier).
   *
   * - -0.1 when quick tier consistently exceeds 0.85 PDSE (quick is working well)
   * - -0.05 when expert doesn't meaningfully outperform deep (> 0.05 margin)
   * -  0   otherwise
   */
  getAdaptiveBias(): number {
    const perf = this.getTierPerformance();
    const quickAvg = perf.quick;
    const deepAvg = perf.deep;
    const expertAvg = perf.expert;

    if (quickAvg !== undefined && quickAvg > 0.85) {
      return -0.1;
    }
    if (expertAvg !== undefined && deepAvg !== undefined && expertAvg - deepAvg <= 0.05) {
      return -0.05;
    }
    return 0;
  }

  private escalateTier(): ReasoningTier {
    if (this.currentTier === "quick") {
      return "deep";
    }
    return "expert";
  }
}

// ----------------------------------------------------------------------------
// Module-level utility: cost multiplier heuristic
// ----------------------------------------------------------------------------

/**
 * Returns a cost multiplier for the given model to inform tier selection.
 * Opus/o1-pro = 5.0, Sonnet/GPT-4/Grok-3 = 2.0, Haiku/mini/flash = 0.5, default = 1.0.
 */
export function getCostMultiplier(model: { provider: string; modelId: string }): number {
  const id = model.modelId.toLowerCase();
  if (id.includes("opus") || id.includes("o1-pro")) return 5.0;
  if (id.includes("sonnet") || id.includes("gpt-4") || id.includes("grok-3")) return 2.0;
  if (id.includes("haiku") || id.includes("mini") || id.includes("flash")) return 0.5;
  return 1.0;
}
