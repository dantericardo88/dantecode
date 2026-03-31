/**
 * health-surface.ts
 *
 * Health check system for monitoring component health.
 * Supports async checks with timeouts and aggregation.
 */

import type { HealthCheckFn, HealthCheckResult, HealthReport, HealthStatus } from "./types.js";

/**
 * HealthSurface - Manages and runs health checks
 *
 * Provides a centralized system for:
 * - Registering health checks for different components
 * - Running checks with timeout protection
 * - Aggregating results into overall health status
 */
export class HealthSurface {
  private checks: Map<string, HealthCheckFn> = new Map();
  private defaultTimeout: number = 5000; // 5 seconds

  /**
   * Register a health check
   * @param name - Unique check name (e.g., "database", "api", "cache")
   * @param fn - Async function that returns health status
   */
  registerCheck(name: string, fn: HealthCheckFn): void {
    this.checks.set(name, fn);
  }

  /**
   * Unregister a health check
   * @param name - Check name to remove
   * @returns true if check existed and was removed
   */
  unregisterCheck(name: string): boolean {
    return this.checks.delete(name);
  }

  /**
   * Set default timeout for health checks
   * @param timeoutMs - Timeout in milliseconds
   */
  setTimeout(timeoutMs: number): void {
    this.defaultTimeout = timeoutMs;
  }

  /**
   * Run a single health check with timeout
   * @param name - Check name
   * @param timeoutMs - Optional timeout override
   * @returns Health check result
   */
  async runCheck(
    name: string,
    timeoutMs: number = this.defaultTimeout,
  ): Promise<HealthCheckResult> {
    const checkFn = this.checks.get(name);
    if (!checkFn) {
      return {
        name,
        status: "unhealthy" as HealthStatus,
        message: "Check not found",
        timestamp: Date.now(),
        duration: 0,
      };
    }

    const startTime = Date.now();
    try {
      const status = await this.withTimeout(checkFn(), timeoutMs);
      const endTime = Date.now();

      return {
        name,
        status,
        timestamp: endTime,
        duration: endTime - startTime,
      };
    } catch (error) {
      const endTime = Date.now();
      return {
        name,
        status: "unhealthy" as HealthStatus,
        message: error instanceof Error ? error.message : String(error),
        timestamp: endTime,
        duration: endTime - startTime,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Run all registered health checks
   * @param timeoutMs - Optional timeout override for all checks
   * @returns Aggregated health report
   */
  async runChecks(timeoutMs: number = this.defaultTimeout): Promise<HealthReport> {
    const checkNames = Array.from(this.checks.keys());
    const results = await Promise.all(checkNames.map((name) => this.runCheck(name, timeoutMs)));

    return this.aggregateResults(results);
  }

  /**
   * Get all registered check names
   * @returns Array of check names
   */
  getCheckNames(): string[] {
    return Array.from(this.checks.keys());
  }

  /**
   * Get the number of registered checks
   * @returns Count of checks
   */
  checkCount(): number {
    return this.checks.size;
  }

  /**
   * Clear all registered checks
   */
  clear(): void {
    this.checks.clear();
  }

  /**
   * Aggregate individual check results into a report
   * @param results - Array of health check results
   * @returns Aggregated health report
   */
  private aggregateResults(results: HealthCheckResult[]): HealthReport {
    const healthyCount = results.filter((r) => r.status === "healthy").length;
    const degradedCount = results.filter((r) => r.status === "degraded").length;
    const unhealthyCount = results.filter((r) => r.status === "unhealthy").length;

    // Overall status: unhealthy if any unhealthy, degraded if any degraded, else healthy
    let overallStatus: HealthStatus = "healthy";
    if (unhealthyCount > 0) {
      overallStatus = "unhealthy";
    } else if (degradedCount > 0) {
      overallStatus = "degraded";
    }

    return {
      status: overallStatus,
      checks: results,
      timestamp: Date.now(),
      totalChecks: results.length,
      healthyCount,
      degradedCount,
      unhealthyCount,
    };
  }

  /**
   * Helper: Run a promise with timeout
   * @param promise - Promise to run
   * @param timeoutMs - Timeout in milliseconds
   * @returns Promise result or timeout error
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Health check timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }
}
