// ============================================================================
// @dantecode/core — Groq Provider (OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds a Groq language model provider using the OpenAI-compatible API.
 *
 * Resolves the API key from `config.apiKey` or the `GROQ_API_KEY`
 * environment variable. Uses `@ai-sdk/openai` in `compatible` mode
 * with the Groq API base URL.
 *
 * @param config - Model configuration specifying modelId and optional apiKey/baseUrl.
 * @returns A configured LanguageModelV1 instance for the specified Groq model.
 * @throws If no API key is available from config or environment.
 */
export function buildGroqProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["GROQ_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Groq API key not found.\n" +
        "Set GROQ_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://console.groq.com/keys",
    );
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: config.baseUrl ?? "https://api.groq.com/openai/v1",
    compatibility: "compatible",
  });

  return provider(config.modelId);
}
