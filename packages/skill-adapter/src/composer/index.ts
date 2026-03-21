// ============================================================================
// @dantecode/skill-adapter — Composer Public API
// ============================================================================

export { SkillChain, executeChain, resolveParams } from "./chain.js";
export type {
  ChainStep,
  ChainDefinition,
  StepExecutionResult,
  ChainExecutionResult,
} from "./chain.js";

export { evaluateGate, scorePassesThreshold, selectOnFail } from "./conditional.js";
export type { GateEvaluation, GateCondition } from "./conditional.js";
