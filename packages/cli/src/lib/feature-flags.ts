// ============================================================================
// @dantecode/cli — Feature Maturity Labels
// Canonical registry of DanteCode features with maturity classifications.
// Used by /status, help text, and documentation generation.
// ============================================================================

/** Maturity level for a feature flag. */
export type MaturityLevel = "experimental" | "beta" | "stable" | "deprecated";

/** A single feature with its maturity classification. */
export interface FeatureFlag {
  /** Unique machine-readable identifier. */
  name: string;
  /** Short human-readable description. */
  description: string;
  /** Current maturity classification. */
  maturity: MaturityLevel;
  /**
   * When true, the feature is disabled by default and requires explicit
   * opt-in via config or environment variable.
   */
  requiresOptIn?: boolean;
}

/**
 * Canonical list of DanteCode features with maturity labels.
 *
 * Stable    — production-ready, fully tested, supported
 * Beta      — functional but may have rough edges; API may change
 * Experimental — early prototype, requires opt-in, may be removed
 * Deprecated   — scheduled for removal; use the replacement instead
 */
export const FEATURE_FLAGS: FeatureFlag[] = [
  // ------------------------------------------------------------------
  // Stable features
  // ------------------------------------------------------------------
  {
    name: "web-search",
    description: "Multi-provider web search with RRF ranking and semantic cache",
    maturity: "stable",
  },
  {
    name: "council",
    description: "Multi-agent Council orchestration with Git worktree isolation",
    maturity: "stable",
  },
  {
    name: "gaslight",
    description: "Bounded adversarial refinement via critique-gate loops",
    maturity: "stable",
  },
  {
    name: "skillbook",
    description: "ACE skill reflection loop — learn from every session",
    maturity: "stable",
  },
  {
    name: "fearset",
    description: "Fear-setting risk analysis with sandbox simulation",
    maturity: "stable",
  },
  {
    name: "debug-trail",
    description: "Persistent tamper-evident audit trail with SQLite backend",
    maturity: "stable",
  },

  // ------------------------------------------------------------------
  // Beta features
  // ------------------------------------------------------------------
  {
    name: "dante-sandbox",
    description: "OS-native execution sandbox (Docker + worktree isolation layers)",
    maturity: "beta",
  },
  {
    name: "evidence-chain",
    description: "Cryptographic evidence primitives for verification traces",
    maturity: "beta",
  },
  {
    name: "memory-engine",
    description: "Semantic persistent memory with 5-organ architecture",
    maturity: "beta",
  },
  {
    name: "dante-fleet",
    description: "Parallel agent execution via background runner",
    maturity: "beta",
  },

  // ------------------------------------------------------------------
  // Experimental features (require explicit opt-in)
  // ------------------------------------------------------------------
  {
    name: "http-server",
    description: "HTTP API server mode for programmatic access",
    maturity: "experimental",
    requiresOptIn: true,
  },
  {
    name: "inline-completions",
    description: "Ghost text inline completions for supported editors",
    maturity: "experimental",
    requiresOptIn: true,
  },
  {
    name: "tui",
    description: "Ink-based terminal UI (replaces readline REPL)",
    maturity: "experimental",
    requiresOptIn: true,
  },
];

/**
 * Returns the feature flag for a given name, or undefined if not found.
 */
export function getFeatureFlag(name: string): FeatureFlag | undefined {
  return FEATURE_FLAGS.find((f) => f.name === name);
}

/**
 * Returns all features at a given maturity level.
 */
export function getFeaturesByMaturity(maturity: MaturityLevel): FeatureFlag[] {
  return FEATURE_FLAGS.filter((f) => f.maturity === maturity);
}

/**
 * Returns a short human-readable badge string for a maturity level.
 *
 * Plain ASCII — no emoji — so output renders cleanly in all terminals
 * and in CI log viewers.
 */
export function formatMaturityBadge(maturity: MaturityLevel): string {
  switch (maturity) {
    case "stable":
      return "[stable]";
    case "beta":
      return "[beta]";
    case "experimental":
      return "[experimental]";
    case "deprecated":
      return "[deprecated]";
  }
}
