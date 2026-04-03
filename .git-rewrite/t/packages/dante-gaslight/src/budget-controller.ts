/**
 * budget-controller.ts
 *
 * Budget & Safety Controller.
 * Tracks token/time/iteration usage and provides stop signals.
 */

import type { GaslightConfig } from "./types.js";
import type { BudgetState } from "./stop-conditions.js";

export class BudgetController {
  private tokensUsed = 0;
  private iterations = 0;
  private startMs: number;
  private userStopped = false;
  private config: GaslightConfig;

  constructor(config: GaslightConfig) {
    this.config = config;
    this.startMs = Date.now();
  }

  /** Record token usage for an iteration. */
  addTokens(n: number): void {
    this.tokensUsed += Math.max(0, n);
  }

  /** Increment iteration counter. */
  incrementIteration(): void {
    this.iterations += 1;
  }

  /** Signal an immediate user stop. */
  stop(): void {
    this.userStopped = true;
  }

  /** Get current budget state snapshot. */
  snapshot(): BudgetState {
    return {
      tokensUsed: this.tokensUsed,
      elapsedMs: Date.now() - this.startMs,
      iterations: this.iterations,
      userStopped: this.userStopped,
    };
  }

  /** Check remaining token budget. */
  remainingTokens(): number {
    return Math.max(0, this.config.maxTokens - this.tokensUsed);
  }

  /** Check remaining iteration budget. */
  remainingIterations(): number {
    return Math.max(0, this.config.maxIterations - this.iterations);
  }

  /** Quick check: has any hard cap been hit? */
  isExhausted(): boolean {
    if (this.userStopped) return true;
    if (this.tokensUsed >= this.config.maxTokens) return true;
    if (this.iterations >= this.config.maxIterations) return true;
    if (Date.now() - this.startMs >= this.config.maxSeconds * 1000) return true;
    return false;
  }

  /** Remaining budget summary for logging. */
  summary(): string {
    const elapsed = Math.round((Date.now() - this.startMs) / 1000);
    return `tokens=${this.tokensUsed}/${this.config.maxTokens} iterations=${this.iterations}/${this.config.maxIterations} elapsed=${elapsed}s/${this.config.maxSeconds}s`;
  }
}
