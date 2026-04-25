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
import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PROVIDER_BUILDERS, type ProviderBuilder } from "./providers/index.js";
import { appendAuditEvent } from "./audit.js";
import { classifyApiError } from "./api-error-classifier.js";
import { getProviderExecutionProfile } from "./provider-execution-profile.js";
import {
  SemanticModelOutputError,
  isEmptyModelText,
  isEmptyToolCallFinish,
} from "./model-output-health.js";
import { retryWithBackoff } from "./retry-policy.js";
import {
  routeByComplexity,
  detectAvailableProviders,
  type TaskSignals,
  type RoutedModel,
} from "./task-complexity-router.js";
import {
  shouldUsePromptCache,
  buildCacheablePrompt,
  estimateCacheSavings,
} from "./prompt-cache.js";
import { globalCacheMetrics } from "./cache-metrics.js";

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

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
  action: "attempt" | "success" | "fallback" | "retry" | "error" | "blocked";
  durationMs: number;
  error?: string;
}

function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    Symbol.asyncIterator in value
  );
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
  private _budgetExceeded = false;
  private _budgetWarningSent = false;
  // Model-assisted complexity scoring cache
  private _modelRatedComplexity: number | null = null;
  private _firstTurnCompleted = false;
  // Health-event-driven degraded provider set (dim 24 — proactive skip, not just reporting)
  private readonly _degradedProviders = new Set<string>();

  constructor(routerConfig: ModelRouterConfig, projectRoot: string, sessionId: string) {
    this.routerConfig = routerConfig;
    this.projectRoot = projectRoot;
    this.sessionId = sessionId;
  }

  /**
   * Register a CircuitBreaker to receive health events and proactively skip
   * providers that are in the "open" state from the fallback cascade (dim 24).
   */
  registerCircuitBreaker(breaker: { onHealthEvent(l: (e: { provider: string; state: string }) => void): void }): void {
    breaker.onHealthEvent((e) => {
      if (e.state === "open") {
        this._degradedProviders.add(e.provider);
        process.stdout.write(`[Router] Provider "${e.provider}" marked degraded — will skip in fallback cascade.\n`);
      } else if (e.state === "closed") {
        this._degradedProviders.delete(e.provider);
      }
    });
  }

  /** Returns whether a provider identifier is currently marked as degraded. */
  isProviderDegraded(provider: string): boolean {
    return this._degradedProviders.has(provider);
  }

  /** Mark a provider degraded after semantic failures, not only transport failures. */
  markProviderDegraded(provider: string, reason = "semantic provider degradation"): void {
    this._degradedProviders.add(provider);
    process.stdout.write(`[Router] Provider "${provider}" marked degraded — ${reason}.\n`);
  }

  /**
   * Returns the optimal model for a task given complexity signals.
   * Uses task-complexity-router to select the cheapest capable model.
   */
  static routeForTask(signals: TaskSignals): RoutedModel {
    const availableProviders = detectAvailableProviders();
    return routeByComplexity(signals, availableProviders);
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
    const estimatedTokens = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0) / 4;
    const modelConfig = this.resolveModelConfig(options.taskType, estimatedTokens);
    const fallbacks = this.routerConfig.fallback;

    // Try the primary model first unless semantic/runtime health has degraded it.
    const primaryResult = this._degradedProviders.has(modelConfig.provider)
      ? this.blockedProviderResult(modelConfig, "provider degraded by semantic health")
      : await this.tryGenerate(modelConfig, messages, options);
    if (primaryResult.success) {
      return primaryResult.text;
    }
    if (primaryResult.error instanceof BudgetExceededError) {
      throw primaryResult.error;
    }

    // Cascade through fallbacks — skip providers marked degraded by health events (dim 24)
    for (const fallbackConfig of fallbacks) {
      if (this._degradedProviders.has(fallbackConfig.provider)) {
        process.stdout.write(`[Router] Skipping degraded provider "${fallbackConfig.provider}" in fallback cascade.\n`);
        this.logEntry(fallbackConfig, "blocked", 0, "provider degraded by health event");
        continue;
      }
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
    const estimatedTokens = messages.reduce((n, m) => n + (typeof m.content === "string" ? m.content.length : 0), 0) / 4;
    const modelConfig = this.resolveModelConfig(options.taskType, estimatedTokens);
    const fallbacks = this.routerConfig.fallback;

    // Try the primary model first unless semantic/runtime health has degraded it.
    const primaryResult = this._degradedProviders.has(modelConfig.provider)
      ? this.blockedStreamResult(modelConfig, "provider degraded by semantic health")
      : await this.tryStream(modelConfig, messages, options);
    if (primaryResult.success) {
      return this.wrapTextStreamWithSemanticHealth(
        primaryResult.stream,
        modelConfig,
        messages,
        options,
        fallbacks,
      );
    }
    if (primaryResult.error instanceof BudgetExceededError) {
      throw primaryResult.error;
    }

    // Cascade through fallbacks
    for (let i = 0; i < fallbacks.length; i++) {
      const fallbackConfig = fallbacks[i]!;
      if (this._degradedProviders.has(fallbackConfig.provider)) {
        process.stdout.write(`[Router] Skipping degraded provider "${fallbackConfig.provider}" in fallback cascade.\n`);
        this.logEntry(fallbackConfig, "blocked", 0, "provider degraded by health event");
        continue;
      }
      this.logEntry(fallbackConfig, "fallback", 0);

      const fallbackResult = await this.tryStream(fallbackConfig, messages, options);

      if (fallbackResult.success) {
        return this.wrapTextStreamWithSemanticHealth(
          fallbackResult.stream,
          fallbackConfig,
          messages,
          options,
          fallbacks.slice(i + 1),
        );
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
    this.assertBudgetAvailable();

    // Guard: if the model doesn't support tool calls, throw so the caller
    // can fall back to the XML-parsing path
    if (!modelConfig.supportsToolCalls) {
      throw new Error(
        `Model ${modelConfig.provider}/${modelConfig.modelId} does not support native tool calling`,
      );
    }

    const fallbacks = this.routerConfig.fallback;

    // Try the primary model unless semantic/runtime health has degraded it.
    const primaryResult = this._degradedProviders.has(modelConfig.provider)
      ? this.blockedToolStreamResult(modelConfig, "provider degraded by semantic health")
      : await this.tryStreamWithTools(modelConfig, messages, tools, options);
    if (primaryResult.success) {
      return this.wrapToolStreamWithSemanticHealth(
        primaryResult.stream,
        modelConfig,
        messages,
        tools,
        options,
        fallbacks,
      );
    }
    if (primaryResult.error instanceof BudgetExceededError) {
      throw primaryResult.error;
    }

    // Cascade through fallback models that support tool calls
    for (let i = 0; i < fallbacks.length; i++) {
      const fallbackConfig = fallbacks[i]!;
      if (!fallbackConfig.supportsToolCalls) continue;
      if (this._degradedProviders.has(fallbackConfig.provider)) {
        process.stdout.write(`[Router] Skipping degraded provider "${fallbackConfig.provider}" in fallback cascade.\n`);
        this.logEntry(fallbackConfig, "blocked", 0, "provider degraded by health event");
        continue;
      }
      this.logEntry(fallbackConfig, "fallback", 0);
      const fallbackResult = await this.tryStreamWithTools(
        fallbackConfig,
        messages,
        tools,
        options,
      );
      if (fallbackResult.success) {
        return this.wrapToolStreamWithSemanticHealth(
          fallbackResult.stream,
          fallbackConfig,
          messages,
          tools,
          options,
          fallbacks.slice(i + 1),
        );
      }
    }

    throw primaryResult.error;
  }

  /**
   * Resolves the appropriate ModelConfig based on an optional task type.
   * If the task type has a per-task override in the router config, that
   * override is returned; otherwise the default model config is used.
   */
  private resolveModelConfig(taskType?: string, estimatedInputTokens = 0): ModelConfig {
    if (taskType && taskType in this.routerConfig.overrides) {
      const override = this.routerConfig.overrides[taskType];
      if (override) {
        return override;
      }
    }
    // Wire selectTier() into the hot path — dim 27 dead-code fix
    const tier = this.selectTier({
      estimatedInputTokens,
      taskType: (taskType as RoutingContext["taskType"]) ?? "chat",
      consecutiveGstackFailures: this._consecutiveGstackFailures,
      filesInScope: 0,
      forceCapable: false,
    });
    if (tier === "fast" && "fast" in this.routerConfig.overrides) {
      const fastConfig = this.routerConfig.overrides["fast"];
      if (fastConfig) {
        process.stdout.write(
          `[Router: tier=fast → ${fastConfig.provider}/${fastConfig.modelId}]\n`,
        );
        emitCostRoutingLog({
          tier: "fast",
          provider: fastConfig.provider,
          modelId: fastConfig.modelId,
          taskType: taskType ?? "chat",
          estimatedInputTokens,
        });
        return fastConfig;
      }
    }
    return this.routerConfig.default;
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
      this.assertBudgetAvailable();
      const builder = this.resolveProvider(config);
      const model = builder(config);
      const profile = getProviderExecutionProfile(config, {
        thinkingBudget: options.thinkingBudget,
      });

      this.logEntry(config, "attempt", 0);

      const cacheEnabled = shouldUsePromptCache(config.provider);
      const effectiveProviderOptions = cacheEnabled
        ? {
            ...profile.providerOptions,
            anthropic: {
              ...(profile.providerOptions?.anthropic ?? {}),
              cacheControl: true,
            },
          }
        : profile.providerOptions;

      const result = await retryWithBackoff(
        async () =>
          generateText({
            model,
            messages,
            maxTokens: options.maxTokens ?? config.maxTokens,
            temperature: profile.temperature,
            ...(profile.topP !== undefined ? { topP: profile.topP } : {}),
            ...(profile.topK !== undefined ? { topK: profile.topK } : {}),
            ...(options.system ? { system: options.system } : {}),
            ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
            ...(effectiveProviderOptions ? { providerOptions: effectiveProviderOptions } : {}),
          }),
        {
          abortSignal: options.abortSignal,
          classifyError: (error) => classifyApiError(error, config.provider),
          onRetry: async ({ attempt, delayMs, parsedError }) => {
            this.logEntry(
              config,
              "retry",
              Date.now() - startTime,
              `${parsedError.category}; attempt=${attempt}; retryInMs=${delayMs}`,
            );
            await this.recordRetryAuditEvent(config, parsedError.category, delayMs);
          },
        },
      );

      const durationMs = Date.now() - startTime;
      if (isEmptyModelText(result.text)) {
        const error = new SemanticModelOutputError(config, "empty_response");
        this.logEntry(config, "error", durationMs, error.message);
        this.markProviderDegraded(config.provider, error.reasonCode);
        await this.recordSemanticFailureAuditEvent(config, error, durationMs);
        return { success: false, text: "", error };
      }

      this.logEntry(config, "success", durationMs);

      // D6: Track cost for this request
      const inputTokens = result.usage?.promptTokens ?? 0;
      const outputTokens = result.usage?.completionTokens ?? 0;
      this.recordRequestCost(inputTokens, outputTokens, this._currentTier, config.provider);

      // D27: Record prompt cache metrics for Anthropic providers
      if (cacheEnabled && options.system) {
        const sections = buildCacheablePrompt(options.system, "");
        const savingsRatio = estimateCacheSavings(sections);
        globalCacheMetrics.record({
          cacheReadTokens: Math.round(inputTokens * savingsRatio),
          cacheCreationTokens: 0,
          uncachedInputTokens: Math.round(inputTokens * (1 - savingsRatio)),
          outputTokens,
        });
      }

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

  private blockedProviderResult(
    config: ModelConfig,
    reason: string,
  ): { success: false; text: string; error: Error } {
    const error = new Error(`Provider ${config.provider}/${config.modelId} blocked: ${reason}`);
    this.logEntry(config, "blocked", 0, reason);
    return { success: false, text: "", error };
  }

  private blockedStreamResult(
    config: ModelConfig,
    reason: string,
  ): { success: false; stream: never; error: Error } {
    const error = new Error(`Provider ${config.provider}/${config.modelId} blocked: ${reason}`);
    this.logEntry(config, "blocked", 0, reason);
    return { success: false, stream: undefined as never, error };
  }

  private blockedToolStreamResult(
    config: ModelConfig,
    reason: string,
  ): { success: false; stream: never; error: Error } {
    const error = new Error(`Provider ${config.provider}/${config.modelId} blocked: ${reason}`);
    this.logEntry(config, "blocked", 0, reason);
    return { success: false, stream: undefined as never, error };
  }

  private wrapTextStreamWithSemanticHealth(
    stream: StreamTextResult<Record<string, never>, never>,
    config: ModelConfig,
    messages: CoreMessage[],
    options: GenerateOptions,
    fallbacks: ModelConfig[],
  ): StreamTextResult<Record<string, never>, never> {
    const textStream = (stream as { textStream?: unknown }).textStream;
    if (!isAsyncIterable<string>(textStream)) {
      return stream;
    }

    const wrappedTextStream = this.createHealthyTextStream(
      textStream,
      config,
      messages,
      options,
      fallbacks,
    );
    return {
      ...stream,
      textStream: wrappedTextStream,
    } as StreamTextResult<Record<string, never>, never>;
  }

  private async *createHealthyTextStream(
    textStream: AsyncIterable<string>,
    config: ModelConfig,
    messages: CoreMessage[],
    options: GenerateOptions,
    fallbacks: ModelConfig[],
  ): AsyncIterable<string> {
    let hasText = false;
    for await (const chunk of textStream) {
      if (!isEmptyModelText(chunk)) {
        hasText = true;
      }
      yield chunk;
    }

    if (hasText) {
      return;
    }

    const error = new SemanticModelOutputError(config, "empty_response");
    this.logEntry(config, "error", 0, error.message);
    this.markProviderDegraded(config.provider, error.reasonCode);
    await this.recordSemanticFailureAuditEvent(config, error, 0);

    for (const fallbackConfig of fallbacks) {
      if (this._degradedProviders.has(fallbackConfig.provider)) {
        process.stdout.write(`[Router] Skipping degraded provider "${fallbackConfig.provider}" in fallback cascade.\n`);
        this.logEntry(fallbackConfig, "blocked", 0, "provider degraded by health event");
        continue;
      }
      this.logEntry(fallbackConfig, "fallback", 0);
      const fallbackResult = await this.tryStream(fallbackConfig, messages, options);
      if (!fallbackResult.success) {
        continue;
      }
      const fallbackTextStream = (fallbackResult.stream as { textStream?: unknown }).textStream;
      if (!isAsyncIterable<string>(fallbackTextStream)) {
        return;
      }

      let fallbackHasText = false;
      for await (const chunk of fallbackTextStream) {
        if (!isEmptyModelText(chunk)) {
          fallbackHasText = true;
        }
        yield chunk;
      }
      if (fallbackHasText) {
        return;
      }

      const fallbackError = new SemanticModelOutputError(fallbackConfig, "empty_response");
      this.logEntry(fallbackConfig, "error", 0, fallbackError.message);
      this.markProviderDegraded(fallbackConfig.provider, fallbackError.reasonCode);
      await this.recordSemanticFailureAuditEvent(fallbackConfig, fallbackError, 0);
    }

    throw error;
  }

  private wrapToolStreamWithSemanticHealth<T extends Record<string, CoreTool>>(
    stream: StreamTextResult<T, never>,
    config: ModelConfig,
    messages: CoreMessage[],
    tools: T,
    options: GenerateOptions,
    fallbacks: ModelConfig[],
  ): StreamTextResult<T, never> {
    const fullStream = (stream as { fullStream?: unknown }).fullStream;
    if (!isAsyncIterable<unknown>(fullStream)) {
      return stream;
    }

    const wrappedFullStream = this.createHealthyToolStream(
      fullStream,
      config,
      messages,
      tools,
      options,
      fallbacks,
    );
    return {
      ...stream,
      fullStream: wrappedFullStream,
    } as StreamTextResult<T, never>;
  }

  private async *createHealthyToolStream<T extends Record<string, CoreTool>>(
    fullStream: AsyncIterable<unknown>,
    config: ModelConfig,
    messages: CoreMessage[],
    tools: T,
    options: GenerateOptions,
    fallbacks: ModelConfig[],
  ): AsyncIterable<unknown> {
    let hasText = false;
    let toolCallCount = 0;
    let finishReason: string | undefined;
    const pendingFinishParts: unknown[] = [];

    for await (const part of fullStream) {
      const partRecord = part as {
        type?: string;
        textDelta?: string;
        finishReason?: string;
      };
      if (partRecord.type === "text-delta") {
        if (!isEmptyModelText(partRecord.textDelta)) {
          hasText = true;
        }
        yield part;
      } else if (partRecord.type === "tool-call") {
        toolCallCount++;
        yield part;
      } else if (partRecord.type === "finish" || partRecord.type === "finish-step") {
        finishReason = partRecord.finishReason;
        pendingFinishParts.push(part);
      } else {
        yield part;
      }
    }

    const emptyToolCallFinish = isEmptyToolCallFinish(finishReason, toolCallCount);
    const emptyRound = !hasText && toolCallCount === 0;
    if (!emptyToolCallFinish && !emptyRound) {
      for (const part of pendingFinishParts) {
        yield part;
      }
      return;
    }

    const reasonCode = emptyToolCallFinish ? "empty_tool_call_finish" : "empty_response";
    const error = new SemanticModelOutputError(config, reasonCode);
    this.logEntry(config, "error", 0, error.message);
    this.markProviderDegraded(config.provider, error.reasonCode);
    await this.recordSemanticFailureAuditEvent(config, error, 0);

    for (const fallbackConfig of fallbacks) {
      if (!fallbackConfig.supportsToolCalls) {
        continue;
      }
      if (this._degradedProviders.has(fallbackConfig.provider)) {
        process.stdout.write(`[Router] Skipping degraded provider "${fallbackConfig.provider}" in fallback cascade.\n`);
        this.logEntry(fallbackConfig, "blocked", 0, "provider degraded by health event");
        continue;
      }
      this.logEntry(fallbackConfig, "fallback", 0);
      const fallbackResult = await this.tryStreamWithTools(
        fallbackConfig,
        messages,
        tools,
        options,
      );
      if (!fallbackResult.success) {
        continue;
      }
      const fallbackFullStream = (fallbackResult.stream as { fullStream?: unknown }).fullStream;
      if (!isAsyncIterable<unknown>(fallbackFullStream)) {
        return;
      }

      for await (const part of fallbackFullStream) {
        yield part;
      }
      return;
    }

    throw error;
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
      this.assertBudgetAvailable();
      const builder = this.resolveProvider(config);
      const model = builder(config);
      const profile = getProviderExecutionProfile(config, {
        thinkingBudget: options.thinkingBudget,
      });

      this.logEntry(config, "attempt", 0);

      const streamCacheEnabled = shouldUsePromptCache(config.provider);
      const streamProviderOptions = streamCacheEnabled
        ? {
            ...profile.providerOptions,
            anthropic: {
              ...(profile.providerOptions?.anthropic ?? {}),
              cacheControl: true,
            },
          }
        : profile.providerOptions;

      const result = await retryWithBackoff(
        async () =>
          streamText({
            model,
            messages,
            maxTokens: options.maxTokens ?? config.maxTokens,
            temperature: profile.temperature,
            ...(profile.topP !== undefined ? { topP: profile.topP } : {}),
            ...(profile.topK !== undefined ? { topK: profile.topK } : {}),
            ...(options.system ? { system: options.system } : {}),
            ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
            ...(streamProviderOptions ? { providerOptions: streamProviderOptions } : {}),
            onFinish: async ({ usage }) => {
              const durationMs = Date.now() - startTime;
              this.logEntry(config, "success", durationMs);

              // D6: Track cost for this streaming request
              const inputTk = usage?.promptTokens ?? 0;
              const outputTk = usage?.completionTokens ?? 0;
              this.recordRequestCost(inputTk, outputTk, this._currentTier, config.provider);

              await this.recordAuditEvent(config, "session_start", durationMs, usage?.totalTokens ?? 0);

              // D27: Record prompt cache metrics for streaming Anthropic requests
              if (streamCacheEnabled && options.system) {
                const sections = buildCacheablePrompt(options.system, "");
                const savingsRatio = estimateCacheSavings(sections);
                globalCacheMetrics.record({
                  cacheReadTokens: Math.round(inputTk * savingsRatio),
                  cacheCreationTokens: 0,
                  uncachedInputTokens: Math.round(inputTk * (1 - savingsRatio)),
                  outputTokens: outputTk,
                });
              }
            },
          }),
        {
          abortSignal: options.abortSignal,
          classifyError: (error) => classifyApiError(error, config.provider),
          onRetry: async ({ attempt, delayMs, parsedError }) => {
            this.logEntry(
              config,
              "retry",
              Date.now() - startTime,
              `${parsedError.category}; attempt=${attempt}; retryInMs=${delayMs}`,
            );
            await this.recordRetryAuditEvent(config, parsedError.category, delayMs);
          },
        },
      );

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
      this.assertBudgetAvailable();
      const builder = this.resolveProvider(config);
      const model = builder(config);
      const profile = getProviderExecutionProfile(config, {
        thinkingBudget: options.thinkingBudget,
      });

      this.logEntry(config, "attempt", 0);

      const result = await retryWithBackoff(
        async () =>
          streamText({
            model,
            messages,
            tools,
            maxTokens: options.maxTokens ?? config.maxTokens,
            temperature: profile.temperature,
            ...(profile.topP !== undefined ? { topP: profile.topP } : {}),
            ...(profile.topK !== undefined ? { topK: profile.topK } : {}),
            ...(options.system ? { system: options.system } : {}),
            ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
            ...(profile.providerOptions ? { providerOptions: profile.providerOptions } : {}),
            onFinish: async ({ usage }) => {
              const durationMs = Date.now() - startTime;
              this.logEntry(config, "success", durationMs);

              const inputTk = usage?.promptTokens ?? 0;
              const outputTk = usage?.completionTokens ?? 0;
              this.recordRequestCost(inputTk, outputTk, this._currentTier, config.provider);

              await this.recordAuditEvent(config, "session_start", durationMs, usage?.totalTokens ?? 0);
            },
          }),
        {
          abortSignal: options.abortSignal,
          classifyError: (error) => classifyApiError(error, config.provider),
          onRetry: async ({ attempt, delayMs, parsedError }) => {
            this.logEntry(
              config,
              "retry",
              Date.now() - startTime,
              `${parsedError.category}; attempt=${attempt}; retryInMs=${delayMs}`,
            );
            await this.recordRetryAuditEvent(config, parsedError.category, delayMs);
          },
        },
      );

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

  private async recordRetryAuditEvent(
    config: ModelConfig,
    category: string,
    delayMs: number,
  ): Promise<void> {
    try {
      await appendAuditEvent(this.projectRoot, {
        type: "request_retry",
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        modelId: `${config.provider}/${config.modelId}`,
        projectRoot: this.projectRoot,
        payload: {
          category,
          delayMs,
          provider: config.provider,
          modelId: config.modelId,
        },
      });
    } catch {
      // Non-fatal.
    }
  }

  private async recordSemanticFailureAuditEvent(
    config: ModelConfig,
    error: SemanticModelOutputError,
    durationMs: number,
  ): Promise<void> {
    try {
      await appendAuditEvent(this.projectRoot, {
        type: "tool_call_failed",
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        modelId: `${config.provider}/${config.modelId}`,
        projectRoot: this.projectRoot,
        payload: {
          semanticFailure: true,
          reasonCode: error.reasonCode,
          provider: config.provider,
          modelId: config.modelId,
          durationMs,
        },
      });
    } catch {
      // Non-fatal.
    }
  }

  private async recordBudgetBlockedAuditEvent(reason: string): Promise<void> {
    try {
      await appendAuditEvent(this.projectRoot, {
        type: "budget_blocked",
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        modelId: `${this.routerConfig.default.provider}/${this.routerConfig.default.modelId}`,
        projectRoot: this.projectRoot,
        payload: {
          reason,
          sessionTotalUsd: this._sessionCostUsd,
          monthlySpendUsd: this.routerConfig.budget?.currentMonthlySpendUsd ?? 0,
        },
      });
    } catch {
      // Non-fatal.
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

  private assertBudgetAvailable(): void {
    const budget = this.routerConfig.budget;
    if (!budget?.enforce) {
      this._budgetExceeded = false;
      return;
    }

    if (budget.sessionMaxUsd !== undefined && this._sessionCostUsd >= budget.sessionMaxUsd) {
      this._budgetExceeded = true;
      const message = `Session budget exceeded ($${this._sessionCostUsd.toFixed(4)} / $${budget.sessionMaxUsd.toFixed(4)})`;
      this.logEntry(this.routerConfig.default, "blocked", 0, message);
      void this.recordBudgetBlockedAuditEvent(message);
      throw new BudgetExceededError(message);
    }

    if (
      budget.monthlyMaxUsd !== undefined &&
      (budget.currentMonthlySpendUsd ?? 0) >= budget.monthlyMaxUsd
    ) {
      this._budgetExceeded = true;
      const message =
        `Monthly budget exceeded ($${(budget.currentMonthlySpendUsd ?? 0).toFixed(4)} / ` +
        `$${budget.monthlyMaxUsd.toFixed(4)})`;
      this.logEntry(this.routerConfig.default, "blocked", 0, message);
      void this.recordBudgetBlockedAuditEvent(message);
      throw new BudgetExceededError(message);
    }

    this._budgetExceeded = false;
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

    // Cost-floor routing (dim 27): tiny tasks with trivial complexity always use "fast".
    // Only applies when an explicit cost estimate is provided (> 0) — undefined/0 skips the floor.
    const estimatedCostUsd = context.estimatedCostUsd ?? 0;
    if (estimatedCostUsd > 0 && estimatedCostUsd < 0.001 && complexity < 0.2 && !context.forceCapable) {
      void process.stdout.write("[routing: fast — cost floor]\n");
      return "fast";
    }

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
   * Returns the fastest model tier capable of handling a given task class (dim 27).
   * Used for cost-floor routing — simple tasks always go to the cheapest capable model.
   */
  getCheapestEquivalent(taskClass: string): "fast" | "capable" {
    const SIMPLE_TASK_CLASSES = new Set([
      "simple-edit",
      "comment",
      "rename",
      "format",
      "autocomplete",
      "single-file-read",
    ]);
    return SIMPLE_TASK_CLASSES.has(taskClass) ? "fast" : "capable";
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
    const sessionBudgetUsd = this.routerConfig.budget?.sessionMaxUsd;

    // Budget warning at 80% threshold (dim 27 — cost visibility)
    if (
      sessionBudgetUsd !== undefined &&
      !this._budgetWarningSent &&
      this._sessionCostUsd / sessionBudgetUsd >= 0.8
    ) {
      const pct = Math.round((this._sessionCostUsd / sessionBudgetUsd) * 100);
      const msg = `[Budget warning: ${pct}% of session budget used ($${this._sessionCostUsd.toFixed(4)}/$${sessionBudgetUsd.toFixed(4)})]`;
      process.stdout.write(`${msg}\n`);
      this._budgetWarningSent = true;
    }
    const monthlyBudgetUsd = this.routerConfig.budget?.monthlyMaxUsd;
    this._budgetExceeded = Boolean(
      (sessionBudgetUsd !== undefined && this._sessionCostUsd >= sessionBudgetUsd) ||
        (monthlyBudgetUsd !== undefined &&
          (this.routerConfig.budget?.currentMonthlySpendUsd ?? 0) >= monthlyBudgetUsd),
    );
    return {
      sessionTotalUsd: this._sessionCostUsd,
      lastRequestUsd: lastCost,
      modelTier: this._currentTier,
      tokensUsedSession: this._sessionTokensUsed,
      sessionBudgetUsd,
      monthlyBudgetUsd,
      budgetExceeded: this._budgetExceeded,
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
    this._budgetExceeded = false;
    this._budgetWarningSent = false;
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
      sessionBudgetUsd: this.routerConfig.budget?.sessionMaxUsd,
      monthlyBudgetUsd: this.routerConfig.budget?.monthlyMaxUsd,
      budgetExceeded: this._budgetExceeded,
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

// ─── Cost Routing Evidence Log (dim 27) ──────────────────────────────────────

export interface CostRoutingLogEntry {
  timestamp: string;
  tier: string;
  provider: string;
  modelId: string;
  taskType: string;
  estimatedInputTokens: number;
}

/**
 * Appends a tier-selection event to `.danteforge/cost-routing-log.json` (JSONL).
 * Called whenever selectTier() routes to a non-default tier, producing durable
 * evidence that cost-floor routing fires in production.
 */
export function emitCostRoutingLog(
  entry: Omit<CostRoutingLogEntry, "timestamp">,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, ".danteforge", "cost-routing-log.json");
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const line: CostRoutingLogEntry = { timestamp: new Date().toISOString(), ...entry };
    appendFileSync(logPath, JSON.stringify(line) + "\n", "utf-8");
  } catch { /* non-fatal — log failures must not break routing */ }
}
