// ============================================================================
// @dantecode/core — Ollama Provider (local OpenAI-compatible API)
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Default Ollama API base URL when no override is specified.
 */
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Builds an Ollama language model provider using the OpenAI-compatible API
 * exposed by Ollama's local server.
 *
 * Resolves the base URL from `config.baseUrl`, the `OLLAMA_BASE_URL` environment
 * variable, or falls back to `http://localhost:11434/v1`.
 *
 * Ollama runs locally and does not require an API key. A dummy key value of
 * "ollama" is provided to satisfy the OpenAI SDK's requirement.
 *
 * @param config - Model configuration specifying modelId and optional baseUrl.
 * @returns A configured LanguageModelV1 instance for the specified Ollama model.
 */
export function buildOllamaProvider(config: ModelConfig): LanguageModelV1 {
  const baseURL =
    config.baseUrl ??
    process.env["OLLAMA_BASE_URL"] ??
    DEFAULT_OLLAMA_BASE_URL;

  const provider = createOpenAI({
    apiKey: "ollama",
    baseURL,
    compatibility: "compatible",
  });

  return provider(config.modelId);
}
