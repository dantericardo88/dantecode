// ============================================================================
// @dantecode/core — Perplexity Provider (OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds a Perplexity language model provider using the OpenAI-compatible endpoint.
 *
 * Resolves the API key from `config.apiKey` or `PERPLEXITY_API_KEY`.
 * Supported models: llama-3.1-sonar-large-128k-online, llama-3.1-sonar-small-128k-online,
 * llama-3.1-sonar-huge-128k-online.
 *
 * @param config - Model configuration specifying modelId and optional apiKey.
 * @returns A configured LanguageModelV1 instance for the specified Perplexity model.
 * @throws If no API key is available from config or environment.
 */
export function buildPerplexityProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["PERPLEXITY_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Perplexity API key not found.\n" +
        "Set PERPLEXITY_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://www.perplexity.ai/settings/api",
    );
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: config.baseUrl ?? "https://api.perplexity.ai",
    compatibility: "compatible",
    headers: {
      "X-Client": "dantecode/1.0.0",
    },
  });

  return provider(config.modelId);
}
