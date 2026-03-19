/**
 * unified-llm-client.ts
 *
 * Single `call()` API that wraps all LLM providers with intelligent fallback,
 * retry logic, streaming simulation, and built-in telemetry.
 *
 * Real provider I/O is handled exclusively through the injected `executorFn`
 * so the module has zero external dependencies and is trivially testable.
 */

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface LLMMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface LLMCallOptions {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface LLMCallResult {
  model: string;
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  provider: string;
  cached: boolean;
}

export interface FallbackChain {
  models: string[];
  strategy: "first-success" | "lowest-cost" | "fastest";
}

export interface ClientTelemetry {
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalLatencyMs: number;
  errorCount: number;
  fallbackCount: number;
}

/**
 * Async function type that performs the actual LLM API call.
 * Inject a mock implementation in tests.
 */
export type LLMExecutorFn = (options: LLMCallOptions) => Promise<LLMCallResult>;

export interface UnifiedLLMClientOptions {
  /** Default fallback chain applied when the primary model fails. */
  defaultFallbackChain?: FallbackChain;
  /** Injectable executor for testing (replaces real API calls). */
  executorFn?: LLMExecutorFn;
  /** Maximum retry attempts per model before considering it failed. Default: 2 */
  maxRetries?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Base delay (ms) for first retry; doubles each subsequent attempt. */
const BASE_RETRY_DELAY_MS = 50;

/** Approximate cost per 1 k tokens for each well-known model.
 *  Used by the `lowest-cost` strategy when ordering fallback candidates. */
const KNOWN_COST_PER_1K: Record<string, number> = {
  "claude-opus-4-6": 0.045,
  "claude-sonnet-4-6": 0.009,
  "claude-haiku-4-5": 0.00075,
  "gpt-4o": 0.01,
  "gpt-4o-mini": 0.000375,
  "gemini-1.5-pro": 0.007,
  "llama-3.1-70b": 0.0009,
};

/** Approximate average latency (ms) for each well-known model.
 *  Used by the `fastest` strategy when ordering fallback candidates. */
const KNOWN_LATENCY_MS: Record<string, number> = {
  "claude-opus-4-6": 3200,
  "claude-sonnet-4-6": 1800,
  "claude-haiku-4-5": 700,
  "gpt-4o": 2500,
  "gpt-4o-mini": 900,
  "gemini-1.5-pro": 2800,
  "llama-3.1-70b": 1500,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Non-blocking sleep — used between retries. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sort model IDs by ascending estimated cost. */
function sortByCost(models: string[]): string[] {
  return [...models].sort(
    (a, b) =>
      (KNOWN_COST_PER_1K[a] ?? Infinity) - (KNOWN_COST_PER_1K[b] ?? Infinity),
  );
}

/** Sort model IDs by ascending estimated latency. */
function sortByLatency(models: string[]): string[] {
  return [...models].sort(
    (a, b) =>
      (KNOWN_LATENCY_MS[a] ?? Infinity) -
      (KNOWN_LATENCY_MS[b] ?? Infinity),
  );
}

// ─── Main Class ───────────────────────────────────────────────────────────────

/**
 * `UnifiedLLMClient` provides a single, ergonomic interface for calling any
 * LLM.  It handles:
 *
 * - **Retries** with exponential back-off (configurable, default 2).
 * - **Fallback chains** (first-success / lowest-cost / fastest strategies).
 * - **Streaming** via a chunk-callback delegate.
 * - **Telemetry** accumulation across all calls.
 *
 * @example
 * ```ts
 * const client = new UnifiedLLMClient({ executorFn: myRealProvider });
 * const result = await client.call({ model: "claude-sonnet-4-6", messages });
 * ```
 */
export class UnifiedLLMClient {
  private readonly executorFn: LLMExecutorFn;
  private readonly maxRetries: number;
  private fallbackChain: FallbackChain | undefined;
  private telemetry: ClientTelemetry;

  constructor(options: UnifiedLLMClientOptions = {}) {
    if (!options.executorFn) {
      // Provide a stub that throws — callers must inject a real executor.
      this.executorFn = async (_opts) => {
        throw new Error(
          "UnifiedLLMClient: no executorFn provided. " +
            "Pass executorFn in options or use setExecutorFn().",
        );
      };
    } else {
      this.executorFn = options.executorFn;
    }

    this.maxRetries = options.maxRetries ?? 2;
    this.fallbackChain = options.defaultFallbackChain;
    this.telemetry = this.zeroTelemetry();
  }

  // ── Core Call API ─────────────────────────────────────────────────────────

  /**
   * Call the configured executor for `options.model`.
   *
   * Retries up to `maxRetries` times with exponential back-off.
   * If retries are exhausted and a `defaultFallbackChain` is configured,
   * the chain is tried automatically.
   *
   * @throws If all retries (and fallback, if any) are exhausted.
   */
  async call(options: LLMCallOptions): Promise<LLMCallResult> {
    this.telemetry.totalCalls++;
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1));
      }
      try {
        const result = await this.executorFn(options);
        this.recordSuccess(result);
        return result;
      } catch (err) {
        lastError = err;
      }
    }

    this.telemetry.errorCount++;

    // Attempt default fallback chain if configured.
    if (this.fallbackChain) {
      this.telemetry.fallbackCount++;
      return this.callWithFallback(options, this.fallbackChain);
    }

    throw lastError;
  }

  /**
   * Try each model in `fallbackChain` according to the chosen strategy.
   *
   * - `first-success` — try in list order, return on first success.
   * - `lowest-cost`   — reorder by estimated cost ascending, then first-success.
   * - `fastest`       — reorder by estimated latency ascending, then first-success.
   *
   * @throws Aggregate error string if every candidate fails.
   */
  async callWithFallback(
    options: LLMCallOptions,
    fallbackChain: FallbackChain,
  ): Promise<LLMCallResult> {
    let orderedModels: string[];

    switch (fallbackChain.strategy) {
      case "lowest-cost":
        orderedModels = sortByCost(fallbackChain.models);
        break;
      case "fastest":
        orderedModels = sortByLatency(fallbackChain.models);
        break;
      case "first-success":
      default:
        orderedModels = [...fallbackChain.models];
    }

    const errors: string[] = [];

    for (let i = 0; i < orderedModels.length; i++) {
      const model = orderedModels[i]!;
      try {
        const result = await this.executorFn({ ...options, model });
        if (i > 0) {
          // We fell back beyond the first candidate.
          this.telemetry.fallbackCount++;
        }
        this.recordSuccess(result);
        return result;
      } catch (err) {
        errors.push(`${model}: ${String(err)}`);
      }
    }

    this.telemetry.errorCount++;
    throw new Error(
      `All fallback models failed:\n${errors.join("\n")}`,
    );
  }

  // ── Streaming API ─────────────────────────────────────────────────────────

  /**
   * Streaming call: invokes the executor with `stream: true`, then delivers
   * the full content to `onChunk` in a single synthetic chunk.
   *
   * In a production implementation each real chunk would arrive incrementally;
   * this implementation keeps the contract without hard-wiring a specific
   * provider transport.
   *
   * @param options  Standard call options (stream flag is forced to `true`).
   * @param onChunk  Callback invoked with each content fragment.
   */
  async stream(
    options: LLMCallOptions,
    onChunk: (chunk: string) => void,
  ): Promise<LLMCallResult> {
    this.telemetry.totalCalls++;

    const streamOptions: LLMCallOptions = { ...options, stream: true };

    try {
      const result = await this.executorFn(streamOptions);
      // Deliver content to caller as one synthetic chunk.
      onChunk(result.content);
      this.recordSuccess(result);
      return result;
    } catch (err) {
      this.telemetry.errorCount++;
      throw err;
    }
  }

  // ── Telemetry ─────────────────────────────────────────────────────────────

  /**
   * Return a copy of accumulated telemetry since creation or last reset.
   */
  getTelemetry(): ClientTelemetry {
    return { ...this.telemetry };
  }

  /**
   * Reset all telemetry counters back to zero.
   */
  resetTelemetry(): void {
    this.telemetry = this.zeroTelemetry();
  }

  // ── Configuration ─────────────────────────────────────────────────────────

  /**
   * Replace the default fallback chain used by `call()` when retries exhaust.
   */
  setFallbackChain(chain: FallbackChain): void {
    this.fallbackChain = chain;
  }

  // ── Private Helpers ───────────────────────────────────────────────────────

  private recordSuccess(result: LLMCallResult): void {
    this.telemetry.totalTokensIn += result.inputTokens;
    this.telemetry.totalTokensOut += result.outputTokens;
    this.telemetry.totalLatencyMs += result.latencyMs;
  }

  private zeroTelemetry(): ClientTelemetry {
    return {
      totalCalls: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalLatencyMs: 0,
      errorCount: 0,
      fallbackCount: 0,
    };
  }
}
