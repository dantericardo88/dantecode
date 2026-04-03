// ============================================================================
// @dantecode/core — OpenAI Provider
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds an OpenAI language model provider using the official `@ai-sdk/openai`
 * package.
 *
 * Resolves the API key from `config.apiKey` or the `OPENAI_API_KEY` environment
 * variable. If `config.baseUrl` is provided, it will be used as a custom base
 * URL for OpenAI-compatible services.
 *
 * @param config - Model configuration specifying modelId and optional apiKey/baseUrl.
 * @returns A configured LanguageModelV1 instance for the specified OpenAI model.
 * @throws If no API key is available from config or environment.
 */
export function buildOpenAIProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["OPENAI_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "OpenAI API key not found.\n" +
        "Set OPENAI_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://platform.openai.com/api-keys",
    );
  }

  const provider = createOpenAI({
    apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  });

  return provider(config.modelId);
}
