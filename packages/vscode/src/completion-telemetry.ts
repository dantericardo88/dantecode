// ============================================================================
// DanteCode VS Code Extension — Completion Telemetry
// Tracks accept/reject/partial patterns for inline completions.
// All data stays local — never sent to any external service.
// Storage: .dantecode/completion-telemetry.json
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export interface CompletionEvent {
  timestamp: string;
  modelId: string;
  language: string;
  filePath: string;
  completionLength: number;
  completionLines: number;
  isMultiline: boolean;
  outcome: "accepted" | "rejected" | "partial" | "expired";
  latencyMs: number;
  pdseScore?: number;
  cacheHit: boolean;
  contextTokens: number;
}

export interface CompletionStats {
  totalShown: number;
  accepted: number;
  rejected: number;
  partial: number;
  expired: number;
  acceptRate: number;
  averageLatencyMs: number;
  cacheHitRate: number;
  byLanguage: Record<string, { shown: number; accepted: number; rate: number }>;
  byModel: Record<string, { shown: number; accepted: number; rate: number }>;
  multilineAcceptRate: number;
  singleLineAcceptRate: number;
}

export interface CompletionAdaptiveHints {
  preferMultiline: boolean;
  suggestedDebounceMs: number;
  strongLanguages: string[];
  weakLanguages: string[];
  preferredModels: string[];
  averageAcceptedLength: number;
}

/** Disk-serialized format for persistence. */
interface PersistedTelemetry {
  version: number;
  events: CompletionEvent[];
}

/**
 * Tracks completion accept/reject/partial patterns locally.
 * Feeds into session stats, Model Personality Profiles, and adaptive hints.
 * Privacy: zero external calls. All data stays in .dantecode/.
 */
export class CompletionTelemetry {
  private events: CompletionEvent[] = [];
  private readonly storagePath: string;
  private readonly maxEvents = 10_000;

  constructor(projectRoot: string) {
    this.storagePath = join(projectRoot, ".dantecode", "completion-telemetry.json");
  }

  /**
   * Record a completion event. Oldest events are pruned when the cap is
   * exceeded so memory usage stays bounded.
   */
  record(event: CompletionEvent): void {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      // Trim from the front — oldest first
      this.events = this.events.slice(this.events.length - this.maxEvents);
    }
  }

  /** Aggregate stats across all recorded events. */
  getStats(): CompletionStats {
    return this._computeStats(this.events);
  }

  /** Stats filtered to a single model — used for Model Personality Profiles. */
  getStatsByModel(modelId: string): CompletionStats {
    return this._computeStats(this.events.filter((e) => e.modelId === modelId));
  }

  /** Most recent `count` events (default: all). */
  getRecent(count?: number): CompletionEvent[] {
    if (count === undefined) return [...this.events];
    return this.events.slice(-count);
  }

  /** Persist events to .dantecode/completion-telemetry.json. */
  async flush(): Promise<void> {
    const dir = dirname(this.storagePath);
    await mkdir(dir, { recursive: true });
    const payload: PersistedTelemetry = { version: 1, events: this.events };
    await writeFile(this.storagePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  /** Load events from disk on startup. Silently ignores missing / corrupt files. */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.storagePath, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        "events" in parsed &&
        Array.isArray((parsed as PersistedTelemetry).events)
      ) {
        this.events = (parsed as PersistedTelemetry).events;
      }
    } catch {
      // File missing or corrupt — start fresh
    }
  }

  /**
   * Remove events older than 30 days.
   * Returns the number of events removed.
   */
  prune(): number {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const before = this.events.length;
    this.events = this.events.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
    return before - this.events.length;
  }

  /**
   * User's multiline preference based on accept rates.
   * Returns "neutral" when insufficient data (<10 events total).
   */
  getMultilinePreference(): "prefer-multiline" | "prefer-single" | "neutral" {
    if (this.events.length < 10) return "neutral";

    const stats = this.getStats();
    const mlRate = stats.multilineAcceptRate;
    const slRate = stats.singleLineAcceptRate;

    if (mlRate > slRate + 0.1) return "prefer-multiline";
    if (slRate > mlRate + 0.1) return "prefer-single";
    return "neutral";
  }

  /** Derive adaptive behavioral hints from the recorded telemetry. */
  getAdaptiveHints(): CompletionAdaptiveHints {
    const stats = this.getStats();
    const recent = this.getRecent(500);

    // Multiline preference
    const preferMultiline = stats.multilineAcceptRate > stats.singleLineAcceptRate + 0.1;

    // Debounce: base on accepted latency — faster accepts → quicker suggestions
    const acceptedEvents = recent.filter((e) => e.outcome === "accepted");
    const avgLatency =
      acceptedEvents.length > 0
        ? acceptedEvents.reduce((s, e) => s + e.latencyMs, 0) / acceptedEvents.length
        : 180;
    const suggestedDebounceMs = Math.max(80, Math.min(300, avgLatency * 0.6));

    // Language analysis
    const langStats = Object.entries(stats.byLanguage);
    const strongLanguages = langStats.filter(([, s]) => s.rate > 0.4).map(([l]) => l);
    const weakLanguages = langStats
      .filter(([, s]) => s.rate < 0.15 && s.shown > 20)
      .map(([l]) => l);

    // Model analysis
    const modelStats = Object.entries(stats.byModel);
    const preferredModels = modelStats
      .filter(([, s]) => s.rate > 0.3)
      .sort((a, b) => b[1].rate - a[1].rate)
      .map(([m]) => m);

    // Average accepted completion length
    const averageAcceptedLength =
      acceptedEvents.length > 0
        ? acceptedEvents.reduce((s, e) => s + e.completionLength, 0) / acceptedEvents.length
        : 200;

    return {
      preferMultiline,
      suggestedDebounceMs,
      strongLanguages,
      weakLanguages,
      preferredModels,
      averageAcceptedLength,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _computeStats(events: CompletionEvent[]): CompletionStats {
    const total = events.length;
    const accepted = events.filter((e) => e.outcome === "accepted").length;
    const rejected = events.filter((e) => e.outcome === "rejected").length;
    const partial = events.filter((e) => e.outcome === "partial").length;
    const expired = events.filter((e) => e.outcome === "expired").length;

    const acceptRate = total > 0 ? accepted / total : 0;
    const averageLatencyMs = total > 0 ? events.reduce((s, e) => s + e.latencyMs, 0) / total : 0;
    const cacheHitRate = total > 0 ? events.filter((e) => e.cacheHit).length / total : 0;

    // By-language breakdown
    const byLanguage: Record<string, { shown: number; accepted: number; rate: number }> = {};
    for (const e of events) {
      const entry = byLanguage[e.language] ?? { shown: 0, accepted: 0, rate: 0 };
      entry.shown++;
      if (e.outcome === "accepted") entry.accepted++;
      byLanguage[e.language] = entry;
    }
    for (const lang of Object.keys(byLanguage)) {
      const entry = byLanguage[lang]!;
      entry.rate = entry.shown > 0 ? entry.accepted / entry.shown : 0;
    }

    // By-model breakdown
    const byModel: Record<string, { shown: number; accepted: number; rate: number }> = {};
    for (const e of events) {
      const entry = byModel[e.modelId] ?? { shown: 0, accepted: 0, rate: 0 };
      entry.shown++;
      if (e.outcome === "accepted") entry.accepted++;
      byModel[e.modelId] = entry;
    }
    for (const modelId of Object.keys(byModel)) {
      const entry = byModel[modelId]!;
      entry.rate = entry.shown > 0 ? entry.accepted / entry.shown : 0;
    }

    // Multiline vs single-line accept rates
    const multilineEvents = events.filter((e) => e.isMultiline);
    const singleLineEvents = events.filter((e) => !e.isMultiline);
    const multilineAccepted = multilineEvents.filter((e) => e.outcome === "accepted").length;
    const singleLineAccepted = singleLineEvents.filter((e) => e.outcome === "accepted").length;
    const multilineAcceptRate =
      multilineEvents.length > 0 ? multilineAccepted / multilineEvents.length : 0;
    const singleLineAcceptRate =
      singleLineEvents.length > 0 ? singleLineAccepted / singleLineEvents.length : 0;

    return {
      totalShown: total,
      accepted,
      rejected,
      partial,
      expired,
      acceptRate,
      averageLatencyMs,
      cacheHitRate,
      byLanguage,
      byModel,
      multilineAcceptRate,
      singleLineAcceptRate,
    };
  }
}
