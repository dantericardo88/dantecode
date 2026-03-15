// ============================================================================
// @dantecode/core — Provider Registry & Re-exports
// ============================================================================

import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

export { buildGrokProvider } from "./grok.js";
export { buildAnthropicProvider } from "./anthropic.js";
export { buildOpenAIProvider } from "./openai.js";
export { buildOllamaProvider } from "./ollama.js";

import { buildGrokProvider } from "./grok.js";
import { buildAnthropicProvider } from "./anthropic.js";
import { buildOpenAIProvider } from "./openai.js";
import { buildOllamaProvider } from "./ollama.js";

/**
 * Function signature for a provider builder: takes a ModelConfig
 * and returns a LanguageModelV1 instance.
 */
export type ProviderBuilder = (config: ModelConfig) => LanguageModelV1;

/**
 * Registry mapping provider name strings to their corresponding builder
 * functions. Used by the ModelRouter to dynamically resolve providers at
 * runtime based on configuration.
 */
export const PROVIDER_BUILDERS: Record<string, ProviderBuilder> = {
  grok: buildGrokProvider,
  anthropic: buildAnthropicProvider,
  openai: buildOpenAIProvider,
  ollama: buildOllamaProvider,
};
