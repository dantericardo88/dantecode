// ============================================================================
// @dantecode/core — DeepSeek Provider (OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds a DeepSeek language model provider using the OpenAI-compatible endpoint.
 *
 * Resolves the API key from `config.apiKey` or `DEEPSEEK_API_KEY`.
 * Supported models: deepseek-chat, deepseek-reasoner.
 *
 * @param config - Model configuration specifying modelId and optional apiKey.
 * @returns A configured LanguageModelV1 instance for the specified DeepSeek model.
 * @throws If no API key is available from config or environment.
 */
export function buildDeepSeekProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["DEEPSEEK_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "DeepSeek API key not found.\n" +
        "Set DEEPSEEK_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://platform.deepseek.com/",
    );
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: config.baseUrl ?? "https://api.deepseek.com/v1",
    compatibility: "compatible",
    headers: {
      "X-Client": "dantecode/1.0.0",
    },
  });

  return provider(config.modelId);
}
