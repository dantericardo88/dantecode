/**
 * metric-counter.ts
 *
 * Simple, zero-dependency metric counter for tracking counts and gauges.
 * Thread-safe via synchronous Map operations.
 */

import type { Metric, MetricType } from "./types.js";

/**
 * MetricCounter - Simple Map-based metric collection
 *
 * Supports two metric types:
 * - counter: cumulative value that can increment/decrement
 * - gauge: point-in-time value that can be set
 */
export class MetricCounter {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private lastUpdate: Map<string, number> = new Map();

  /**
   * Increment a counter metric
   * @param name - Metric name
   * @param value - Value to add (default: 1)
   */
  increment(name: string, value: number = 1): void {
    const current = this.counters.get(name) ?? 0;
    this.counters.set(name, current + value);
    this.lastUpdate.set(name, Date.now());
  }

  /**
   * Decrement a counter metric
   * @param name - Metric name
   * @param value - Value to subtract (default: 1)
   */
  decrement(name: string, value: number = 1): void {
    this.increment(name, -value);
  }

  /**
   * Set a gauge metric to a specific value
   * @param name - Metric name
   * @param value - Gauge value
   */
  gauge(name: string, value: number): void {
    this.gauges.set(name, value);
    this.lastUpdate.set(name, Date.now());
  }

  /**
   * Get the current value of a metric
   * @param name - Metric name
   * @returns Current value or undefined if not set
   */
  get(name: string): number | undefined {
    return this.counters.get(name) ?? this.gauges.get(name);
  }

  /**
   * Get all counter metrics
   * @returns Map of counter name to value
   */
  getCounters(): Record<string, number> {
    return Object.fromEntries(this.counters);
  }

  /**
   * Get all gauge metrics
   * @returns Map of gauge name to value
   */
  getGauges(): Record<string, number> {
    return Object.fromEntries(this.gauges);
  }

  /**
   * Get all metrics (counters + gauges)
   * @returns Map of all metric names to values
   */
  getMetrics(): Record<string, number> {
    return {
      ...this.getCounters(),
      ...this.getGauges(),
    };
  }

  /**
   * Get detailed metric information with metadata
   * @returns Array of Metric objects with timestamps and types
   */
  getMetricsDetailed(): Metric[] {
    const metrics: Metric[] = [];

    for (const [name, value] of this.counters) {
      metrics.push({
        name,
        value,
        type: "counter" as MetricType,
        timestamp: this.lastUpdate.get(name) ?? Date.now(),
      });
    }

    for (const [name, value] of this.gauges) {
      metrics.push({
        name,
        value,
        type: "gauge" as MetricType,
        timestamp: this.lastUpdate.get(name) ?? Date.now(),
      });
    }

    return metrics;
  }

  /**
   * Reset a specific metric
   * @param name - Metric name to reset
   * @returns true if metric existed and was reset, false otherwise
   */
  reset(name: string): boolean {
    const hadCounter = this.counters.delete(name);
    const hadGauge = this.gauges.delete(name);
    this.lastUpdate.delete(name);
    return hadCounter || hadGauge;
  }

  /**
   * Reset all metrics
   */
  resetAll(): void {
    this.counters.clear();
    this.gauges.clear();
    this.lastUpdate.clear();
  }

  /**
   * Get the number of tracked metrics
   * @returns Total count of counters + gauges
   */
  size(): number {
    return this.counters.size + this.gauges.size;
  }
}
