// ============================================================================
// @dantecode/danteforge — Package Entry Point
// Re-exports all DanteForge subsystems: anti-stub scanner, PDSE scorer,
// GStack runner, lessons system, autoforge IAL, and constitution checker.
// ============================================================================

// --- Anti-Stub Scanner ---
export {
  runAntiStubScanner,
  scanFile,
  HARD_VIOLATION_PATTERNS,
  SOFT_VIOLATION_PATTERNS,
} from "./anti-stub-scanner.js";
export type { StubPattern, AntiStubScanResult } from "./anti-stub-scanner.js";

// --- PDSE Scorer ---
export { runPDSEScorer, runLocalPDSEScorer } from "./pdse-scorer.js";
export type { ModelRouter } from "./pdse-scorer.js";

// --- GStack Runner ---
export { runGStack, runGStackSingle, allGStackPassed, summarizeGStackResults } from "./gstack.js";

// --- Lessons System ---
export {
  initLessonsDB,
  recordLesson,
  queryLessons,
  getLessonCount,
  deleteLesson,
  clearLessons,
  formatLessonsForPrompt,
} from "./lessons.js";

// --- Autoforge IAL ---
export {
  runAutoforgeIAL,
  buildFailureContext,
  generateProgressBar,
  formatBladeProgressLine,
} from "./autoforge.js";
export type { AutoforgeResult, AutoforgeContext } from "./autoforge.js";

// --- Blade v1.2 Progress Emitter ---
export { BladeProgressEmitter } from "./blade-progress.js";

// --- Constitution Checker ---
export {
  runConstitutionCheck,
  CREDENTIAL_PATTERNS,
  BACKGROUND_PROCESS_PATTERNS,
  DANGEROUS_OPERATION_PATTERNS,
  CONSTITUTION_PATTERNS,
} from "./constitution.js";
export type {
  ConstitutionViolationType,
  ConstitutionSeverity,
  ConstitutionViolation,
  ConstitutionCheckResult,
} from "./constitution.js";
