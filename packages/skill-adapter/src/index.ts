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
export { loadSkillRegistry, getSkill, getSkillWithBridgeMeta, listSkills, removeSkill, validateSkill } from "./registry.js";
export type { SkillRegistryEntry, SkillValidationResult, SkillDefinitionWithMeta } from "./registry.js";

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
export { getRiskLevel } from "./types/skillbridge.js";

// --- SkillBridge Parser ---
export {
  parseSkillBridgeManifest,
  bundleHasDanteCodeTarget,
  getDanteCodeTargetPath,
  sanitizeSlug,
} from "./parsers/skillbridge.js";

// --- SkillBridge Import Bridge ---
export {
  importSkillBridgeBundle,
  listBridgeWarnings,
  validateBridgeSkill,
  checkBridgeManifestIntegrity,
} from "./import-bridge.js";
export type { ImportBridgeOptions, ImportBridgeResult } from "./import-bridge.js";

// --- Universal Parser + Format Detection ---
export {
  detectSkillSources,
  parseUniversalSkill,
  universalToWrappable,
} from "./parsers/universal-parser.js";
export type {
  SkillSourceFormat,
  DetectionResult,
  UniversalParsedSkill,
} from "./parsers/universal-parser.js";

// --- New Parsers ---
export { scanCodexSkills, parseCodexSkill } from "./parsers/codex-parser.js";
export type { ScannedCodexSkill, ParsedCodexSkill } from "./parsers/codex-parser.js";

export { scanCursorRules, parseCursorRule } from "./parsers/cursor-parser.js";
export type { ScannedCursorRule, ParsedCursorRule } from "./parsers/cursor-parser.js";

export { scanQwenSkills, parseQwenSkill } from "./parsers/qwen-parser.js";
export type { ScannedQwenSkill, ParsedQwenSkill } from "./parsers/qwen-parser.js";

// --- Skill Verifier ---
export { verifySkill, tierMeetsMinimum } from "./verifier/skill-verifier.js";
export type {
  SkillFinding,
  ScriptSafetyResult,
  SkillVerificationResult,
  VerifyOptions,
} from "./verifier/skill-verifier.js";

// --- Marketplace ---
export {
  SkillCatalog,
  installSkill,
  bundleSkill,
  exportSkillToDirectory,
} from "./marketplace/index.js";
export type {
  CatalogEntry,
  InstallOptions,
  InstallResult,
  BundleOptions,
  BundleResult,
} from "./marketplace/index.js";

// --- Composer ---
export {
  SkillChain,
  executeChain,
  resolveParams,
  evaluateGate,
  scorePassesThreshold,
  selectOnFail,
} from "./composer/index.js";
export type {
  ChainStep,
  ChainDefinition,
  StepExecutionResult,
  ChainExecutionResult,
  StepCallbackResult,
  ExecutionContext,
  GateEvaluation,
  GateCondition,
} from "./composer/index.js";
