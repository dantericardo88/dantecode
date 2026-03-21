// ============================================================================
// @dantecode/skill-adapter — SkillBridge Types
// Canonical type definitions for the SkillBridge interoperability pipeline.
// DanteForge compiles skills into SkillBridge bundles; DanteCode imports them.
// ============================================================================

// ----------------------------------------------------------------------------
// Source Metadata
// ----------------------------------------------------------------------------

/** How the source was acquired. */
export type SkillSourceKind = "local-file" | "local-dir" | "github-repo" | "github-tree";

/** Provenance record for the original skill source. */
export interface SkillBridgeSource {
  kind: SkillSourceKind;
  url: string;
  repo: string;
  commit: string;
  path: string;
  license: string;
}

// ----------------------------------------------------------------------------
// Capability Profile
// ----------------------------------------------------------------------------

/** Classes of skills by capability complexity. */
export type SkillClassification =
  | "instruction-only"
  | "script-assisted"
  | "tool-bound"
  | "review-required";

/** Risk level assigned during capability profiling. */
export type SkillRiskLevel = "low" | "medium" | "high";

/** Valid emitter targets. */
export type SkillBridgeTarget = "dantecode" | "qwen-skill" | "mcp" | "cli-wrapper";

/**
 * Capability profile produced by the DanteForge capability profiler.
 * Classifies what the skill requires and which targets are safe to emit.
 */
export interface CapabilityProfile {
  filesystem: boolean;
  network: boolean;
  shell: boolean;
  browser: boolean;
  mcp: boolean;
  scriptsPresent: boolean;
  templatesPresent: boolean;
  llmRepairNeeded: boolean;
  targetRecommendations: SkillBridgeTarget[];
  riskLevel: SkillRiskLevel;
  classification: SkillClassification;
}

// ----------------------------------------------------------------------------
// Normalized Skill
// ----------------------------------------------------------------------------

/** The normalized, canonical internal representation of a skill. */
export interface NormalizedSkill {
  name: string;
  slug: string;
  description: string;
  instructions: string;
  supportFiles: string[];
  frontmatter: Record<string, unknown>;
  capabilities: {
    filesystem: boolean;
    network: boolean;
    shell: boolean;
    mcp: boolean;
    browser: boolean;
    llmRepairNeeded: boolean;
  };
  classification: SkillClassification;
}

// ----------------------------------------------------------------------------
// Emitter Results
// ----------------------------------------------------------------------------

/** Status of a single emitter target. */
export type EmitterStatus = "success" | "warning" | "skipped" | "blocked";

/** Result record for a single emitter. */
export interface EmitterResult {
  status: EmitterStatus;
  warnings?: string[];
  error?: string;
}

/** Combined emitter results for all targets. */
export interface SkillBridgeEmitters {
  dantecode: EmitterResult;
  qwenSkill: EmitterResult;
  mcp: EmitterResult;
  cliWrapper: EmitterResult;
}

// ----------------------------------------------------------------------------
// Verification
// ----------------------------------------------------------------------------

/** Verification results and conversion scoring. */
export interface SkillBridgeVerification {
  parsePassed: boolean;
  constitutionPassed: boolean;
  antiStubPassed: boolean;
  conversionScore: number;
}

// ----------------------------------------------------------------------------
// Canonical Manifest (skillbridge.json)
// ----------------------------------------------------------------------------

/** The top-level canonical manifest for a SkillBridge bundle. */
export interface SkillBridgeManifest {
  version: string;
  source: SkillBridgeSource;
  normalizedSkill: NormalizedSkill;
  emitters: SkillBridgeEmitters;
  verification: SkillBridgeVerification;
  warnings: string[];
}

// ----------------------------------------------------------------------------
// DanteCode Bundle Runtime Types
// ----------------------------------------------------------------------------

/**
 * Outcome bucket after verification.
 * green = auto-install allowed, amber = install with warnings, red = blocked
 */
export type BundleBucket = "green" | "amber" | "red";

/** Metadata stored alongside an imported bridge bundle in DanteCode. */
export interface BridgeBundleMetadata {
  slug: string;
  name: string;
  description: string;
  bundleDir: string;
  conversionScore: number;
  bucket: BundleBucket;
  runtimeWarnings: string[];
  conversionWarnings: string[];
  importedAt: string;
  classification: SkillClassification;
  emitterStatuses: Partial<Record<SkillBridgeTarget, EmitterStatus>>;
}

// ----------------------------------------------------------------------------
// Parse Result
// ----------------------------------------------------------------------------

export type SkillBridgeParseResult =
  | { ok: true; manifest: SkillBridgeManifest }
  | { ok: false; errors: string[] };

// ----------------------------------------------------------------------------
// Risk Level Utility
// ----------------------------------------------------------------------------

/**
 * Maps a SkillClassification to its corresponding SkillRiskLevel.
 *
 * Classification → Risk mapping:
 *   "instruction-only" → "low"      (pure text, no side effects)
 *   "script-assisted"  → "medium"   (has scripts but no direct tool binding)
 *   "tool-bound"       → "medium"   (uses tools but no review required)
 *   "review-required"  → "high"     (flagged for manual review)
 */
export function getRiskLevel(classification: SkillClassification): SkillRiskLevel {
  switch (classification) {
    case "instruction-only":
      return "low";
    case "script-assisted":
      return "medium";
    case "tool-bound":
      return "medium";
    case "review-required":
      return "high";
  }
}
