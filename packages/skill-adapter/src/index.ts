// ============================================================================
// @dantecode/skill-adapter — Package Entry Point
// Re-exports all skill-adapter subsystems: parsers (Claude, Continue.dev,
// OpenCode), DanteForge adapter wrapping, import orchestrator, and
// skill registry.
// ============================================================================

// --- Parsers ---
export {
  scanClaudeSkills,
  parseClaudeSkill,
  scanContinueAgents,
  parseContinueAgent,
  scanOpencodeAgents,
  parseOpencodeAgent,
} from "./parsers/index.js";
export type {
  ScannedSkill,
  ParsedClaudeSkill,
  ScannedContinueAgent,
  ParsedContinueAgent,
  ScannedOpencodeAgent,
  ParsedOpencodeAgent,
} from "./parsers/index.js";

// --- Adapter Wrapping ---
export { wrapSkillWithAdapter, ADAPTER_VERSION } from "./wrap.js";
export type { ParsedSkill, ImportSource } from "./wrap.js";

// --- Import Orchestrator ---
export { importSkills, loadChecks } from "./importer.js";
export type { ImportOptions, ImportResult, SkippedSkill } from "./importer.js";

// --- Skill Registry ---
export { loadSkillRegistry, getSkill, listSkills, removeSkill, validateSkill } from "./registry.js";
export type { SkillRegistryEntry, SkillValidationResult } from "./registry.js";

// --- SkillBridge Types ---
export type {
  SkillBridgeManifest,
  SkillBridgeSource,
  SkillBridgeEmitters,
  SkillBridgeVerification,
  SkillBridgeTarget,
  SkillBridgeParseResult,
  SkillClassification,
  SkillRiskLevel,
  EmitterStatus,
  EmitterResult,
  CapabilityProfile,
  NormalizedSkill,
  BridgeBundleMetadata,
  BundleBucket,
} from "./types/skillbridge.js";

// --- SkillBridge Parser ---
export {
  parseSkillBridgeManifest,
  bundleHasDanteCodeTarget,
  getDanteCodeTargetPath,
} from "./parsers/skillbridge.js";

// --- SkillBridge Import Bridge ---
export {
  importSkillBridgeBundle,
  listBridgeWarnings,
  validateBridgeSkill,
} from "./import-bridge.js";
export type { ImportBridgeOptions, ImportBridgeResult } from "./import-bridge.js";
