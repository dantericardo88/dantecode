// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateLimiterOptions {
  /**
   * Maximum events per second per repo (token bucket refill rate).
   * Default: 10 events/s
   */
  maxPerSecond?: number;
  /**
   * Maximum burst tokens (bucket capacity).
   * Default: equal to maxPerSecond
   */
  maxBurst?: number;
  /**
   * Whether to allow events above the rate but log as "warned".
   * Default: false (deny over-limit events)
   */
  warnOnly?: boolean;
}

export interface RateLimiterRepoStats {
  repoRoot: string;
  allowed: number;
  blocked: number;
  warned: number;
  currentTokens: number;
  lastUpdated: number;
}

export interface RateLimiterGlobalStats {
  totalAllowed: number;
  totalBlocked: number;
  totalWarned: number;
  repos: RateLimiterRepoStats[];
}

// ─── Token bucket per repo ────────────────────────────────────────────────────

interface TokenBucket {
  tokens: number;
  lastRefillAt: number;
  allowed: number;
  blocked: number;
  warned: number;
}

// ─── GitEventRateLimiter ──────────────────────────────────────────────────────

/**
 * Token-bucket rate limiter for git automation events, keyed per repo root.
 *
 * - Each repo gets an independent bucket refilling at `maxPerSecond` tokens/s.
 * - Burst capacity defaults to `maxPerSecond` (1-second burst headroom).
 * - `isAllowed()` is non-destructive; call `consume()` to deduct a token.
 * - `consume()` returns `"allowed" | "warned" | "blocked"`.
 */
export class GitEventRateLimiter {
  private readonly maxPerSecond: number;
  private readonly maxBurst: number;
  private readonly warnOnly: boolean;
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(options: RateLimiterOptions = {}) {
    this.maxPerSecond = Math.max(1, options.maxPerSecond ?? 10);
    this.maxBurst = Math.max(1, options.maxBurst ?? this.maxPerSecond);
    this.warnOnly = options.warnOnly ?? false;
  }

  /**
   * Check whether the next event for the given repo would be allowed
   * without consuming a token.
   */
  isAllowed(repoRoot: string): boolean {
    const bucket = this.getBucket(repoRoot);
    this.refill(bucket);
    return bucket.tokens >= 1;
  }

  /**
   * Consume one token for the given repo.
   * Returns:
   *  - "allowed"  — token consumed, event is permitted
   *  - "warned"   — over rate limit but warnOnly=true (event still proceeds)
   *  - "blocked"  — over rate limit (event should be dropped / deferred)
   */
  consume(repoRoot: string): "allowed" | "warned" | "blocked" {
    const bucket = this.getBucket(repoRoot);
    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      bucket.allowed += 1;
      return "allowed";
    }

    if (this.warnOnly) {
      bucket.warned += 1;
      return "warned";
    }

    bucket.blocked += 1;
    return "blocked";
  }

  /**
   * Get per-repo stats.
   */
  getRepoStats(repoRoot: string): RateLimiterRepoStats {
    const bucket = this.getBucket(repoRoot);
    this.refill(bucket);
    return {
      repoRoot,
      allowed: bucket.allowed,
      blocked: bucket.blocked,
      warned: bucket.warned,
      currentTokens: bucket.tokens,
      lastUpdated: bucket.lastRefillAt,
    };
  }

  /**
   * Aggregate stats across all known repos.
   */
  getGlobalStats(): RateLimiterGlobalStats {
    let totalAllowed = 0;
    let totalBlocked = 0;
    let totalWarned = 0;
    const repos: RateLimiterRepoStats[] = [];

    for (const [repoRoot, bucket] of this.buckets) {
      totalAllowed += bucket.allowed;
      totalBlocked += bucket.blocked;
      totalWarned += bucket.warned;
      repos.push({
        repoRoot,
        allowed: bucket.allowed,
        blocked: bucket.blocked,
        warned: bucket.warned,
        currentTokens: bucket.tokens,
        lastUpdated: bucket.lastRefillAt,
      });
    }

    return { totalAllowed, totalBlocked, totalWarned, repos };
  }

  /**
   * Reset counters for one repo (or all repos if omitted).
   */
  reset(repoRoot?: string): void {
    if (repoRoot) {
      this.buckets.delete(repoRoot);
    } else {
      this.buckets.clear();
    }
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private getBucket(repoRoot: string): TokenBucket {
    let bucket = this.buckets.get(repoRoot);
    if (!bucket) {
      bucket = {
        tokens: this.maxBurst,
        lastRefillAt: Date.now(),
        allowed: 0,
        blocked: 0,
        warned: 0,
      };
      this.buckets.set(repoRoot, bucket);
    }
    return bucket;
  }

  private refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = now - bucket.lastRefillAt;
    if (elapsed <= 0) {
      return;
    }

    const newTokens = (elapsed / 1000) * this.maxPerSecond;
    bucket.tokens = Math.min(this.maxBurst, bucket.tokens + newTokens);
    bucket.lastRefillAt = now;
  }
}
