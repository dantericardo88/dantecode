// ============================================================================
// @dantecode/core — Task Complexity Router
// Classifies tasks as simple/standard/complex and routes to the appropriate
// model tier based on extracted signals.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type TaskComplexity = "simple" | "standard" | "complex";

export interface ComplexitySignals {
  promptTokens: number;
  fileCount: number;
  hasReasoning: boolean;
  hasSecurity: boolean;
  hasMultiFile: boolean;
  estimatedOutputTokens: number;
}

export interface ComplexityDecision {
  complexity: TaskComplexity;
  /** Confidence in the classification, 0-1. */
  confidence: number;
  signals: ComplexitySignals;
  /** Model ID recommended for this decision. */
  recommendedModel: string;
  /** Human-readable explanation. */
  rationale: string;
  /** User-supplied override, if any. */
  override?: string;
  evidenceLogged: boolean;
}

export interface ComplexityRouterConfig {
  simpleModel?: string;
  standardModel?: string;
  complexModel?: string;
  thresholds?: {
    simpleMaxTokens?: number;
    complexMinTokens?: number;
    complexMinFiles?: number;
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Default constants
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_SIMPLE_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_STANDARD_MODEL = "claude-sonnet-4-6";
const DEFAULT_COMPLEX_MODEL = "claude-opus-4-6";

const DEFAULT_SIMPLE_MAX_TOKENS = 2000;
const DEFAULT_COMPLEX_MIN_TOKENS = 8000;
const DEFAULT_COMPLEX_MIN_FILES = 5;

// Security-related keywords for signal extraction
const SECURITY_KEYWORDS = [
  "secret",
  "auth",
  "password",
  "token",
  "credential",
  "api_key",
  "apikey",
  "private_key",
  "privatekey",
  "encryption",
  "certificate",
  "oauth",
  "jwt",
  "hmac",
];

// Reasoning-related keywords for signal extraction
const REASONING_KEYWORDS = [
  "analyze",
  "analyse",
  "compare",
  "evaluate",
  "design",
  "architect",
  "investigate",
  "assess",
  "diagnose",
  "plan",
  "strategy",
  "tradeoff",
  "trade-off",
  "recommend",
  "decide",
  "judge",
];

// ────────────────────────────────────────────────────────────────────────────
// TaskComplexityRouter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Classifies tasks as simple / standard / complex and maps each tier to the
 * appropriate model.
 *
 * Classification rules:
 * - **simple**:   promptTokens < simpleMaxTokens AND fileCount <= 1
 *                 AND no reasoning / security / multi-file signals → haiku
 * - **complex**:  promptTokens > complexMinTokens OR fileCount >= complexMinFiles
 *                 OR (hasSecurity AND hasReasoning) → opus
 * - **standard**: everything else → sonnet
 */
export class TaskComplexityRouter {
  private readonly simpleModel: string;
  private readonly standardModel: string;
  private readonly complexModel: string;
  private readonly simpleMaxTokens: number;
  private readonly complexMinTokens: number;
  private readonly complexMinFiles: number;

  constructor(config?: ComplexityRouterConfig) {
    this.simpleModel = config?.simpleModel ?? DEFAULT_SIMPLE_MODEL;
    this.standardModel = config?.standardModel ?? DEFAULT_STANDARD_MODEL;
    this.complexModel = config?.complexModel ?? DEFAULT_COMPLEX_MODEL;
    this.simpleMaxTokens = config?.thresholds?.simpleMaxTokens ?? DEFAULT_SIMPLE_MAX_TOKENS;
    this.complexMinTokens = config?.thresholds?.complexMinTokens ?? DEFAULT_COMPLEX_MIN_TOKENS;
    this.complexMinFiles = config?.thresholds?.complexMinFiles ?? DEFAULT_COMPLEX_MIN_FILES;
  }

  /**
   * Returns the model ID for a given complexity tier.
   */
  getModel(complexity: TaskComplexity): string {
    switch (complexity) {
      case "simple":
        return this.simpleModel;
      case "standard":
        return this.standardModel;
      case "complex":
        return this.complexModel;
    }
  }

  /**
   * Classifies signals into a complexity tier and returns a full decision.
   *
   * @param signals - Extracted signals for the task.
   * @param override - Optional explicit complexity set by the user.
   */
  classify(signals: ComplexitySignals, override?: TaskComplexity): ComplexityDecision {
    let complexity: TaskComplexity;
    let rationale: string;
    let confidence: number;

    if (override) {
      complexity = override;
      rationale = `User-supplied override: ${override}`;
      confidence = 1.0;
    } else {
      // Complex conditions
      const isComplexByTokens = signals.promptTokens > this.complexMinTokens;
      const isComplexByFiles = signals.fileCount >= this.complexMinFiles;
      const isComplexBySecurityReasoning = signals.hasSecurity && signals.hasReasoning;

      if (isComplexByTokens || isComplexByFiles || isComplexBySecurityReasoning) {
        complexity = "complex";
        const reasons: string[] = [];
        if (isComplexByTokens)
          reasons.push(`promptTokens (${signals.promptTokens}) > ${this.complexMinTokens}`);
        if (isComplexByFiles)
          reasons.push(`fileCount (${signals.fileCount}) >= ${this.complexMinFiles}`);
        if (isComplexBySecurityReasoning) reasons.push("hasSecurity + hasReasoning");
        rationale = `Complex: ${reasons.join("; ")}`;
        confidence = 0.9;
      } else if (
        signals.promptTokens < this.simpleMaxTokens &&
        signals.fileCount <= 1 &&
        !signals.hasReasoning &&
        !signals.hasSecurity &&
        !signals.hasMultiFile
      ) {
        complexity = "simple";
        rationale = `Simple: promptTokens (${signals.promptTokens}) < ${this.simpleMaxTokens}, single file, no special signals`;
        confidence = 0.95;
      } else {
        complexity = "standard";
        rationale = "Standard: does not meet simple or complex thresholds";
        confidence = 0.8;
      }
    }

    return {
      complexity,
      confidence,
      signals,
      recommendedModel: this.getModel(complexity),
      rationale,
      override: override ?? undefined,
      evidenceLogged: false,
    };
  }

  /**
   * Extracts complexity signals from a raw prompt string.
   *
   * @param prompt - The raw task prompt text.
   * @param context - Optional supplementary context (file list, security flag).
   */
  extractSignals(
    prompt: string,
    context?: { files?: string[]; hasSecurity?: boolean },
  ): ComplexitySignals {
    const lower = prompt.toLowerCase();

    // Token estimation: ~4 chars per token
    const promptTokens = Math.ceil(prompt.length / 4);

    // File count: from context.files, or count file-like references in prompt
    let fileCount = context?.files?.length ?? 0;
    if (fileCount === 0) {
      // Heuristic: count unique file extensions mentioned
      const fileMatches = prompt.match(/\b[\w\-/.]+\.\w{1,6}\b/g);
      fileCount = fileMatches ? new Set(fileMatches).size : 0;
    }

    // Multi-file: more than one file
    const hasMultiFile = fileCount > 1;

    // Security detection
    const hasSecurity =
      context?.hasSecurity ??
      SECURITY_KEYWORDS.some((kw) => lower.includes(kw));

    // Reasoning detection
    const hasReasoning = REASONING_KEYWORDS.some((kw) => lower.includes(kw));

    // Estimated output tokens: rough heuristic = 50% of input tokens
    const estimatedOutputTokens = Math.ceil(promptTokens * 0.5);

    return {
      promptTokens,
      fileCount,
      hasReasoning,
      hasSecurity,
      hasMultiFile,
      estimatedOutputTokens,
    };
  }
}
