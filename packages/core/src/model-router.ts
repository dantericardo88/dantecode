// ============================================================================
// @dantecode/core — Model Router Implementation
// ============================================================================

import {
  generateText,
  streamText,
  type CoreMessage,
  type StreamTextResult,
  type CoreTool,
} from "ai";
import type {
  ModelConfig,
  ModelRouterConfig,
  AuditEventType,
  RoutingContext,
  CostEstimate,
  BladeAutoforgeConfig,
} from "@dantecode/config-types";
import { PROVIDER_BUILDERS, type ProviderBuilder } from "./providers/index.js";
import { appendAuditEvent } from "./audit.js";

type ProviderOptionValue =
  | string
  | number
  | boolean
  | null
  | ProviderOptionValue[]
  | { [key: string]: ProviderOptionValue };

type ProviderOptions = Record<string, { [key: string]: ProviderOptionValue }>;

/**
 * Options passed to generate() and stream() methods.
 */
export interface GenerateOptions {
  /** Maximum tokens to generate. Overrides the model config value if set. */
  maxTokens?: number;
  /** System prompt prepended to the conversation. */
  system?: string;
  /** Optional task type key used to look up per-task model overrides. */
  taskType?: string;
  /** Abort signal for cancellation support. */
  abortSignal?: AbortSignal;
  /** Thinking budget for providers that support extended reasoning. */
  thinkingBudget?: number;
}

/**
 * Internal log entry produced during model resolution and generation attempts.
 */
interface RouterLogEntry {
  timestamp: string;
  provider: string;
  modelId: string;
  action: "attempt" | "success" | "fallback" | "error";
  durationMs: number;
  error?: string;
}

// ----------------------------------------------------------------------------
// Blade v1.2 — Cost Routing Constants
// ----------------------------------------------------------------------------

const GROK_FAST_INPUT_PER_MTK = 0.3;
const GROK_FAST_OUTPUT_PER_MTK = 0.6;
const GROK_CAPABLE_INPUT_PER_MTK = 3.0;
const GROK_CAPABLE_OUTPUT_PER_MTK = 6.0;
const ANTHROPIC_INPUT_PER_MTK = 3.0;
const ANTHROPIC_OUTPUT_PER_MTK = 15.0;
const OPENAI_INPUT_PER_MTK = 2.5;
const OPENAI_OUTPUT_PER_MTK = 10.0;
const GOOGLE_INPUT_PER_MTK = 1.25;
const GOOGLE_OUTPUT_PER_MTK = 5.0;
const GROQ_INPUT_PER_MTK = 0.05;
const GROQ_OUTPUT_PER_MTK = 0.1;

// ----------------------------------------------------------------------------
// Blade v1.2 — Persistent Loop (D4)
// ----------------------------------------------------------------------------

/** Exit reason for the agent loop. */
export type LoopExitReason =
  | "natural_completion"
  | "hard_ceiling_reached"
  | "quality_gate_passed"
  | "user_stopped"
  | "error";

/**
 * Three-condition exit gate for the persistent agent loop.
 * Replaces the simple `round >= maxToolRounds` check.
 */
export function shouldContinueLoop(
  toolCallCount: number,
  roundsRemaining: number,
  gstackPassed: boolean,
  pdseScore: number,
  config: BladeAutoforgeConfig,
): { shouldContinue: boolean; reason: LoopExitReason } {
  // Condition 1: Natural completion (model produced no tool calls)
  if (toolCallCount === 0) {
    return { shouldContinue: false, reason: "natural_completion" };
  }
  // Condition 2: Hard ceiling (decremented counter, cannot be reset by model)
  if (roundsRemaining <= 0) {
    return { shouldContinue: false, reason: "hard_ceiling_reached" };
  }
  // Condition 3: Quality gate met (only checked when persistUntilGreen=true)
  if (config.persistUntilGreen && gstackPassed && pdseScore >= 90) {
    return { shouldContinue: false, reason: "quality_gate_passed" };
  }
  return { shouldContinue: true, reason: "natural_completion" };
}

/**
 * ModelRouterImpl is the central model dispatch engine for DanteCode.
 *
 * It resolves the appropriate provider from configuration, attempts generation
 * with the default model, and cascades through the fallback list on failure.
 * Every generation attempt is logged to the audit trail.
 */
export class ModelRouterImpl {
  private readonly routerConfig: ModelRouterConfig;
  private readonly projectRoot: string;
  private readonly sessionId: string;
  private readonly logs: RouterLogEntry[] = [];

  // Blade v1.2 — Cost Routing State (D6)
  private _sessionCostUsd = 0;
  private _sessionTokensUsed = 0;
  private _currentTier: "fast" | "capable" = "fast";
  private _consecutiveGstackFailures = 0;
  // Model-assisted complexity scoring cache
  private _modelRatedComplexity: number | null = null;
  private _firstTurnCompleted = false;

  constructor(routerConfig: ModelRouterConfig, projectRoot: string, sessionId: string) {
    this.routerConfig = routerConfig;
    this.projectRoot = projectRoot;
    this.sessionId = sessionId;
  }

  /**
   * Generates a text completion using the configured model with fallback cascade.
   *
   * Attempts the default provider first, then each fallback provider in order
   * if the default fails. Logs all attempts to the audit trail.
   *
   * @param messages - The conversation messages to send to the model.
   * @param options - Optional generation parameters.
   * @returns The generated text content.
   * @throws The last error encountered if all providers fail.
   */
  async generate(messages: CoreMessage[], options: GenerateOptions = {}): Promise<string> {
    const modelConfig = this.resolveModelConfig(options.taskType);
    const fallbacks = this.routerConfig.fallback;

    // Try the primary model first
    const primaryResult = await this.tryGenerate(modelConfig, messages, options);
    if (primaryResult.success) {
      return primaryResult.text;
    }

    // Cascade through fallbacks
    for (const fallbackConfig of fallbacks) {
      this.logEntry(fallbackConfig, "fallback", 0);

      const fallbackResult = await this.tryGenerate(fallbackConfig, messages, options);

      if (fallbackResult.success) {
        return fallbackResult.text;
      }
    }

    // All providers exhausted — throw the primary error
    throw primaryResult.error;
  }

  /**
   * Streams a text completion using the configured model with fallback cascade.
   *
   * Attempts the default provider first, then each fallback provider in order
   * if the default fails. Returns the streaming result from the `ai` SDK.
   *
   * @param messages - The conversation messages to send to the model.
   * @param options - Optional generation parameters.
   * @returns A StreamTextResult that can be consumed for incremental text.
   * @throws The last error encountered if all providers fail.
   */
  async stream(
    messages: CoreMessage[],
    options: GenerateOptions = {},
  ): Promise<StreamTextResult<Record<string, never>, never>> {
    const modelConfig = this.resolveModelConfig(options.taskType);
    const fallbacks = this.routerConfig.fallback;

    // Try the primary model first
    const primaryResult = await this.tryStream(modelConfig, messages, options);
    if (primaryResult.success) {
      return primaryResult.stream;
    }

    // Cascade through fallbacks
    for (const fallbackConfig of fallbacks) {
      this.logEntry(fallbackConfig, "fallback", 0);

      const fallbackResult = await this.tryStream(fallbackConfig, messages, options);

      if (fallbackResult.success) {
        return fallbackResult.stream;
      }
    }

    // All providers exhausted — throw the primary error
    throw primaryResult.error;
  }

  /**
   * Streams model output with native tool calling support.
   * Tools are defined with Zod schemas (from the AI SDK `tool` format).
   * Unlike `stream()`, the returned stream includes `tool-call` events
   * that the caller can handle without XML parsing.
   *
   * @param messages - The conversation messages.
   * @param tools - Record of tool name → CoreTool definitions (Zod schemas, optional execute).
   * @param options - Optional generation parameters.
   * @returns A StreamTextResult with tool call events in the fullStream.
   */
  async streamWithTools<T extends Record<string, CoreTool>>(
    messages: CoreMessage[],
    tools: T,
    options: GenerateOptions = {},
  ): Promise<StreamTextResult<T, never>> {
    const modelConfig = this.resolveModelConfig(options.taskType);

    // Guard: if the model doesn't support tool calls, throw so the caller
    // can fall back to the XML-parsing path
    if (!modelConfig.supportsToolCalls) {
      throw new Error(
        `Model ${modelConfig.provider}/${modelConfig.modelId} does not support native tool calling`,
      );
    }

    const fallbacks = this.routerConfig.fallback;

    // Try the primary model
    const primaryResult = await this.tryStreamWithTools(modelConfig, messages, tools, options);
    if (primaryResult.success) {
      return primaryResult.stream;
    }

    // Cascade through fallback models that support tool calls
    for (const fallbackConfig of fallbacks) {
      if (!fallbackConfig.supportsToolCalls) continue;
      this.logEntry(fallbackConfig, "fallback", 0);
      const fallbackResult = await this.tryStreamWithTools(
        fallbackConfig,
        messages,
        tools,
        options,
      );
      if (fallbackResult.success) {
        return fallbackResult.stream;
      }
    }

    throw primaryResult.error;
  }

  /**
   * Resolves the appropriate ModelConfig based on an optional task type.
   * If the task type has a per-task override in the router config, that
   * override is returned; otherwise the default model config is used.
   */
  private resolveModelConfig(taskType?: string): ModelConfig {
    if (taskType && taskType in this.routerConfig.overrides) {
      const override = this.routerConfig.overrides[taskType];
      if (override) {
        return override;
      }
    }
    return this.routerConfig.default;
  }

  private buildProviderOptions(
    config: ModelConfig,
    options: GenerateOptions,
  ): ProviderOptions | undefined {
    if (
      !config.supportsExtendedThinking ||
      !options.thinkingBudget ||
      options.thinkingBudget <= 0
    ) {
      return undefined;
    }

    const reasoningEffort = config.reasoningEffort ?? "medium";

    switch (config.provider) {
      case "anthropic":
        return {
          anthropic: {
            thinking: {
              type: "enabled",
              budgetTokens: options.thinkingBudget,
            },
            reasoningEffort,
          },
        };
      case "openai":
        return {
          openai: {
            reasoningEffort,
            thinkingBudget: options.thinkingBudget,
          },
        };
      case "google":
        return {
          google: {
            reasoningEffort,
            thinkingConfig: {
              thinkingBudget: options.thinkingBudget,
            },
          },
        };
      default:
        return {
          [config.provider]: {
            reasoningEffort,
            thinkingBudget: options.thinkingBudget,
          },
        };
    }
  }

  /**
   * Resolves the provider builder function for a given model config.
   *
   * @param config - The ModelConfig whose provider field is looked up.
   * @returns The ProviderBuilder function for the given provider.
   * @throws If the provider name is not found in PROVIDER_BUILDERS.
   */
  resolveProvider(config: ModelConfig): ProviderBuilder {
    const builder = PROVIDER_BUILDERS[config.provider];
    if (!builder) {
      throw new Error(
        `Unknown model provider: "${config.provider}". ` +
          `Available providers: ${Object.keys(PROVIDER_BUILDERS).join(", ")}`,
      );
    }
    return builder;
  }

  /**
   * Attempts a generateText call with a single provider. Returns either
   * the success result or the captured error.
   */
  private async tryGenerate(
    config: ModelConfig,
    messages: CoreMessage[],
    options: GenerateOptions,
  ): Promise<
    { success: true; text: string; error?: never } | { success: false; text: string; error: Error }
  > {
    const startTime = Date.now();

    try {
      const builder = this.resolveProvider(config);
      const model = builder(config);
      const providerOptions = this.buildProviderOptions(config, options);

      this.logEntry(config, "attempt", 0);

      const result = await generateText({
        model,
        messages,
        maxTokens: options.maxTokens ?? config.maxTokens,
        temperature: config.temperature,
        ...(options.system ? { system: options.system } : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        ...(providerOptions ? { providerOptions } : {}),
      });

      const durationMs = Date.now() - startTime;
      this.logEntry(config, "success", durationMs);

      // D6: Track cost for this request
      const inputTokens = result.usage?.promptTokens ?? 0;
      const outputTokens = result.usage?.completionTokens ?? 0;
      this.recordRequestCost(inputTokens, outputTokens, this._currentTier, config.provider);

      // Record the generation event in the audit log
      await this.recordAuditEvent(
        config,
        "session_start",
        durationMs,
        result.usage?.totalTokens ?? 0,
      );

      return { success: true, text: result.text };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      this.logEntry(config, "error", durationMs, error.message);
      return { success: false, text: "", error };
    }
  }

  /**
   * Attempts a streamText call with a single provider. Returns either
   * the streaming result or the captured error.
   *
   * For streaming, we verify the provider/model can be constructed without
   * throwing, then return the stream result. If the initial provider setup
   * fails, we catch the error and allow fallback to proceed.
   */
  private async tryStream(
    config: ModelConfig,
    messages: CoreMessage[],
    options: GenerateOptions,
  ): Promise<
    | {
        success: true;
        stream: StreamTextResult<Record<string, never>, never>;
        error?: never;
      }
    | { success: false; stream: never; error: Error }
  > {
    const startTime = Date.now();

    try {
      const builder = this.resolveProvider(config);
      const model = builder(config);
      const providerOptions = this.buildProviderOptions(config, options);

      this.logEntry(config, "attempt", 0);

      const result = streamText({
        model,
        messages,
        maxTokens: options.maxTokens ?? config.maxTokens,
        temperature: config.temperature,
        ...(options.system ? { system: options.system } : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        onFinish: async ({ usage }) => {
          const durationMs = Date.now() - startTime;
          this.logEntry(config, "success", durationMs);

          // D6: Track cost for this streaming request
          const inputTk = usage?.promptTokens ?? 0;
          const outputTk = usage?.completionTokens ?? 0;
          this.recordRequestCost(inputTk, outputTk, this._currentTier, config.provider);

          await this.recordAuditEvent(config, "session_start", durationMs, usage?.totalTokens ?? 0);
        },
      });

      return {
        success: true,
        stream: result as StreamTextResult<Record<string, never>, never>,
      };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      this.logEntry(config, "error", durationMs, error.message);
      return { success: false, error } as {
        success: false;
        stream: never;
        error: Error;
      };
    }
  }

  /**
   * Attempts a streamText call with tools using a single provider.
   */
  private async tryStreamWithTools<T extends Record<string, CoreTool>>(
    config: ModelConfig,
    messages: CoreMessage[],
    tools: T,
    options: GenerateOptions,
  ): Promise<
    | { success: true; stream: StreamTextResult<T, never>; error?: never }
    | { success: false; stream: never; error: Error }
  > {
    const startTime = Date.now();

    try {
      const builder = this.resolveProvider(config);
      const model = builder(config);
      const providerOptions = this.buildProviderOptions(config, options);

      this.logEntry(config, "attempt", 0);

      const result = streamText({
        model,
        messages,
        tools,
        maxTokens: options.maxTokens ?? config.maxTokens,
        temperature: config.temperature,
        ...(options.system ? { system: options.system } : {}),
        ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
        ...(providerOptions ? { providerOptions } : {}),
        onFinish: async ({ usage }) => {
          const durationMs = Date.now() - startTime;
          this.logEntry(config, "success", durationMs);

          const inputTk = usage?.promptTokens ?? 0;
          const outputTk = usage?.completionTokens ?? 0;
          this.recordRequestCost(inputTk, outputTk, this._currentTier, config.provider);

          await this.recordAuditEvent(config, "session_start", durationMs, usage?.totalTokens ?? 0);
        },
      });

      return { success: true, stream: result as StreamTextResult<T, never> };
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err : new Error(String(err));
      this.logEntry(config, "error", durationMs, error.message);
      return { success: false, error } as { success: false; stream: never; error: Error };
    }
  }

  /**
   * Records a generation event in the audit log.
   */
  private async recordAuditEvent(
    config: ModelConfig,
    type: AuditEventType,
    durationMs: number,
    tokensUsed: number,
  ): Promise<void> {
    try {
      await appendAuditEvent(this.projectRoot, {
        type,
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        modelId: `${config.provider}/${config.modelId}`,
        projectRoot: this.projectRoot,
        payload: {
          tokensUsed,
          durationMs,
          provider: config.provider,
          modelId: config.modelId,
        },
      });
    } catch {
      // Audit logging failures should not break generation.
      // The error is silently swallowed to preserve reliability.
    }
  }

  /**
   * Appends a log entry to the internal router log for diagnostics.
   */
  private logEntry(
    config: ModelConfig,
    action: RouterLogEntry["action"],
    durationMs: number,
    error?: string,
  ): void {
    this.logs.push({
      timestamp: new Date().toISOString(),
      provider: config.provider,
      modelId: config.modelId,
      action,
      durationMs,
      ...(error !== undefined ? { error } : {}),
    });
  }

  /**
   * Returns a snapshot of the internal router logs for debugging and diagnostics.
   */
  getLogs(): readonly RouterLogEntry[] {
    return [...this.logs];
  }

  /**
   * Clears the internal router logs.
   */
  clearLogs(): void {
    this.logs.length = 0;
  }

  // --------------------------------------------------------------------------
  // Blade v1.2 — Smart Cost Routing (D6)
  // --------------------------------------------------------------------------

  /**
   * Analyzes prompt complexity on a 0–1 scale using lexical signals.
   * Harvested from Ruflo's cost-aware routing pattern — keyword-based
   * complexity scoring with semantic depth and scope factors.
   */
  analyzeComplexity(prompt: string): number {
    const lower = prompt.toLowerCase();
    let score = 0;

    // Lexical complexity: presence of high-complexity keywords
    const complexKeywords = [
      "refactor",
      "architect",
      "redesign",
      "migrate",
      "optimize",
      "debug",
      "investigate",
      "security",
      "vulnerability",
      "performance",
      "concurrent",
      "parallel",
      "distributed",
      "transaction",
      "rollback",
      "implement",
      "integration",
      "pipeline",
      "orchestrat",
    ];
    const simpleKeywords = [
      "read",
      "list",
      "show",
      "what is",
      "explain",
      "print",
      "rename",
      "typo",
      "comment",
      "log",
      "hello",
    ];

    const complexHits = complexKeywords.filter((kw) => lower.includes(kw)).length;
    const simpleHits = simpleKeywords.filter((kw) => lower.includes(kw)).length;
    score += Math.min(complexHits * 0.12, 0.5);
    score -= Math.min(simpleHits * 0.1, 0.3);

    // Semantic depth: multi-step instructions (numbered lists, "then", "after that")
    const stepIndicators = (lower.match(/\b(then|next|after that|step \d|finally|\d+\.)\b/g) || [])
      .length;
    score += Math.min(stepIndicators * 0.08, 0.25);

    // Scope factor: long prompts tend to be more complex
    const wordCount = prompt.split(/\s+/).length;
    if (wordCount > 200) score += 0.15;
    else if (wordCount > 100) score += 0.08;
    else if (wordCount > 50) score += 0.04;

    // Code presence: prompts with code blocks are usually harder
    const codeBlocks = (prompt.match(/```/g) || []).length / 2;
    score += Math.min(codeBlocks * 0.06, 0.15);

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Extracts a complexity self-rating from the model's first response.
   * Looks for a [COMPLEXITY: X.X] tag, falls back to heuristic inference.
   * Non-blocking: returns cached value after first call.
   */
  extractModelComplexityRating(responseText: string, userPrompt?: string): number | null {
    if (this._firstTurnCompleted) return this._modelRatedComplexity;
    this._firstTurnCompleted = true;

    // Strategy 1: explicit [COMPLEXITY: X.X] annotation from model response
    const explicitMatch = responseText.match(/\[COMPLEXITY:\s*(0(?:\.\d+)?|1(?:\.0)?)\]/i);
    if (explicitMatch) {
      const score = parseFloat(explicitMatch[1]!);
      if (!isNaN(score) && score >= 0 && score <= 1) {
        this._modelRatedComplexity = score;
        return score;
      }
    }

    // Strategy 2: heuristic inference from user prompt (task complexity)
    // Falls back to response text if no user prompt provided
    const analyzeText = userPrompt ?? responseText;
    const lower = analyzeText.toLowerCase();

    const indicators = {
      fileRefs: (
        analyzeText.match(/\b[\w\-./]+\.(ts|tsx|js|jsx|py|rs|go|java|rb|yaml|json)\b/g) || []
      ).length,
      techKeywords: [
        "refactor",
        "migrate",
        "auth",
        "database",
        "api",
        "deploy",
        "security",
        "integrate",
        "architect",
        "redesign",
        "optimize",
        "concurrent",
        "parallel",
        "distributed",
        "transaction",
        "pipeline",
      ].filter((kw) => lower.includes(kw)).length,
      scopeWords: (lower.match(/\b(all|every|across|entire|each|whole|throughout)\b/g) || [])
        .length,
      conditionals: (
        lower.match(/\b(edge case|handle error|fallback|retry|unless|except)\b/g) || []
      ).length,
      wordCount: analyzeText.split(/\s+/).filter(Boolean).length,
    };

    let inferred = 0.3;
    inferred += Math.min(indicators.fileRefs * 0.04, 0.2);
    inferred += Math.min(indicators.techKeywords * 0.08, 0.3);
    inferred += Math.min(indicators.scopeWords * 0.06, 0.15);
    inferred += Math.min(indicators.conditionals * 0.04, 0.15);
    if (indicators.wordCount > 200) inferred += 0.15;
    else if (indicators.wordCount > 100) inferred += 0.08;
    else if (indicators.wordCount > 50) inferred += 0.04;

    this._modelRatedComplexity = Math.min(1, inferred);
    return this._modelRatedComplexity;
  }

  /** Returns the cached model-rated complexity, or null if not yet computed. */
  getModelRatedComplexity(): number | null {
    return this._modelRatedComplexity;
  }

  /**
   * Selects the appropriate model tier based on routing context.
   * Tier escalation is one-way within a session — once "capable" is selected,
   * it remains "capable" for all subsequent requests.
   *
   * Enhanced with Ruflo-style complexity scoring: if the prompt complexity
   * exceeds the threshold (0.4), the tier is escalated to "capable".
   */
  selectTier(context: RoutingContext): "fast" | "capable" {
    // Complexity-aware routing (Ruflo pattern): use max of lexical and model-rated
    const complexityThreshold = 0.4;
    const lexicalComplexity = context.promptComplexity ?? 0;
    const modelComplexity = context.modelRatedComplexity ?? 0;
    const complexity = Math.max(lexicalComplexity, modelComplexity);

    if (
      this._currentTier === "capable" ||
      context.forceCapable ||
      complexity >= complexityThreshold ||
      context.estimatedInputTokens > 2000 ||
      context.taskType === "autoforge" ||
      context.consecutiveGstackFailures >= 2 ||
      context.filesInScope >= 3
    ) {
      if (this._currentTier !== "capable") {
        this._currentTier = "capable";
        void this.recordAuditEvent(this.routerConfig.default, "tier_escalation", 0, 0);
      }
      return "capable";
    }
    return "fast";
  }

  /**
   * Estimates token count from character count using chars/4 heuristic.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Records the cost of a completed request and accumulates session totals.
   */
  recordRequestCost(
    inputTokens: number,
    outputTokens: number,
    tier: "fast" | "capable",
    provider: string,
  ): CostEstimate {
    let inputRate: number;
    let outputRate: number;
    switch (provider) {
      case "anthropic":
        inputRate = ANTHROPIC_INPUT_PER_MTK;
        outputRate = ANTHROPIC_OUTPUT_PER_MTK;
        break;
      case "openai":
        inputRate = OPENAI_INPUT_PER_MTK;
        outputRate = OPENAI_OUTPUT_PER_MTK;
        break;
      case "google":
        inputRate = GOOGLE_INPUT_PER_MTK;
        outputRate = GOOGLE_OUTPUT_PER_MTK;
        break;
      case "groq":
        inputRate = GROQ_INPUT_PER_MTK;
        outputRate = GROQ_OUTPUT_PER_MTK;
        break;
      case "ollama":
        inputRate = 0;
        outputRate = 0;
        break;
      default:
        // grok and custom — use tier-based grok rates
        inputRate = tier === "capable" ? GROK_CAPABLE_INPUT_PER_MTK : GROK_FAST_INPUT_PER_MTK;
        outputRate = tier === "capable" ? GROK_CAPABLE_OUTPUT_PER_MTK : GROK_FAST_OUTPUT_PER_MTK;
        break;
    }
    const lastCost = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
    this._sessionCostUsd += lastCost;
    this._sessionTokensUsed += inputTokens + outputTokens;
    return {
      sessionTotalUsd: this._sessionCostUsd,
      lastRequestUsd: lastCost,
      modelTier: this._currentTier,
      tokensUsedSession: this._sessionTokensUsed,
    };
  }

  /**
   * Resets session cost accumulator. Called on "new_chat" inbound message.
   */
  resetSessionCost(): void {
    this._sessionCostUsd = 0;
    this._sessionTokensUsed = 0;
    this._currentTier = "fast";
    this._consecutiveGstackFailures = 0;
    this._modelRatedComplexity = null;
    this._firstTurnCompleted = false;
  }

  /**
   * Returns the current cost estimate for the session.
   */
  getCostEstimate(): CostEstimate {
    return {
      sessionTotalUsd: this._sessionCostUsd,
      lastRequestUsd: 0,
      modelTier: this._currentTier,
      tokensUsedSession: this._sessionTokensUsed,
    };
  }

  /**
   * Records a GStack failure to track consecutive failures for tier escalation.
   */
  recordGstackFailure(): void {
    this._consecutiveGstackFailures++;
  }

  /**
   * Resets the GStack failure counter (on success).
   */
  resetGstackFailures(): void {
    this._consecutiveGstackFailures = 0;
  }

  /**
   * Forces escalation to the capable tier for this session.
   */
  forceCapable(): void {
    this.escalateTier("forceCapable");
  }

  /**
   * Escalates the active routing tier to the capable model set and records why.
   * Escalation is one-way within a session.
   */
  escalateTier(reason: string): void {
    this._currentTier = "capable";
    void appendAuditEvent(this.projectRoot, {
      type: "tier_escalation",
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      modelId: `${this.routerConfig.default.provider}/${this.routerConfig.default.modelId}`,
      projectRoot: this.projectRoot,
      payload: {
        reason,
        toTier: "capable",
      },
    });
  }

  /** Returns the current model tier. */
  getCurrentTier(): "fast" | "capable" {
    return this._currentTier;
  }
}
