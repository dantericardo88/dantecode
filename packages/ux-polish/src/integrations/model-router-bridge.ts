/**
 * model-router-bridge.ts — @dantecode/ux-polish
 *
 * G12 — Model-router weld.
 * Provides UX suggestion enrichment with optional model-routing context.
 * The model-router is OPTIONAL — all UX rendering works without it.
 */

import type { UXSuggestion, SuggestionContext } from "../types.js";

// ---------------------------------------------------------------------------
// Structural types (mirror model-router shape; no hard runtime import)
// ---------------------------------------------------------------------------

/** Minimal model capability hint — structurally compatible with ModelRouterImpl state. */
export interface RouterCapabilityHint {
  /** Active model ID (e.g. "claude-sonnet-4-6"). */
  modelId: string;
  /** Task type currently routed (e.g. "code", "summarize"). */
  taskType?: string;
  /** Cost tier of the active model. */
  costTier: "budget" | "balanced" | "quality";
  /** Whether the active model supports streaming. */
  supportsStreaming: boolean;
  /** Context window size in tokens (optional). */
  contextWindowTokens?: number;
}

/** Optional router state snapshot that callers can inject. */
export interface RouterStateSnapshot {
  activeModelId?: string;
  activeTaskType?: string;
  fallbacksRemaining?: number;
  lastCostEstimateUsd?: number;
}

/** An enriched suggestion that includes model context. */
export interface EnrichedSuggestion extends UXSuggestion {
  modelHint?: string;
}

// ---------------------------------------------------------------------------
// ModelRouterBridge
// ---------------------------------------------------------------------------

/**
 * Bridges the UX suggestion engine to optional model-router context.
 *
 * Usage:
 *   const bridge = new ModelRouterBridge();
 *   const hint = bridge.extractHint(routerSnapshot);
 *   const enriched = bridge.enrichSuggestions(suggestions, hint);
 */
export class ModelRouterBridge {
  /**
   * Extracts a capability hint from an optional router state snapshot.
   * Returns null if no router state is available — callers must handle null gracefully.
   */
  extractHint(state?: RouterStateSnapshot | null): RouterCapabilityHint | null {
    if (!state?.activeModelId) return null;
    const id = state.activeModelId.toLowerCase();
    const costTier = this._inferCostTier(id);
    return {
      modelId: state.activeModelId,
      taskType: state.activeTaskType,
      costTier,
      supportsStreaming: this._supportsStreaming(id),
    };
  }

  /**
   * Enriches UX suggestions with model context hints.
   * Suggestions are returned unchanged when hint is null.
   */
  enrichSuggestions(
    suggestions: UXSuggestion[],
    hint: RouterCapabilityHint | null,
  ): EnrichedSuggestion[] {
    if (!hint) return suggestions;
    return suggestions.map((s) => ({
      ...s,
      modelHint: this._buildModelNote(s, hint),
    }));
  }

  /**
   * Formats a one-line model capability note for display next to a suggestion.
   */
  formatModelHint(hint: RouterCapabilityHint): string {
    const tier = hint.costTier === "budget" ? "⚡ budget" : hint.costTier === "quality" ? "★ quality" : "◆ balanced";
    const stream = hint.supportsStreaming ? " · streaming" : "";
    return `[model: ${hint.modelId}${stream} · ${tier}]`;
  }

  /**
   * Returns model-aware suggestion context additions.
   * Callers can merge this into their SuggestionContext before calling getContextualSuggestions().
   */
  buildSuggestionContext(
    base: SuggestionContext,
    state?: RouterStateSnapshot | null,
  ): SuggestionContext {
    if (!state) return base;
    const additions: Partial<SuggestionContext> = {};
    // Inject active model as a recent-command-like signal
    if (state.activeModelId) {
      additions.recentCommands = [
        ...(base.recentCommands ?? []),
        `model:${state.activeModelId}`,
      ];
    }
    return { ...base, ...additions };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _inferCostTier(id: string): "budget" | "balanced" | "quality" {
    if (id.includes("haiku") || id.includes("groq") || id.includes("grok-fast") || id.includes("mini")) {
      return "budget";
    }
    if (id.includes("opus") || id.includes("gpt-4o") || id.includes("gemini-pro")) {
      return "quality";
    }
    return "balanced";
  }

  private _supportsStreaming(id: string): boolean {
    // All modern models support streaming; only legacy instruct variants don't
    return !id.includes("instruct") && !id.includes("legacy");
  }

  private _buildModelNote(s: UXSuggestion, hint: RouterCapabilityHint): string {
    if (s.priority === "high" && hint.costTier === "budget") {
      return `Note: active model (${hint.modelId}) is budget-tier — this action may benefit from a quality model.`;
    }
    if (hint.costTier === "quality") {
      return `Powered by ${hint.modelId} (quality tier).`;
    }
    return `Active model: ${hint.modelId}`;
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience
// ---------------------------------------------------------------------------

/** Singleton bridge instance (optional — callers may instantiate directly). */
let _bridge: ModelRouterBridge | null = null;

export function getModelRouterBridge(): ModelRouterBridge {
  _bridge ??= new ModelRouterBridge();
  return _bridge;
}

export function resetModelRouterBridge(): void {
  _bridge = null;
}
