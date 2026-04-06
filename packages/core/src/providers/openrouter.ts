// ============================================================================
// @dantecode/core — OpenRouter Provider
// OpenRouter is OpenAI-API-compatible and provides access to 200+ models
// from Anthropic, OpenAI, Google, Meta, Mistral, and more via one API key.
// API: https://openrouter.ai/api/v1
// Env var: OPENROUTER_API_KEY
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

export const OPENROUTER_MODELS = [
  "anthropic/claude-sonnet-4-6",
  "anthropic/claude-opus-4-6",
  "openai/gpt-4o",
  "openai/o3",
  "google/gemini-2.5-pro",
  "meta-llama/llama-3.3-70b-instruct",
  "mistralai/mistral-large-2411",
  "deepseek/deepseek-chat",
  "qwen/qwen-2.5-72b-instruct",
  "x-ai/grok-beta",
] as const;

export type OpenRouterModelId = (typeof OPENROUTER_MODELS)[number] | string;

/**
 * Builds an OpenRouter language model provider using the OpenAI-compatible API.
 *
 * OpenRouter provides access to 200+ models via a single API key at
 * https://openrouter.ai/api/v1. Resolves the API key from `config.apiKey`
 * or the `OPENROUTER_API_KEY` environment variable.
 *
 * @param config - Model configuration specifying modelId and optional apiKey.
 * @returns A configured LanguageModelV1 instance for the specified model.
 * @throws If no API key is available from config or environment.
 */
export function buildOpenRouterProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["OPENROUTER_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "OpenRouter API key not found.\n" +
        "Set OPENROUTER_API_KEY environment variable or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://openrouter.ai/keys",
    );
  }

  const provider = createOpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": "https://dantecode.dev",
      "X-Title": "DanteCode",
    },
  });

  return provider(config.modelId);
}
