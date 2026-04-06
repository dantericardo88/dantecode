// ============================================================================
// @dantecode/core — Full Agent State Machine
// Models the lifecycle of an agent run as an explicit state machine.
// Based on OpenHands' agent_controller.py state management pattern.
// ============================================================================

// ─── State Definitions ────────────────────────────────────────────────────────

export type AgentState =
  | "idle"
  | "loading"
  | "running"
  | "paused"
  | "waiting_for_input"
  | "rate_limited"
  | "finished"
  | "error"
  | "stopped";

// ─── Transition Record ────────────────────────────────────────────────────────

export interface StateTransition {
  from: AgentState;
  to: AgentState;
  trigger: string;
  timestamp: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface AgentStateMachineConfig {
  onStateChange?: (from: AgentState, to: AgentState, trigger: string) => void;
  onError?: (error: Error, state: AgentState) => void;
  /** Maximum number of rate-limit retries before transitioning to error. Default: 5 */
  maxRateLimitRetries?: number;
  /** Milliseconds to wait between rate-limit retries. Default: 10000 */
  rateLimitRetryDelayMs?: number;
}

// ─── Valid Transitions ────────────────────────────────────────────────────────
// Mirrors the OpenHands agent_controller.py state machine:
//   idle → loading → running
//   running → paused → running
//   running → waiting_for_input → running
//   running → rate_limited → running (after delay)
//   running → finished
//   running → error
//   any → stopped

const VALID_TRANSITIONS: Readonly<Map<AgentState, ReadonlySet<AgentState>>> = new Map([
  ["idle", new Set<AgentState>(["loading", "stopped"])],
  ["loading", new Set<AgentState>(["running", "error", "stopped"])],
  ["running", new Set<AgentState>(["paused", "waiting_for_input", "rate_limited", "finished", "error", "stopped"])],
  ["paused", new Set<AgentState>(["running", "stopped"])],
  ["waiting_for_input", new Set<AgentState>(["running", "stopped"])],
  ["rate_limited", new Set<AgentState>(["running", "error", "stopped"])],
  ["finished", new Set<AgentState>(["stopped"])],
  ["error", new Set<AgentState>(["idle", "stopped"])],
  ["stopped", new Set<AgentState>(["idle"])],
]);

// ─── Agent State Machine ──────────────────────────────────────────────────────

export class AgentStateMachine {
  private state: AgentState = "idle";
  private history: StateTransition[] = [];
  private rateLimitRetries = 0;

  private readonly maxRateLimitRetries: number;
  private readonly rateLimitRetryDelayMs: number;

  constructor(private readonly config: AgentStateMachineConfig = {}) {
    this.maxRateLimitRetries = config.maxRateLimitRetries ?? 5;
    this.rateLimitRetryDelayMs = config.rateLimitRetryDelayMs ?? 10_000;
  }

  /**
   * Attempt a state transition.
   * Returns true if the transition was valid and applied.
   * Returns false if the transition is invalid for the current state.
   */
  transition(to: AgentState, trigger: string): boolean {
    const allowed = VALID_TRANSITIONS.get(this.state);
    if (!allowed?.has(to)) {
      return false;
    }

    const from = this.state;
    this.state = to;
    const transition: StateTransition = {
      from,
      to,
      trigger,
      timestamp: new Date().toISOString(),
    };
    this.history.push(transition);

    try {
      this.config.onStateChange?.(from, to, trigger);
    } catch (err) {
      // Callbacks must not crash the state machine
      const error = err instanceof Error ? err : new Error(String(err));
      this.config.onError?.(error, this.state);
    }

    return true;
  }

  /** Current state */
  getState(): AgentState {
    return this.state;
  }

  /** Full transition history (copy) */
  getHistory(): StateTransition[] {
    return [...this.history];
  }

  /** True if the state machine has reached a terminal state (finished, error, or stopped) */
  isTerminal(): boolean {
    return this.state === "finished" || this.state === "error" || this.state === "stopped";
  }

  /** True if the agent is actively doing work (running or waiting_for_input) */
  isActive(): boolean {
    return this.state === "running" || this.state === "waiting_for_input";
  }

  /** True if the agent can be resumed from its current state */
  canResume(): boolean {
    return (
      this.state === "paused" ||
      this.state === "rate_limited" ||
      this.state === "waiting_for_input"
    );
  }

  /** Reset to idle, clearing history */
  reset(): void {
    this.state = "idle";
    this.history = [];
    this.rateLimitRetries = 0;
  }

  /**
   * Handle rate limiting with automatic retry.
   * Transitions to rate_limited, waits rateLimitRetryDelayMs, then retries.
   * If max retries exceeded, transitions to error.
   */
  async handleRateLimit(retryFn: () => Promise<void>): Promise<void> {
    if (this.rateLimitRetries >= this.maxRateLimitRetries) {
      const err = new Error(
        `Rate limit retry limit reached (${this.maxRateLimitRetries} attempts)`,
      );
      this.transition("error", "rate_limit_max_retries");
      this.config.onError?.(err, this.state);
      throw err;
    }

    this.rateLimitRetries++;
    const transitioned = this.transition(
      "rate_limited",
      `rate_limit_retry_${this.rateLimitRetries}`,
    );
    if (!transitioned) {
      // Already in a non-running state; just wait and retry
    }

    await new Promise<void>((resolve) => setTimeout(resolve, this.rateLimitRetryDelayMs));

    // Transition back to running before calling the retry function
    this.transition("running", `rate_limit_resume_${this.rateLimitRetries}`);

    await retryFn();
  }
}
