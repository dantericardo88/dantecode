// ============================================================================
// @dantecode/core — Mistral AI Provider (OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds a Mistral AI language model provider using the OpenAI-compatible endpoint.
 *
 * Resolves the API key from `config.apiKey` or `MISTRAL_API_KEY`.
 * Supported models: mistral-large-latest, mistral-medium-latest, mistral-small-latest.
 *
 * @param config - Model configuration specifying modelId and optional apiKey.
 * @returns A configured LanguageModelV1 instance for the specified Mistral model.
 * @throws If no API key is available from config or environment.
 */
export function buildMistralProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["MISTRAL_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Mistral API key not found.\n" +
        "Set MISTRAL_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://console.mistral.ai/",
    );
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: config.baseUrl ?? "https://api.mistral.ai/v1",
    compatibility: "compatible",
    headers: {
      "X-Client": "dantecode/1.0.0",
    },
  });

  return provider(config.modelId);
}
