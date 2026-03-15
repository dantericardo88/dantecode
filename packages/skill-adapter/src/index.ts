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
export { importSkills } from "./importer.js";
export type { ImportOptions, ImportResult, SkippedSkill } from "./importer.js";

// --- Skill Registry ---
export { loadSkillRegistry, getSkill, listSkills, removeSkill, validateSkill } from "./registry.js";
export type { SkillRegistryEntry, SkillValidationResult } from "./registry.js";
