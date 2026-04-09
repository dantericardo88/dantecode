// ============================================================================
// @dantecode/core — Provider Registry & Re-exports
// ============================================================================

import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

export { buildGrokProvider, GROK_CAPABILITIES } from "./grok.js";
export { normalizeGrokToolCall, repairMalformedJson, type GrokModelCapabilities } from "./grok-normalizer.js";
export { buildAnthropicProvider } from "./anthropic.js";
export { buildOpenAIProvider } from "./openai.js";
export { buildOllamaProvider } from "./ollama.js";
export { buildGoogleProvider } from "./google.js";
export { buildGroqProvider } from "./groq.js";
export { buildMistralProvider } from "./mistral.js";
export { buildDeepSeekProvider } from "./deepseek.js";
export { buildTogetherProvider } from "./together.js";
export { buildPerplexityProvider } from "./perplexity.js";
export { buildOpenRouterProvider, OPENROUTER_MODELS, type OpenRouterModelId } from "./openrouter.js";

import { buildGrokProvider } from "./grok.js";
import { buildAnthropicProvider } from "./anthropic.js";
import { buildOpenAIProvider } from "./openai.js";
import { buildOllamaProvider } from "./ollama.js";
import { buildGoogleProvider } from "./google.js";
import { buildGroqProvider } from "./groq.js";
import { buildMistralProvider } from "./mistral.js";
import { buildDeepSeekProvider } from "./deepseek.js";
import { buildTogetherProvider } from "./together.js";
import { buildPerplexityProvider } from "./perplexity.js";
import { buildOpenRouterProvider } from "./openrouter.js";

/**
 * Function signature for a provider builder: takes a ModelConfig
 * and returns a LanguageModelV1 instance.
 */
export type ProviderBuilder = (config: ModelConfig) => LanguageModelV1;

/**
 * Builds a custom provider using the OpenAI-compatible API with a
 * user-specified base URL. Requires `config.baseUrl` to be set.
 */
function buildCustomProvider(config: ModelConfig): LanguageModelV1 {
  if (!config.baseUrl) {
    throw new Error(
      "Custom provider requires a baseUrl.\n" +
        "Configure it in .dantecode/STATE.yaml under model.default.baseUrl",
    );
  }
  // Delegate to buildOpenAIProvider which already supports custom baseUrl
  return buildOpenAIProvider(config);
}

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
  google: buildGoogleProvider,
  groq: buildGroqProvider,
  mistral: buildMistralProvider,
  deepseek: buildDeepSeekProvider,
  together: buildTogetherProvider,
  perplexity: buildPerplexityProvider,
  openrouter: buildOpenRouterProvider,
  custom: buildCustomProvider,
};
