// Sprint AI — Dim 24: Provider health router
// Routes model requests away from degraded (open-circuit) providers.
// Wired to CircuitBreaker health events so routing stays current in real time.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CircuitBreakerState } from "./circuit-breaker.js";

export interface ProviderHealthStatus {
  provider: string;
  state: CircuitBreakerState;
  failures: number;
  degradedAt?: string;
  recoveredAt?: string;
}

export interface HealthRouteLogEntry {
  timestamp: string;
  selected: string;
  skipped: string[];
  reason: string;
}

/**
 * Tracks provider health state and selects the best available provider.
 * Updated in real-time via onHealthEvent callbacks from CircuitBreaker.
 */
export class ProviderHealthRouter {
  private readonly _states = new Map<string, ProviderHealthStatus>();
  private readonly _projectRoot: string;

  constructor(projectRoot = process.cwd()) {
    this._projectRoot = projectRoot;
  }

  /** Update provider state from a health event (open/half-open transitions). */
  handleHealthEvent(provider: string, state: CircuitBreakerState, failures: number): void {
    const existing = this._states.get(provider);
    const now = new Date().toISOString();
    this._states.set(provider, {
      provider,
      state,
      failures,
      degradedAt: state === "open" ? now : existing?.degradedAt,
      recoveredAt: state === "closed" ? now : existing?.recoveredAt,
    });
  }

  /** Mark a provider as healthy (closed circuit). */
  markHealthy(provider: string): void {
    this._states.set(provider, {
      provider,
      state: "closed",
      failures: 0,
      recoveredAt: new Date().toISOString(),
    });
  }

  /** Returns true if the provider circuit is open (degraded). */
  isDegraded(provider: string): boolean {
    return this._states.get(provider)?.state === "open";
  }

  /**
   * Choose the best provider from a ranked candidate list.
   * Skips providers with open circuits; logs the routing decision.
   */
  chooseProvider(candidates: string[]): string | null {
    const skipped: string[] = [];
    for (const candidate of candidates) {
      if (this.isDegraded(candidate)) {
        skipped.push(candidate);
        continue;
      }
      if (skipped.length > 0 || this._states.has(candidate)) {
        this._emitRouteLog(candidate, skipped, skipped.length > 0 ? "skipped degraded providers" : "all providers healthy");
      }
      return candidate;
    }
    // All degraded — fall back to first candidate
    this._emitRouteLog(candidates[0] ?? "none", skipped, "all providers degraded — using first as fallback");
    return candidates[0] ?? null;
  }

  /** Get current health snapshot for all tracked providers. */
  getHealthSnapshot(): ProviderHealthStatus[] {
    return Array.from(this._states.values());
  }

  /** Format health state as a single line for logging. */
  formatHealthLine(): string {
    const parts = this.getHealthSnapshot().map(
      (s) => `${s.provider}: ${s.state}${s.state !== "closed" ? ` (${s.failures} failures)` : ""}`,
    );
    return parts.length > 0
      ? `[Health router] ${parts.join(" | ")}`
      : "[Health router] no providers tracked";
  }

  private _emitRouteLog(selected: string, skipped: string[], reason: string): void {
    try {
      const dir = join(this._projectRoot, ".danteforge");
      mkdirSync(dir, { recursive: true });
      const entry: HealthRouteLogEntry = {
        timestamp: new Date().toISOString(),
        selected,
        skipped,
        reason,
      };
      appendFileSync(join(dir, "health-route-log.json"), JSON.stringify(entry) + "\n", "utf-8");
    } catch { /* non-fatal */ }
  }
}
