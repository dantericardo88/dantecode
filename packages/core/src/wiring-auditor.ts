// ============================================================================
// @dantecode/core — Wiring Auditor
// Tracks which features are wired into production hot paths.
// Used by verification/CI to ensure new capabilities are actually connected.
// ============================================================================

/**
 * A feature wiring entry: the function or class that implements it.
 */
export interface FeatureWiringEntry {
  /** Primary export name (class or function). */
  fn: string;
  /** Optional description of where it is wired. */
  wiredIn?: string;
}

/**
 * Map of feature keys to their wiring entries.
 * This is the canonical registry of features that MUST be wired into
 * at least one hot-path file to be considered "connected".
 */
export const FEATURE_WIRING_MAP: Record<string, FeatureWiringEntry> = {
  // --- Streaming & Recovery ---
  "stream-recovery": { fn: "StreamRecovery", wiredIn: "agent-loop.ts + inline-completion.ts" },

  // --- Memory ---
  "memory-consolidation": { fn: "MemoryConsolidator", wiredIn: "session-manager.ts" },
  "cross-session-memory": { fn: "PersistentMemory", wiredIn: "repl.ts" },

  // --- Quality & Observability ---
  "pdse-trend-tracking": { fn: "VerificationTrendTracker", wiredIn: "inline-completion.ts + slash-commands.ts /health" },
  "acceptance-tracking": { fn: "getAcceptanceRate", wiredIn: "inline-completion.ts" },

  // --- Protocol & Integration ---
  "acp-server": { fn: "startACPServer", wiredIn: "cli/index.ts" },

  // --- Core Infrastructure ---
  "circuit-breaker": { fn: "CircuitBreaker" },
  "loop-detector": { fn: "LoopDetector" },
  "recovery-engine": { fn: "RecoveryEngine" },
  "session-store": { fn: "SessionStore" },
  "checkpointer": { fn: "EventSourcedCheckpointer" },
  "approach-memory": { fn: "ApproachMemory" },
  "model-router": { fn: "ModelRouterImpl" },
  "skill-wave-orchestrator": { fn: "buildWavePrompt" },
  "error-parser": { fn: "parseVerificationErrors" },
  "health-check": { fn: "runStartupHealthCheck" },
};

/**
 * Hot-path files that are expected to import wired features.
 * Used by the wiring auditor to verify that features are connected.
 */
export const HOT_PATH_FILES: string[] = [
  "packages/cli/src/agent-loop.ts",
  "packages/cli/src/repl.ts",
  "packages/cli/src/tools.ts",
  "packages/cli/src/slash-commands.ts",
  "packages/vscode/src/sidebar-provider.ts",
  "packages/vscode/src/inline-completion.ts",
];

/**
 * Returns the list of features registered in the wiring map.
 */
export function getRegisteredFeatures(): string[] {
  return Object.keys(FEATURE_WIRING_MAP);
}

/**
 * Checks whether a given feature key is registered.
 */
export function isFeatureRegistered(feature: string): boolean {
  return feature in FEATURE_WIRING_MAP;
}

/**
 * Returns the wiring entry for a feature, or undefined if not registered.
 */
export function getFeatureWiring(feature: string): FeatureWiringEntry | undefined {
  return FEATURE_WIRING_MAP[feature];
}
