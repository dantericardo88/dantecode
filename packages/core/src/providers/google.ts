// ============================================================================
// @dantecode/core — Google Provider (Gemini OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Default Google Generative Language OpenAI-compatible endpoint.
 */
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

/**
 * Builds a Google Gemini language model provider using the OpenAI-compatible
 * endpoint provided by Google's Generative Language API.
 *
 * Resolves the API key from `config.apiKey` or the `GOOGLE_API_KEY`
 * environment variable. Uses `@ai-sdk/openai` in `compatible` mode.
 *
 * @param config - Model configuration specifying modelId and optional apiKey/baseUrl.
 * @returns A configured LanguageModelV1 instance for the specified Gemini model.
 * @throws If no API key is available from config or environment.
 */
export function buildGoogleProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Google API key not found.\n" +
        "Set GOOGLE_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://aistudio.google.com/apikey",
    );
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: config.baseUrl ?? DEFAULT_GOOGLE_BASE_URL,
    compatibility: "compatible",
  });

  return provider(config.modelId);
}
