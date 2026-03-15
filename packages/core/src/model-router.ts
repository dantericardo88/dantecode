// ============================================================================
// @dantecode/core — Model Router Implementation
// ============================================================================

import { generateText, streamText, type CoreMessage, type StreamTextResult } from "ai";
import type { ModelConfig, ModelRouterConfig, AuditEventType } from "@dantecode/config-types";
import { PROVIDER_BUILDERS, type ProviderBuilder } from "./providers/index.js";
import { appendAuditEvent } from "./audit.js";

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

      this.logEntry(config, "attempt", 0);

      const result = await generateText({
        model,
        messages,
        maxTokens: options.maxTokens ?? config.maxTokens,
        temperature: config.temperature,
        ...(options.system ? { system: options.system } : {}),
      });

      const durationMs = Date.now() - startTime;
      this.logEntry(config, "success", durationMs);

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

      this.logEntry(config, "attempt", 0);

      const result = streamText({
        model,
        messages,
        maxTokens: options.maxTokens ?? config.maxTokens,
        temperature: config.temperature,
        ...(options.system ? { system: options.system } : {}),
        onFinish: async ({ usage }) => {
          const durationMs = Date.now() - startTime;
          this.logEntry(config, "success", durationMs);

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
}
