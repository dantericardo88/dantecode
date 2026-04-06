// ============================================================================
// @dantecode/core — Stream Recovery
// Monitors streaming LLM responses for stalls/timeouts and provides retry
// guidance. Used by both the CLI agent loop and VSCode inline completions.
// ============================================================================

/**
 * Configuration for StreamRecovery.
 */
export interface StreamRecoveryOptions {
  /** Maximum time (ms) between chunks before considering the stream stalled. */
  timeoutMs?: number;
  /** Maximum number of retry attempts before giving up. */
  maxRetries?: number;
}

/**
 * StreamRecovery tracks streaming activity and provides retry/timeout
 * guidance for LLM response streams. It detects stalled streams and
 * determines whether a retry is appropriate.
 */
export class StreamRecovery {
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private lastActivityMs: number;
  private retryCount: number;
  private totalChunks: number;

  constructor(options: StreamRecoveryOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 2;
    this.lastActivityMs = Date.now();
    this.retryCount = 0;
    this.totalChunks = 0;
  }

  /**
   * Call this after each chunk is received to reset the activity timer.
   */
  updateActivity(): void {
    this.lastActivityMs = Date.now();
    this.totalChunks++;
  }

  /**
   * Returns true if the stream appears stalled (no activity within timeoutMs).
   */
  isStalled(): boolean {
    return Date.now() - this.lastActivityMs > this.timeoutMs;
  }

  /**
   * Returns true if a retry should be attempted based on the current retry
   * count and max retries configuration.
   */
  shouldRetry(): boolean {
    return this.retryCount < this.maxRetries;
  }

  /**
   * Record that a retry was attempted. Returns the new retry count.
   */
  recordRetry(): number {
    return ++this.retryCount;
  }

  /**
   * Reset state for a new streaming attempt (keeps retry count).
   */
  resetForRetry(): void {
    this.lastActivityMs = Date.now();
    this.totalChunks = 0;
  }

  /**
   * Full reset — clears retry count and all state.
   */
  reset(): void {
    this.lastActivityMs = Date.now();
    this.retryCount = 0;
    this.totalChunks = 0;
  }

  /** Number of chunks received in the current stream. */
  get chunks(): number {
    return this.totalChunks;
  }

  /** Current retry count. */
  get retries(): number {
    return this.retryCount;
  }

  /** Milliseconds since last activity. */
  get timeSinceLastActivity(): number {
    return Date.now() - this.lastActivityMs;
  }
}
