// ============================================================================
// @dantecode/core — Together AI Provider (OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds a Together AI language model provider using the OpenAI-compatible endpoint.
 *
 * Resolves the API key from `config.apiKey` or `TOGETHER_API_KEY`.
 * Supported models include: meta-llama/Llama-3.3-70B-Instruct-Turbo,
 * mistralai/Mixtral-8x7B-Instruct-v0.1, Qwen/Qwen2.5-72B-Instruct-Turbo.
 *
 * @param config - Model configuration specifying modelId and optional apiKey.
 * @returns A configured LanguageModelV1 instance for the specified Together AI model.
 * @throws If no API key is available from config or environment.
 */
export function buildTogetherProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["TOGETHER_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Together AI API key not found.\n" +
        "Set TOGETHER_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://api.together.xyz/",
    );
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: config.baseUrl ?? "https://api.together.xyz/v1",
    compatibility: "compatible",
    headers: {
      "X-Client": "dantecode/1.0.0",
    },
  });

  return provider(config.modelId);
}
