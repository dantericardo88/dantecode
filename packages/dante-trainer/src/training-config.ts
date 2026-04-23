// ============================================================================
// packages/dante-trainer/src/training-config.ts
//
// Typed training configuration schema and validator for Unsloth LoRA fine-tuning.
// ============================================================================

/** Valid LoRA rank values */
export const VALID_LORA_RANKS = [8, 16, 32, 64, 128] as const;
export type LoraRank = (typeof VALID_LORA_RANKS)[number];

/** Supported base models */
export const SUPPORTED_MODELS = [
  "unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit",
  "unsloth/Qwen2.5-Coder-3B-Instruct-bnb-4bit",
  "unsloth/Qwen2.5-Coder-1.5B-Instruct-bnb-4bit",
  "unsloth/DeepSeek-Coder-V2-Lite-Instruct-bnb-4bit",
  "unsloth/starcoder2-7b-bnb-4bit",
] as const;

/** Complete training configuration */
export interface TrainingConfig {
  // Model
  modelName: string;
  maxSeqLength: number;
  loadIn4bit: boolean;

  // LoRA
  loraRank: LoraRank;
  loraAlpha: number;
  loraDropout: number;
  targetModules: string[];

  // Data
  dataPath: string;
  outputPath: string;
  validationSplit: number;   // 0.0–1.0, fraction held out for validation

  // Training
  numEpochs: number;
  batchSize: number;
  gradientAccumulationSteps: number;
  learningRate: number;
  warmupRatio: number;
  lrScheduler: "cosine" | "linear" | "constant";
  seed: number;
}

/** Validation errors */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Default production configuration for next-edit fine-tuning */
export const DEFAULT_NEXT_EDIT_CONFIG: TrainingConfig = {
  modelName: "unsloth/Qwen2.5-Coder-7B-Instruct-bnb-4bit",
  maxSeqLength: 2048,
  loadIn4bit: true,

  loraRank: 64,
  loraAlpha: 64,
  loraDropout: 0,
  targetModules: ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],

  dataPath: "./data/train.jsonl",
  outputPath: "./dante-next-edit-v1",
  validationSplit: 0.1,

  numEpochs: 2,
  batchSize: 4,
  gradientAccumulationSteps: 4,
  learningRate: 2e-4,
  warmupRatio: 0.1,
  lrScheduler: "cosine",
  seed: 42,
};

/** Validate a training configuration */
export function validateTrainingConfig(config: TrainingConfig): ValidationResult {
  const errors: string[] = [];

  if (!config.modelName || config.modelName.trim() === "") {
    errors.push("modelName is required");
  }
  if (!config.dataPath || config.dataPath.trim() === "") {
    errors.push("dataPath is required");
  }
  if (!config.outputPath || config.outputPath.trim() === "") {
    errors.push("outputPath is required");
  }
  if (!(VALID_LORA_RANKS as readonly number[]).includes(config.loraRank)) {
    errors.push(`loraRank must be one of ${VALID_LORA_RANKS.join(", ")}, got ${config.loraRank}`);
  }
  if (config.learningRate > 1e-2) {
    errors.push(`learningRate ${config.learningRate} is dangerously high (must be ≤ 1e-2)`);
  }
  if (config.learningRate <= 0) {
    errors.push("learningRate must be positive");
  }
  if (config.validationSplit < 0 || config.validationSplit >= 1) {
    errors.push("validationSplit must be in [0.0, 1.0)");
  }
  if (config.numEpochs < 1) {
    errors.push("numEpochs must be at least 1");
  }
  if (config.batchSize < 1) {
    errors.push("batchSize must be at least 1");
  }

  return { valid: errors.length === 0, errors };
}

/** Serialize config to JSON for logging */
export function serializeConfig(config: TrainingConfig): string {
  return JSON.stringify(config, null, 2);
}
