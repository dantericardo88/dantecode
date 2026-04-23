// ============================================================================
// packages/core/src/completion-telemetry/telemetry-service.ts
//
// In-memory ring buffer for completion events + aggregation to CompletionStats.
// Events are also persisted asynchronously via CompletionTelemetryStore.
// ============================================================================

import { randomBytes } from "node:crypto";
import { CompletionTelemetryStore } from "./telemetry-store.js";
import type { CompletionEvent, CompletionStats, LanguageStat, ModelStat } from "./types.js";

const MAX_EVENTS = 5_000;
const MAX_LATENCY_SAMPLES = 1_000;

function roundRate(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Insert `value` into a sorted array (ascending) using binary search insertion.
 * Enforces a maximum array length by shifting out the first element when full.
 */
function sortedInsert(arr: number[], value: number, maxLen: number): void {
  // Binary search for insertion point
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  arr.splice(lo, 0, value);
  if (arr.length > maxLen) arr.shift();
}

/** Compute the p-th percentile from a pre-sorted ascending array. Returns 0 on empty. */
function getPercentile(sortedArr: number[], p: number): number {
  if (sortedArr.length === 0) return 0;
  const index = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, index)]!;
}

/**
 * Core telemetry service for FIM completions.
 *
 * - `record()` — push event to ring buffer; async-persist to JSONL; never blocks
 * - `getStats(windowHours)` — aggregate metrics from the last N hours
 * - `getRecentEvents(n)` — last N events in chronological order
 * - `clearStats()` — empty the in-memory ring (does not delete persisted files)
 */
export class CompletionTelemetryService {
  private readonly _ring: CompletionEvent[] = [];
  private readonly _store: CompletionTelemetryStore;
  /** Sorted ascending list of firstChunkMs values from view events. Used for p50/p95. */
  private readonly _latencySamples: number[] = [];

  constructor(storeDir?: string) {
    this._store = new CompletionTelemetryStore(storeDir ?? ".dantecode/telemetry");
  }

  /** Returns a fresh, unique completion ID ("cmp_" + 12 hex chars). */
  generateCompletionId(): string {
    return "cmp_" + randomBytes(6).toString("hex");
  }

  /**
   * Record a completion event.
   * Pushes to the in-memory ring (evicting oldest if full) and
   * fire-and-forget persists to disk.
   */
  record(event: CompletionEvent): void {
    this._ring.push(event);
    if (this._ring.length > MAX_EVENTS) {
      this._ring.shift();
    }
    // Track first-chunk latency for p50/p95 computation (view events only)
    if (event.eventType === "view" && event.firstChunkMs !== undefined) {
      sortedInsert(this._latencySamples, event.firstChunkMs, MAX_LATENCY_SAMPLES);
    }
    void this._store.persist(event);
  }

  /**
   * Aggregate stats from events in the last `windowHours` hours.
   * Pass windowHours=0 to get an empty stats object (useful for testing).
   */
  getStats(windowHours = 24): CompletionStats {
    // windowHours=0 → return zero stats
    const events =
      windowHours > 0
        ? this._ring.filter((e) => e.timestamp >= Date.now() - windowHours * 3_600_000)
        : [];

    let totalViewed = 0;
    let totalAccepted = 0;
    let totalDismissed = 0;
    let totalPartial = 0;
    let elapsedSum = 0;
    let elapsedCount = 0;
    const byLanguage: Record<string, LanguageStat> = {};
    const byModel: Record<string, ModelStat> = {};

    for (const e of events) {
      if (e.eventType === "view") {
        totalViewed++;
        elapsedSum += e.elapsedMs;
        elapsedCount++;
        this._bumpLang(byLanguage, e.language, "view");
        this._bumpModel(byModel, e.modelId, "view");
      } else if (e.eventType === "select") {
        totalAccepted++;
        this._bumpLang(byLanguage, e.language, "select");
        this._bumpModel(byModel, e.modelId, "select");
      } else if (e.eventType === "dismiss") {
        totalDismissed++;
      } else if (e.eventType === "partial") {
        totalPartial++;
      }
    }

    // Compute derived rates
    for (const s of Object.values(byLanguage)) {
      s.rate = roundRate(s.viewed > 0 ? s.accepted / s.viewed : 0);
    }
    for (const s of Object.values(byModel)) {
      s.rate = roundRate(s.viewed > 0 ? s.accepted / s.viewed : 0);
    }

    // Compute p50/p95 from window-filtered view events only
    const windowLatencies = events
      .filter((e) => e.eventType === "view" && e.firstChunkMs !== undefined)
      .map((e) => e.firstChunkMs!)
      .sort((a, b) => a - b);

    return {
      totalViewed,
      totalAccepted,
      totalDismissed,
      totalPartial,
      acceptanceRate: roundRate(totalViewed > 0 ? totalAccepted / totalViewed : 0),
      avgElapsedMs: elapsedCount > 0 ? Math.round(elapsedSum / elapsedCount) : 0,
      p50LatencyMs: getPercentile(windowLatencies, 50),
      p95LatencyMs: getPercentile(windowLatencies, 95),
      byLanguage,
      byModel,
      windowHours,
    };
  }

  /** Returns the last `n` events in chronological order (oldest first). */
  getRecentEvents(n: number): CompletionEvent[] {
    return this._ring.slice(-n);
  }

  /** Clears the in-memory ring and latency samples. Does NOT delete persisted JSONL files. */
  clearStats(): void {
    this._ring.length = 0;
    this._latencySamples.length = 0;
  }

  /** Exposes the underlying store for tests / inspection. */
  get store(): CompletionTelemetryStore {
    return this._store;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _bumpLang(
    map: Record<string, LanguageStat>,
    lang: string,
    type: "view" | "select",
  ): void {
    if (!map[lang]) map[lang] = { viewed: 0, accepted: 0, rate: 0 };
    if (type === "view") map[lang]!.viewed++;
    else map[lang]!.accepted++;
  }

  private _bumpModel(
    map: Record<string, ModelStat>,
    modelId: string,
    type: "view" | "select",
  ): void {
    if (!map[modelId]) map[modelId] = { viewed: 0, accepted: 0, rate: 0 };
    if (type === "view") map[modelId]!.viewed++;
    else map[modelId]!.accepted++;
  }
}
