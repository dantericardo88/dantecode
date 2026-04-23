// ============================================================================
// packages/dante-trainer/src/index.ts
// Public API for @dantecode/dante-trainer
// ============================================================================

export {
  validateTrainingConfig,
  serializeConfig,
  DEFAULT_NEXT_EDIT_CONFIG,
  VALID_LORA_RANKS,
  SUPPORTED_MODELS,
  type TrainingConfig,
  type ValidationResult,
  type LoraRank,
} from "./training-config.js";

export {
  computeMetrics,
  evaluateNextEditModel,
  levenshteinSimilarity,
  type NextEditPrediction,
  type NextEditGroundTruth,
  type NextEditEvalResult,
  type HoldoutRecord,
} from "./eval-metrics.js";

export {
  parseModelOutput,
  meetsConfidenceThreshold,
  type ParsedNextEdit,
} from "./model-output-parser.js";
