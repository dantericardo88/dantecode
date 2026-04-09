// ============================================================================
// @dantecode/core — Grok Provider (xAI OpenAI-compatible API)
// M7: Hardened with tool-call normalization and model capability flags.
// ============================================================================

import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";
import { normalizeGrokToolCall, repairMalformedJson, type GrokModelCapabilities } from "./grok-normalizer.js";

/**
 * Grok model capability flags — conservative defaults based on known xAI behavior.
 */
export const GROK_CAPABILITIES: GrokModelCapabilities = {
  supportsStreaming: true,
  supportsToolCalls: true,
  supportsParallelToolCalls: false,
  supportsStructuredOutput: false,
  maxToolCallsPerTurn: 1,
  requiresToolCallNormalization: true,
};

/**
 * Builds a Grok language model provider using xAI's OpenAI-compatible endpoint.
 *
 * Resolves the API key from `config.apiKey`, `XAI_API_KEY`, or `GROK_API_KEY`.
 * Uses the `@ai-sdk/openai` package with `compatibility: "compatible"` mode
 * (xAI does not support `stream_options` required by strict mode).
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

  const provider = createOpenAI({
    apiKey,
    baseURL: "https://api.x.ai/v1",
    compatibility: "compatible",  // xAI does not support strict mode's stream_options
    headers: {
      "X-Client": "dantecode/1.0.0",
    },
  });

  return provider(config.modelId);
}

// Re-export normalizer utilities for use in the agent loop
export { normalizeGrokToolCall, repairMalformedJson };
