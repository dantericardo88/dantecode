// ============================================================================
// packages/core/src/completion-telemetry/types.ts
// ============================================================================

export type CompletionEventType = "view" | "select" | "dismiss" | "partial";

export interface CompletionEvent {
  readonly completionId: string;
  readonly eventType: CompletionEventType;
  readonly language: string;
  readonly modelId: string;
  /** Milliseconds from request start to first character shown */
  readonly elapsedMs: number;
  /** Milliseconds from stream open to receipt of first chunk (TTFB). Only set on "view" events from streaming completions. */
  readonly firstChunkMs?: number;
  /** Length of the full completion text in characters */
  readonly completionLength: number;
  /** Only set for "partial" events — how many chars the user actually accepted */
  readonly acceptedLength?: number;
  readonly timestamp: number;
}

export interface LanguageStat {
  viewed: number;
  accepted: number;
  rate: number;
}

export interface ModelStat {
  viewed: number;
  accepted: number;
  rate: number;
}

export interface CompletionStats {
  readonly totalViewed: number;
  readonly totalAccepted: number;
  readonly totalDismissed: number;
  readonly totalPartial: number;
  /** acceptedCount / viewedCount, rounded to 2 decimal places */
  readonly acceptanceRate: number;
  readonly avgElapsedMs: number;
  /** 50th-percentile TTFB across view events that recorded firstChunkMs. 0 when no samples. */
  readonly p50LatencyMs: number;
  /** 95th-percentile TTFB across view events that recorded firstChunkMs. 0 when no samples. */
  readonly p95LatencyMs: number;
  readonly byLanguage: Record<string, LanguageStat>;
  readonly byModel: Record<string, ModelStat>;
  /** The windowHours argument passed to getStats() */
  readonly windowHours: number;
}
