// ============================================================================
// packages/core/src/fim-latency-tracker.ts
//
// FIM latency histogram for inline completion performance measurement.
// Tracks time from suggestion trigger to accept/reject, computes p50/p90/p99,
// and buckets into sub-100ms / sub-300ms / sub-1000ms / over-1000ms ranges.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FimLatencyEntry {
  latencyMs: number;
  language: string;
  accepted: boolean;
  timestamp: string;
}

export interface FimLatencyHistogram {
  p50: number;
  p90: number;
  p99: number;
  buckets: {
    sub100: number;
    sub300: number;
    sub1000: number;
    over1000: number;
  };
  totalSamples: number;
}

// ── Internal ──────────────────────────────────────────────────────────────────

const LATENCY_FILE = "fim-latency-log.jsonl";

function danteDir(projectRoot: string): string {
  return join(projectRoot, ".danteforge");
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))]!;
}

// ── recordFimLatency ──────────────────────────────────────────────────────────

/**
 * Records a single FIM latency observation.
 * Appends a JSONL line to .danteforge/fim-latency-log.jsonl.
 */
export function recordFimLatency(
  latencyMs: number,
  language: string,
  accepted: boolean,
  projectRoot: string,
): void {
  try {
    const dir = danteDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    const entry: FimLatencyEntry = {
      latencyMs,
      language,
      accepted,
      timestamp: new Date().toISOString(),
    };
    appendFileSync(join(dir, LATENCY_FILE), JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

// ── loadFimLatencyLog ─────────────────────────────────────────────────────────

export function loadFimLatencyLog(projectRoot: string): FimLatencyEntry[] {
  try {
    const p = join(danteDir(projectRoot), LATENCY_FILE);
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as FimLatencyEntry);
  } catch {
    return [];
  }
}

// ── buildFimLatencyHistogram ──────────────────────────────────────────────────

/**
 * Computes p50/p90/p99 and bucket counts from a set of latency entries.
 */
export function buildFimLatencyHistogram(entries: FimLatencyEntry[]): FimLatencyHistogram {
  if (entries.length === 0) {
    return { p50: 0, p90: 0, p99: 0, buckets: { sub100: 0, sub300: 0, sub1000: 0, over1000: 0 }, totalSamples: 0 };
  }

  const sorted = [...entries].map((e) => e.latencyMs).sort((a, b) => a - b);

  const buckets = { sub100: 0, sub300: 0, sub1000: 0, over1000: 0 };
  for (const ms of sorted) {
    if (ms < 100) buckets.sub100++;
    else if (ms < 300) buckets.sub300++;
    else if (ms < 1000) buckets.sub1000++;
    else buckets.over1000++;
  }

  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    buckets,
    totalSamples: entries.length,
  };
}

// ── getFimLatencyStats ────────────────────────────────────────────────────────

/** Loads the latency log for projectRoot and returns a histogram. */
export function getFimLatencyStats(projectRoot: string): FimLatencyHistogram {
  return buildFimLatencyHistogram(loadFimLatencyLog(projectRoot));
}
