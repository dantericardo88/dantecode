// ============================================================================
// @dantecode/core — Circuit Breaker for Providers
// Prevents cascading failures by tracking consecutive errors per provider
// and temporarily skipping providers that are consistently failing.
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** The three states of a circuit breaker. */
export type CircuitBreakerState = "closed" | "open" | "half-open";

/** Health event emitted when a circuit transitions to open state. */
export interface ProviderHealthEvent {
  provider: string;
  state: CircuitBreakerState;
  failures: number;
}

/** Per-provider state tracked by the circuit breaker. */
interface ProviderCircuitState {
  /** Current breaker state. */
  state: CircuitBreakerState;
  /** Number of consecutive failures while closed. */
  consecutiveFailures: number;
  /** Timestamp (ms) when the circuit was opened. */
  openedAt: number;
}

/** Configuration options for the circuit breaker. */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5. */
  failureThreshold?: number;
  /** Duration in milliseconds to keep the circuit open before half-open. Default: 60000 (60s). */
  resetTimeoutMs?: number;
}

// ----------------------------------------------------------------------------
// CircuitBreaker
// ----------------------------------------------------------------------------

/**
 * Circuit breaker that tracks consecutive failures per provider and
 * temporarily disables providers that are consistently failing.
 *
 * State machine:
 *   CLOSED  — normal operation; failures are counted
 *   OPEN    — provider is skipped; transitions to HALF-OPEN after resetTimeoutMs
 *   HALF-OPEN — one trial request is allowed; success resets to CLOSED, failure re-opens
 */
export class CircuitBreaker {
  private readonly states = new Map<string, ProviderCircuitState>();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
  }

  /**
   * Returns the current state of the circuit for the given provider.
   * If no state exists, returns "closed" (initial state).
   *
   * Note: this method may transition from "open" to "half-open" if the
   * reset timeout has elapsed.
   */
  getState(provider: string): CircuitBreakerState {
    const ps = this.states.get(provider);
    if (!ps) return "closed";

    // Check if an open circuit should transition to half-open
    if (ps.state === "open" && Date.now() - ps.openedAt >= this.resetTimeoutMs) {
      ps.state = "half-open";
      this.healthListeners.forEach((cb) =>
        cb({ provider, state: "half-open", failures: ps.consecutiveFailures }),
      );
    }

    return ps.state;
  }

  /**
   * Resets the circuit for a provider back to "closed" with zero failures.
   */
  reset(provider: string): void {
    this.states.delete(provider);
  }

  getFailureThreshold(): number {
    return this.failureThreshold;
  }

  getResetTimeoutMs(): number {
    return this.resetTimeoutMs;
  }

  /**
   * Executes a function through the circuit breaker for the given provider.
   *
   * - If the circuit is OPEN and the reset timeout has not elapsed, throws immediately.
   * - If CLOSED or HALF-OPEN, executes the function.
   * - On success: resets the circuit to CLOSED.
   * - On failure in CLOSED: increments failure count; opens circuit if threshold reached.
   * - On failure in HALF-OPEN: re-opens the circuit.
   *
   * @param provider - The provider identifier (e.g., "grok", "anthropic").
   * @param fn - The async function to execute.
   * @returns The result of the function.
   * @throws The original error if the function fails, or a CircuitOpenError
   *         if the circuit is open.
   */
  async execute<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState(provider);

    if (currentState === "open") {
      throw new CircuitOpenError(
        `Circuit breaker is open for provider "${provider}". Retry after ${Math.ceil(this.resetTimeoutMs / 1000)}s.`,
        provider,
      );
    }

    try {
      const result = await fn();
      // Success — reset circuit to closed
      this.onSuccess(provider);
      return result;
    } catch (error) {
      // Failure — record and potentially open the circuit
      this.onFailure(provider);
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Internal state transitions
  // --------------------------------------------------------------------------

  private getOrCreate(provider: string): ProviderCircuitState {
    let ps = this.states.get(provider);
    if (!ps) {
      ps = { state: "closed", consecutiveFailures: 0, openedAt: 0 };
      this.states.set(provider, ps);
    }
    return ps;
  }

  private onSuccess(provider: string): void {
    // Any success resets to closed with zero failures
    this.states.set(provider, {
      state: "closed",
      consecutiveFailures: 0,
      openedAt: 0,
    });
  }

  private onFailure(provider: string): void {
    const ps = this.getOrCreate(provider);

    if (ps.state === "half-open") {
      // Half-open trial failed — re-open the circuit
      ps.state = "open";
      ps.openedAt = Date.now();
      return;
    }

    // Closed state — increment failures
    ps.consecutiveFailures++;
    if (ps.consecutiveFailures >= this.failureThreshold) {
      ps.state = "open";
      ps.openedAt = Date.now();
      this.healthListeners.forEach((cb) => cb({ provider, state: "open" as const, failures: ps.consecutiveFailures }));
    }
  }

  private readonly healthListeners: Array<(evt: ProviderHealthEvent) => void> = [];

  onHealthEvent(cb: (evt: ProviderHealthEvent) => void): void {
    this.healthListeners.push(cb);
  }

  formatHealthLine(): string {
    const parts: string[] = [];
    for (const [provider] of this.states) {
      const state = this.getState(provider);
      const ps = this.states.get(provider)!;
      if (state !== "closed" || ps.consecutiveFailures > 0) {
        parts.push(`${provider}:${state}(${ps.consecutiveFailures})`);
      }
    }
    return parts.length > 0 ? `[Provider health] ${parts.join(" ")}` : "[Provider health] all providers healthy";
  }

  getHealthSnapshot(): Record<string, { state: CircuitBreakerState; failures: number }> {
    const snapshot: Record<string, { state: CircuitBreakerState; failures: number }> = {};
    for (const [provider, ps] of this.states) {
      // Exclude pristine closed entries (successfully reset with no recorded failures)
      if (ps.state === "closed" && ps.consecutiveFailures === 0) continue;
      const state = this.getState(provider);
      snapshot[provider] = { state, failures: ps.consecutiveFailures };
    }
    return snapshot;
  }
}

// ----------------------------------------------------------------------------
// Error class
// ----------------------------------------------------------------------------

/**
 * Error thrown when the circuit breaker is open for a provider.
 */
export class CircuitOpenError extends Error {
  public readonly provider: string;

  constructor(message: string, provider: string) {
    super(message);
    this.name = "CircuitOpenError";
    this.provider = provider;
  }
}
