// ============================================================================
// @dantecode/core — Grok Provider (xAI OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds a Grok language model provider using xAI's OpenAI-compatible endpoint.
 *
 * Resolves the API key from `config.apiKey` or the `GROK_API_KEY` environment
 * variable. Uses the `@ai-sdk/openai` package with `compatibility: "compatible"`
 * mode and the xAI base URL `https://api.x.ai/v1`.
 *
 * @param config - Model configuration specifying modelId and optional apiKey.
 * @returns A configured LanguageModelV1 instance for the specified Grok model.
 * @throws If no API key is available from config or environment.
 */
export function buildGrokProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["GROK_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Grok API key not found.\n" +
        "Set GROK_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://console.x.ai/",
    );
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
    compatibility: "compatible",
    headers: {
      "X-Client": "dantecode/1.0.0",
    },
  });

  return provider(config.modelId);
}
