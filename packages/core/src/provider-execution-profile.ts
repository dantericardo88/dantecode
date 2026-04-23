import type { ModelConfig, ReasoningEffort } from "@dantecode/config-types";

type ProviderOptionValue =
  | string
  | number
  | boolean
  | null
  | ProviderOptionValue[]
  | { [key: string]: ProviderOptionValue };

export type ProviderOptions = Record<string, { [key: string]: ProviderOptionValue }>;

export interface ProviderExecutionProfile {
  temperature: number;
  topP?: number;
  topK?: number;
  reasoningBudget?: number;
  providerOptions?: ProviderOptions;
}

function defaultReasoningEffort(config: ModelConfig): ReasoningEffort {
  if (config.reasoningEffort) {
    return config.reasoningEffort;
  }
  if (config.provider === "grok" && /reasoning/i.test(config.modelId)) {
    return "medium";
  }
  return "medium";
}

function defaultThinkingBudget(reasoningEffort: ReasoningEffort): number {
  switch (reasoningEffort) {
    case "low":
      return 2_048;
    case "high":
      return 8_192;
    case "max":
      return 16_384;
    default:
      return 4_096;
  }
}

export function inferReasoningCapability(config: ModelConfig): boolean {
  if (typeof config.supportsExtendedThinking === "boolean") {
    return config.supportsExtendedThinking;
  }

  return (
    config.provider === "anthropic" ||
    /reasoning|think|o1|o3|r1/i.test(config.modelId)
  );
}

function defaultTopP(config: ModelConfig): number | undefined {
  if (config.topP !== undefined) {
    return config.topP;
  }

  switch (config.provider) {
    case "grok":
      return 0.9;
    case "anthropic":
      return 0.95;
    case "openai":
    case "google":
      return 1;
    default:
      return undefined;
  }
}

function defaultTopK(config: ModelConfig): number | undefined {
  if (config.topK !== undefined) {
    return config.topK;
  }
  return config.provider === "google" ? 32 : undefined;
}

function buildProviderOptions(
  config: ModelConfig,
  reasoningEffort: ReasoningEffort,
  thinkingBudget?: number,
): ProviderOptions | undefined {
  if (thinkingBudget === undefined) {
    return undefined;
  }

  switch (config.provider) {
    case "anthropic":
      return {
        anthropic: {
          thinking: {
            type: "enabled",
            budgetTokens: thinkingBudget,
          },
          reasoningEffort,
        },
      };
    case "openai":
      return {
        openai: {
          reasoningEffort,
          thinkingBudget,
        },
      };
    case "google":
      return {
        google: {
          reasoningEffort,
          thinkingConfig: {
            thinkingBudget,
          },
        },
      };
    default:
      return {
        [config.provider]: {
          reasoningEffort,
          thinkingBudget,
        },
      };
  }
}

export function getProviderExecutionProfile(
  config: ModelConfig,
  options: { thinkingBudget?: number } = {},
): ProviderExecutionProfile {
  const reasoningEffort = defaultReasoningEffort(config);
  const reasoningCapable = inferReasoningCapability(config);
  const reasoningBudget = reasoningCapable
    ? options.thinkingBudget ?? config.thinkingBudget ?? defaultThinkingBudget(reasoningEffort)
    : undefined;

  return {
    temperature: config.temperature,
    topP: defaultTopP(config),
    topK: defaultTopK(config),
    reasoningBudget,
    providerOptions: buildProviderOptions(config, reasoningEffort, reasoningBudget),
  };
}
