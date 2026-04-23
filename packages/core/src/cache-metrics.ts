// packages/core/src/cache-metrics.ts
// Prompt Cache Metrics — tracks Anthropic cache_control hit/miss rates and cost savings.
// Closes dim 25 gap: existing prompt-cache.ts builds the structure but doesn't
// track what actually hits cache vs gets regenerated.
//
// Integrates with the Anthropic API usage response (input_tokens, cache_read_input_tokens,
// cache_creation_input_tokens) to compute real savings vs estimated cost.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CacheUsageRecord {
  /** Tokens read from cache (free/discounted) */
  cacheReadTokens: number;
  /** Tokens written to cache (slightly more expensive than normal) */
  cacheCreationTokens: number;
  /** Normal (uncached) input tokens */
  uncachedInputTokens: number;
  /** Output tokens (not affected by cache) */
  outputTokens: number;
  /** ISO timestamp */
  timestamp: string;
  /** Model identifier */
  model?: string;
}

export interface CacheMetricsSummary {
  /** Total requests tracked */
  requestCount: number;
  /** Total tokens that hit cache */
  totalCacheReadTokens: number;
  /** Total tokens written to cache */
  totalCacheCreationTokens: number;
  /** Total uncached input tokens */
  totalUncachedInputTokens: number;
  /** Estimated cost savings in USD */
  estimatedSavingsUsd: number;
  /** Cache hit rate (0.0–1.0) — cacheRead / (cacheRead + uncachedInput) */
  cacheHitRate: number;
  /** Whether cache is warming (first few requests) */
  isCacheWarm: boolean;
}

export interface CostModel {
  /** Input token cost per million tokens (USD) */
  inputCostPerMTok: number;
  /** Cache read cost per million tokens (USD) — typically 10% of input cost */
  cacheReadCostPerMTok: number;
  /** Cache write cost per million tokens (USD) — typically 125% of input cost */
  cacheWriteCostPerMTok: number;
}

// Default Anthropic Claude pricing (approximate)
const DEFAULT_COST_MODEL: CostModel = {
  inputCostPerMTok: 3.00,       // $3/MTok for claude-sonnet-4
  cacheReadCostPerMTok: 0.30,   // $0.30/MTok (10% of input)
  cacheWriteCostPerMTok: 3.75,  // $3.75/MTok (125% of input)
};

// ─── CacheMetricsTracker ──────────────────────────────────────────────────────

/**
 * Tracks prompt cache performance across API calls.
 * Feed usage data from Anthropic API responses to accumulate metrics.
 *
 * Usage:
 *   const tracker = new CacheMetricsTracker();
 *   tracker.record({ cacheReadTokens: 5000, cacheCreationTokens: 1000, uncachedInputTokens: 200, outputTokens: 300 });
 *   const summary = tracker.summary();
 */
export class CacheMetricsTracker {
  private _records: CacheUsageRecord[] = [];
  private readonly _costModel: CostModel;
  private readonly _cacheWarmThreshold: number;

  constructor(options: { costModel?: Partial<CostModel>; cacheWarmThreshold?: number } = {}) {
    this._costModel = { ...DEFAULT_COST_MODEL, ...options.costModel };
    this._cacheWarmThreshold = options.cacheWarmThreshold ?? 3;
  }

  /**
   * Record API usage from an Anthropic response.
   * Maps to the `usage` field in Anthropic API responses.
   */
  record(usage: Omit<CacheUsageRecord, "timestamp">): void {
    this._records.push({
      ...usage,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Compute aggregate metrics across all recorded requests.
   */
  summary(): CacheMetricsSummary {
    const requestCount = this._records.length;
    if (requestCount === 0) {
      return {
        requestCount: 0,
        totalCacheReadTokens: 0,
        totalCacheCreationTokens: 0,
        totalUncachedInputTokens: 0,
        estimatedSavingsUsd: 0,
        cacheHitRate: 0,
        isCacheWarm: false,
      };
    }

    const totalCacheReadTokens = this._records.reduce((s, r) => s + r.cacheReadTokens, 0);
    const totalCacheCreationTokens = this._records.reduce((s, r) => s + r.cacheCreationTokens, 0);
    const totalUncachedInputTokens = this._records.reduce((s, r) => s + r.uncachedInputTokens, 0);

    // Cost savings: difference between normal cost and actual cost for cache reads
    // Normal cost would have been: cacheReadTokens * inputCostPerMTok
    // Actual cost is:              cacheReadTokens * cacheReadCostPerMTok
    const normalCostForCacheReads = (totalCacheReadTokens / 1_000_000) * this._costModel.inputCostPerMTok;
    const actualCostForCacheReads = (totalCacheReadTokens / 1_000_000) * this._costModel.cacheReadCostPerMTok;
    const estimatedSavingsUsd = Math.max(0, normalCostForCacheReads - actualCostForCacheReads);

    // Cache hit rate
    const totalInputTokens = totalCacheReadTokens + totalUncachedInputTokens;
    const cacheHitRate = totalInputTokens > 0 ? totalCacheReadTokens / totalInputTokens : 0;

    return {
      requestCount,
      totalCacheReadTokens,
      totalCacheCreationTokens,
      totalUncachedInputTokens,
      estimatedSavingsUsd,
      cacheHitRate,
      isCacheWarm: requestCount >= this._cacheWarmThreshold && cacheHitRate > 0,
    };
  }

  /**
   * Get the most recent N records.
   */
  getRecentRecords(n = 10): CacheUsageRecord[] {
    return this._records.slice(-n);
  }

  /**
   * Format cache metrics as a human-readable status line.
   * Used in the token gauge and session summary.
   */
  formatStatusLine(): string {
    const s = this.summary();
    if (s.requestCount === 0) return "cache: no data";
    const hitPct = (s.cacheHitRate * 100).toFixed(0);
    const savings = s.estimatedSavingsUsd.toFixed(4);
    const warmIndicator = s.isCacheWarm ? "🔥" : "❄️";
    return `${warmIndicator} cache: ${hitPct}% hit rate | $${savings} saved | ${s.totalCacheReadTokens.toLocaleString()} cached tokens`;
  }

  /**
   * Format detailed metrics block for session summaries.
   */
  formatDetailBlock(): string {
    const s = this.summary();
    if (s.requestCount === 0) return "## Cache Metrics\nNo data recorded.";

    return [
      "## Prompt Cache Metrics",
      "",
      `**Requests:** ${s.requestCount}`,
      `**Cache hit rate:** ${(s.cacheHitRate * 100).toFixed(1)}%`,
      `**Cache read tokens:** ${s.totalCacheReadTokens.toLocaleString()}`,
      `**Cache write tokens:** ${s.totalCacheCreationTokens.toLocaleString()}`,
      `**Uncached input tokens:** ${s.totalUncachedInputTokens.toLocaleString()}`,
      `**Estimated savings:** $${s.estimatedSavingsUsd.toFixed(4)} USD`,
      `**Cache status:** ${s.isCacheWarm ? "warm 🔥" : "warming ❄️"}`,
    ].join("\n");
  }

  /**
   * Clear all recorded data.
   */
  reset(): void {
    this._records = [];
  }

  /** Number of recorded requests. */
  get requestCount(): number {
    return this._records.length;
  }
}

// ─── Utility Functions ────────────────────────────────────────────────────────

/**
 * Compute expected savings for a given prompt structure.
 * Used before sending a request to estimate the value of caching.
 */
export function estimateCachingSavings(
  stableTokens: number,
  requestsPerSession: number,
  costModel: Partial<CostModel> = {},
): { savingsUsd: number; paybackRequests: number } {
  const cm = { ...DEFAULT_COST_MODEL, ...costModel };

  // First request: pays write cost instead of read cost
  const writePremium = (stableTokens / 1_000_000) * (cm.cacheWriteCostPerMTok - cm.inputCostPerMTok);

  // Subsequent requests: save (input - read) per request
  const savingsPerRequest = (stableTokens / 1_000_000) * (cm.inputCostPerMTok - cm.cacheReadCostPerMTok);

  // Number of requests to break even on write cost
  const paybackRequests = savingsPerRequest > 0 ? Math.ceil(writePremium / savingsPerRequest) : Infinity;

  // Total savings over session (excluding payback)
  const savingsUsd = Math.max(0, (requestsPerSession - paybackRequests) * savingsPerRequest);

  return { savingsUsd, paybackRequests };
}

/**
 * Check whether a cache prefix is likely still valid (not expired).
 * Anthropic's cache TTL is 5 minutes for ephemeral cache.
 */
export function isCacheLikelyValid(lastCacheWriteTime: Date, ttlSeconds = 300): boolean {
  const ageMs = Date.now() - lastCacheWriteTime.getTime();
  return ageMs < ttlSeconds * 1000;
}

/** Global tracker instance — wired into agent-loop API calls. */
export const globalCacheMetrics = new CacheMetricsTracker();
