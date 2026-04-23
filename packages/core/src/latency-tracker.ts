// ============================================================================
// packages/core/src/latency-tracker.ts
//
// Dim 38 — Latency / Responsiveness
// General-purpose latency tracker with rolling window p50/p95/p99.
//
// Patterns from:
// - opentelemetry-js histogram (Apache-2.0): bucket-based percentile approach
// - FimLatencyTracker (packages/vscode/src/fim-latency-tracker.ts): sliding
//   window design with MAX_SAMPLES eviction — extended here to multiple categories
// - continue (Apache-2.0): per-provider telemetry event schema for latency
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LatencyCategory = "api-ttfb" | "tool-exec" | "dev-server" | "fim" | "stream-chunk";

export interface LatencyRecord {
  category: LatencyCategory;
  operationId: string;
  durationMs: number;
  success: boolean;
  recordedAt: string;
}

export interface LatencyStats {
  category: LatencyCategory;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
  meanMs: number;
}

export interface LatencySnapshot {
  sessionId: string;
  stats: LatencyStats[];
  recordedAt: string;
}

// ── LatencyTracker ────────────────────────────────────────────────────────────

const MAX_SAMPLES = 200;

export class LatencyTracker {
  private readonly samples = new Map<LatencyCategory, number[]>();

  record(category: LatencyCategory, durationMs: number): void {
    let bucket = this.samples.get(category);
    if (!bucket) {
      bucket = [];
      this.samples.set(category, bucket);
    }
    bucket.push(durationMs);
    if (bucket.length > MAX_SAMPLES) {
      bucket.shift();
    }
  }

  getStats(category: LatencyCategory): LatencyStats | null {
    const bucket = this.samples.get(category);
    if (!bucket || bucket.length < 3) return null;
    const sorted = [...bucket].sort((a, b) => a - b);
    const mean = Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length);
    return {
      category,
      p50Ms: this._percentile(sorted, 50),
      p95Ms: this._percentile(sorted, 95),
      p99Ms: this._percentile(sorted, 99),
      sampleCount: sorted.length,
      meanMs: mean,
    };
  }

  startTimer(category: LatencyCategory, _operationId: string): () => number {
    const start = Date.now();
    return () => {
      const elapsed = Date.now() - start;
      this.record(category, elapsed);
      return elapsed;
    };
  }

  getAllStats(): LatencyStats[] {
    const result: LatencyStats[] = [];
    for (const category of this.samples.keys()) {
      const stats = this.getStats(category);
      if (stats) result.push(stats);
    }
    return result;
  }

  formatSummary(): string {
    const all = this.getAllStats();
    if (all.length === 0) return "No latency data yet";
    return all
      .map((s) => {
        const label =
          s.category === "api-ttfb" ? "API" :
          s.category === "tool-exec" ? "Tool" :
          s.category === "dev-server" ? "DevServer" :
          s.category === "fim" ? "FIM" : "Stream";
        const p50display = s.p50Ms >= 1000 ? `${(s.p50Ms / 1000).toFixed(1)}s` : `${s.p50Ms}ms`;
        const p95display = s.p95Ms >= 1000 ? `${(s.p95Ms / 1000).toFixed(1)}s` : `${s.p95Ms}ms`;
        return `${label} p50:${p50display} p95:${p95display}`;
      })
      .join(" | ");
  }

  reset(): void {
    this.samples.clear();
  }

  private _percentile(sorted: number[], p: number): number {
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)]!;
  }
}

export const globalLatencyTracker = new LatencyTracker();

// ── JSONL Persistence ─────────────────────────────────────────────────────────

const LATENCY_LOG_FILE = ".danteforge/latency-log.jsonl";

export function recordLatencySnapshot(stats: LatencyStats[], projectRoot: string, sessionId = "session"): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    const snapshot: LatencySnapshot = {
      sessionId,
      stats,
      recordedAt: new Date().toISOString(),
    };
    appendFileSync(
      join(dir, "latency-log.jsonl"),
      JSON.stringify(snapshot) + "\n",
      "utf-8",
    );
  } catch { /* non-fatal */ }
}

export function loadLatencyLog(projectRoot: string): LatencySnapshot[] {
  const path = join(resolve(projectRoot), LATENCY_LOG_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as LatencySnapshot);
  } catch {
    return [];
  }
}
