// ============================================================================
// Provider Streaming + Tool Calling Integration Tests
// ============================================================================
//
// These tests verify that streaming and native tool calling work correctly
// across all configured providers. They require real API keys and are NOT
// run in CI — use `npx vitest run tests/provider-streaming.test.ts` locally.
//
// Set environment variables before running:
//   GROK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
// ============================================================================

import { describe, it, expect } from "vitest";
import { z } from "zod";

// This test imports directly from source to avoid needing a build step
import { ModelRouterImpl } from "../packages/core/src/model-router.js";
import type { ModelRouterConfig, ModelConfig } from "../packages/config-types/src/index.js";

const TIMEOUT = 30_000;

// Simple "ping" tool for testing tool calling round-trip
const pingTool = {
  description: "Returns a fixed response to verify tool calling works.",
  parameters: z.object({
    message: z.string().describe("A message to echo back"),
  }),
};

const testTools = { ping: pingTool };

/**
 * Creates a ModelRouterConfig for a single provider.
 */
function makeRouterConfig(config: ModelConfig): ModelRouterConfig {
  return {
    default: config,
    fallback: [],
    overrides: {},
  };
}

/**
 * Provider configurations to test.
 * Only providers with configured API keys will be tested.
 */
const providers: Array<{
  name: string;
  config: ModelConfig;
  envKey: string;
}> = [
  {
    name: "grok",
    config: {
      provider: "grok",
      modelId: "grok-3-mini",
      maxTokens: 1024,
      temperature: 0,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: true,
    },
    envKey: "GROK_API_KEY",
  },
  {
    name: "openai",
    config: {
      provider: "openai",
      modelId: "gpt-4o-mini",
      maxTokens: 1024,
      temperature: 0,
      contextWindow: 128000,
      supportsVision: true,
      supportsToolCalls: true,
    },
    envKey: "OPENAI_API_KEY",
  },
  {
    name: "anthropic",
    config: {
      provider: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
      maxTokens: 1024,
      temperature: 0,
      contextWindow: 200000,
      supportsVision: true,
      supportsToolCalls: true,
    },
    envKey: "ANTHROPIC_API_KEY",
  },
];

describe("Provider Streaming Integration", () => {
  for (const provider of providers) {
    const hasKey = !!process.env[provider.envKey];

    describe(provider.name, () => {
      it.skipIf(!hasKey)("streams text output", async () => {
        const routerConfig = makeRouterConfig(provider.config);
        const router = new ModelRouterImpl(routerConfig, "/tmp", "test-session");

        const result = await router.stream(
          [{ role: "user", content: "Say hello in exactly 3 words." }],
          { system: "You are a helpful assistant. Be concise." },
        );

        const chunks: string[] = [];
        for await (const chunk of result.textStream) {
          chunks.push(chunk);
        }

        expect(chunks.length).toBeGreaterThan(0);
        expect(chunks.join("").length).toBeGreaterThan(0);
      }, TIMEOUT);

      it.skipIf(!hasKey)("handles native tool calling", async () => {
        const routerConfig = makeRouterConfig(provider.config);
        const router = new ModelRouterImpl(routerConfig, "/tmp", "test-session");

        const result = await router.streamWithTools(
          [{ role: "user", content: 'Call the ping tool with message "hello"' }],
          testTools,
          { system: "You have access to a ping tool. Use it when asked." },
        );

        const textParts: string[] = [];
        const toolCalls: Array<{ toolName: string; args: unknown }> = [];

        for await (const part of result.fullStream) {
          if (part.type === "text-delta") {
            textParts.push(part.textDelta);
          } else if (part.type === "tool-call") {
            toolCalls.push({ toolName: part.toolName, args: part.args });
          }
        }

        // The model should have called the ping tool
        expect(toolCalls.length).toBeGreaterThanOrEqual(1);
        expect(toolCalls[0]!.toolName).toBe("ping");
      }, TIMEOUT);
    });
  }
});
