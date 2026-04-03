/**
 * Prometheus-compatible metrics collection for DanteCode.
 *
 * Supports counter, gauge, histogram, and summary metric types.
 * Output can be formatted as Prometheus text exposition format or JSON.
 */

export type MetricType = "counter" | "gauge" | "histogram" | "summary";

export interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
  labels?: string[];
}

export interface MetricSample {
  name: string;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

export interface HistogramBuckets {
  [bound: string]: number;
  "+Inf": number;
}

/**
 * Prometheus-compatible metrics collector.
 *
 * Tracks counters, gauges, histograms, and timing samples.
 * Supports Prometheus text format export and JSON serialization.
 *
 * @example
 * ```ts
 * const metrics = new MetricsCollector();
 * metrics.register({ name: "requests_total", help: "Total requests", type: "counter" });
 * metrics.increment("requests_total");
 * console.log(metrics.toPrometheus());
 * ```
 */
export class MetricsCollector {
  private readonly counters: Map<string, number>;
  private readonly gauges: Map<string, number>;
  private readonly histograms: Map<string, number[]>;
  private readonly timings: Map<string, number[]>;
  private readonly definitions: Map<string, MetricDefinition>;
  private readonly samples: MetricSample[];

  constructor() {
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.timings = new Map();
    this.definitions = new Map();
    this.samples = [];
  }

  /**
   * Register a metric definition.
   *
   * @param def - The metric definition to register.
   */
  register(def: MetricDefinition): void {
    this.definitions.set(def.name, def);
  }

  /**
   * Increment a counter metric by a given value.
   * Creates the counter at 0 then increments if it does not exist yet.
   *
   * @param name   - Counter metric name.
   * @param value  - Amount to increment by. Defaults to 1.
   * @param labels - Optional label key/value pairs for the sample record.
   */
  increment(name: string, value: number = 1, labels: Record<string, string> = {}): void {
    const current = this.counters.get(name) ?? 0;
    this.counters.set(name, current + value);
    this.samples.push({
      name,
      value: current + value,
      labels,
      timestamp: Date.now(),
    });
  }

  /**
   * Record a gauge value, replacing any previous value.
   *
   * @param name   - Gauge metric name.
   * @param value  - New gauge value.
   * @param labels - Optional label key/value pairs for the sample record.
   */
  record(name: string, value: number, labels: Record<string, string> = {}): void {
    this.gauges.set(name, value);
    this.samples.push({ name, value, labels, timestamp: Date.now() });
  }

  /**
   * Add a value to a histogram bucket list.
   *
   * @param name  - Histogram metric name.
   * @param value - Observed value to record.
   */
  observe(name: string, value: number): void {
    const existing = this.histograms.get(name) ?? [];
    existing.push(value);
    this.histograms.set(name, existing);
    this.samples.push({ name, value, labels: {}, timestamp: Date.now() });
  }

  /**
   * Record a timing duration in milliseconds.
   *
   * @param name       - Timing metric name.
   * @param durationMs - Duration in milliseconds.
   */
  recordTiming(name: string, durationMs: number): void {
    const existing = this.timings.get(name) ?? [];
    existing.push(durationMs);
    this.timings.set(name, existing);
    this.samples.push({
      name,
      value: durationMs,
      labels: {},
      timestamp: Date.now(),
    });
  }

  /**
   * Get the current value of a counter metric.
   *
   * @param name - Counter metric name.
   * @returns Current counter value, or 0 if not found.
   */
  getCounter(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  /**
   * Get the current value of a gauge metric.
   *
   * @param name - Gauge metric name.
   * @returns Current gauge value, or undefined if not found.
   */
  getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  /**
   * Get all recorded values for a histogram metric.
   *
   * @param name - Histogram metric name.
   * @returns Array of observed values, or empty array if not found.
   */
  getHistogram(name: string): number[] {
    return this.histograms.get(name) ?? [];
  }

  /**
   * Get all recorded timing durations for a timing metric.
   *
   * @param name - Timing metric name.
   * @returns Array of durations in ms, or empty array if not found.
   */
  getTimings(name: string): number[] {
    return this.timings.get(name) ?? [];
  }

  /**
   * Format all registered metrics in Prometheus text exposition format.
   *
   * Each metric block includes:
   * - `# HELP <name> <help text>`
   * - `# TYPE <name> <type>`
   * - One or more `<name> <value> <timestamp>` lines
   *
   * @returns Prometheus-formatted metric string.
   */
  toPrometheus(): string {
    const lines: string[] = [];
    const now = Date.now();

    // Emit registered definitions first
    for (const [name, def] of this.definitions) {
      lines.push(`# HELP ${name} ${def.help}`);
      lines.push(`# TYPE ${name} ${def.type}`);

      switch (def.type) {
        case "counter": {
          const val = this.counters.get(name) ?? 0;
          lines.push(`${name} ${val} ${now}`);
          break;
        }
        case "gauge": {
          const val = this.gauges.get(name);
          if (val !== undefined) {
            lines.push(`${name} ${val} ${now}`);
          }
          break;
        }
        case "histogram": {
          const vals = this.histograms.get(name) ?? [];
          if (vals.length > 0) {
            const sorted = [...vals].sort((a, b) => a - b);
            const sum = sorted.reduce((acc, v) => acc + v, 0);
            const count = sorted.length;
            // Standard histogram buckets
            const bounds = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
            for (const le of bounds) {
              const bucket = sorted.filter((v) => v <= le).length;
              lines.push(`${name}_bucket{le="${le}"} ${bucket} ${now}`);
            }
            lines.push(`${name}_bucket{le="+Inf"} ${count} ${now}`);
            lines.push(`${name}_sum ${sum} ${now}`);
            lines.push(`${name}_count ${count} ${now}`);
          }
          break;
        }
        case "summary": {
          const vals = this.timings.get(name) ?? [];
          if (vals.length > 0) {
            const sorted = [...vals].sort((a, b) => a - b);
            const sum = sorted.reduce((acc, v) => acc + v, 0);
            const count = sorted.length;
            const quantiles = [0.5, 0.9, 0.95, 0.99];
            for (const q of quantiles) {
              const pval = this.computePercentile(sorted, q * 100);
              lines.push(`${name}{quantile="${q}"} ${pval} ${now}`);
            }
            lines.push(`${name}_sum ${sum} ${now}`);
            lines.push(`${name}_count ${count} ${now}`);
          }
          break;
        }
      }

      lines.push(""); // blank line between metric families
    }

    // Emit ad-hoc counters not in definitions
    for (const [name, val] of this.counters) {
      if (!this.definitions.has(name)) {
        lines.push(`# TYPE ${name} counter`);
        lines.push(`${name} ${val} ${now}`);
        lines.push("");
      }
    }

    // Emit ad-hoc gauges not in definitions
    for (const [name, val] of this.gauges) {
      if (!this.definitions.has(name)) {
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name} ${val} ${now}`);
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  /**
   * Serialize all metrics to a JSON-compatible object.
   *
   * @returns Object containing counters, gauges, histograms, and timings.
   */
  toJSON(): Record<string, unknown> {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(this.histograms),
      timings: Object.fromEntries(this.timings),
      definitions: Object.fromEntries(
        [...this.definitions.entries()].map(([k, v]) => [k, { ...v }]),
      ),
      sampleCount: this.samples.length,
    };
  }

  /**
   * Reset all metric values while preserving registered definitions.
   *
   * Clears counters, gauges, histograms, timings, and the sample log.
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.timings.clear();
    this.samples.length = 0;
  }

  /**
   * Return all recorded metric samples in insertion order.
   *
   * @returns Array of all MetricSample records.
   */
  getSamples(): MetricSample[] {
    return [...this.samples];
  }

  /**
   * Compute the Nth percentile of a pre-sorted array of numbers.
   *
   * Uses the nearest-rank method. The array must be sorted in ascending order.
   *
   * @param values - Sorted array of numeric values.
   * @param p      - Percentile to compute (0–100).
   * @returns The value at the Nth percentile, or 0 if the array is empty.
   */
  computePercentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    if (p <= 0) return values[0]!;
    if (p >= 100) return values[values.length - 1]!;

    const rank = (p / 100) * (values.length - 1);
    const lower = Math.floor(rank);
    const upper = Math.ceil(rank);
    const fraction = rank - lower;

    const lVal = values[lower] ?? 0;
    const uVal = values[upper] ?? 0;

    return lVal + fraction * (uVal - lVal);
  }
}
