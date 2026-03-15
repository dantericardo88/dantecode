// ============================================================================
// @dantecode/core — Anthropic Provider
// ============================================================================

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModelV1 } from "ai";
import type { ModelConfig } from "@dantecode/config-types";

/**
 * Builds an Anthropic language model provider using the official `@ai-sdk/anthropic`
 * package.
 *
 * Resolves the API key from `config.apiKey` or the `ANTHROPIC_API_KEY` environment
 * variable.
 *
 * @param config - Model configuration specifying modelId and optional apiKey.
 * @returns A configured LanguageModelV1 instance for the specified Anthropic model.
 * @throws If no API key is available from config or environment.
 */
export function buildAnthropicProvider(config: ModelConfig): LanguageModelV1 {
  const apiKey = config.apiKey ?? process.env["ANTHROPIC_API_KEY"];

  if (!apiKey) {
    throw new Error(
      "Anthropic API key not found.\n" +
        "Set ANTHROPIC_API_KEY environment variable or configure it in dante.config.yaml\n" +
        "Get your key at: https://console.anthropic.com/"
    );
  }

  const anthropic = createAnthropic({
    apiKey,
  });

  return anthropic(config.modelId);
}
