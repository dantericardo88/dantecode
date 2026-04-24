// ============================================================================
// @dantecode/core — Grok Provider (native xAI API)
// ============================================================================

import { createXai } from "@ai-sdk/xai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds a Grok language model provider using the native xAI AI SDK provider.
 *
 * Resolves the API key from `config.apiKey`, `XAI_API_KEY`, or `GROK_API_KEY`.
 * Uses `@ai-sdk/xai` so Grok tool calls arrive as structured stream parts
 * instead of prose that must be parsed after the fact.
 *
 * @param config - Model configuration specifying modelId and optional apiKey.
 * @returns A configured LanguageModelV1 instance for the specified Grok model.
 * @throws If no API key is available from config or environment.
 */
export function buildGrokProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["XAI_API_KEY"] ?? process.env["GROK_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Grok API key not found.\n" +
        "Set XAI_API_KEY or GROK_API_KEY, or configure it in .dantecode/STATE.yaml\n" +
        "Get your key at: https://console.x.ai/",
    );
  }

  const provider = createXai({
    apiKey,
    headers: {
      "X-Client": "dantecode/1.0.0",
    },
  });

  return provider(config.modelId);
}
