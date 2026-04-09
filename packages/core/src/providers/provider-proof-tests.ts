// ============================================================================
// @dantecode/core — Provider Proof Tests
// Basic validation that providers can be built and configured.
// ============================================================================

import type { ModelConfig } from "@dantecode/config-types";
import { PROVIDER_BUILDERS } from "./index.js";

// Test configurations for each provider
const PROVIDER_TEST_CONFIGS: Record<string, ModelConfig> = {
  anthropic: {
    provider: "anthropic",
    modelId: "claude-sonnet-4",
    maxTokens: 8192,
    temperature: 0.1,
    contextWindow: 200000,
    supportsVision: true,
    supportsToolCalls: true,
  },
  openai: {
    provider: "openai",
    modelId: "gpt-4",
    maxTokens: 8192,
    temperature: 0.1,
    contextWindow: 128000,
    supportsVision: true,
    supportsToolCalls: true,
  },
  google: {
    provider: "google",
    modelId: "gemini-pro",
    maxTokens: 8192,
    temperature: 0.1,
    contextWindow: 32768,
    supportsVision: true,
    supportsToolCalls: true,
  },
  grok: {
    provider: "grok",
    modelId: "grok-3",
    maxTokens: 8192,
    temperature: 0.1,
    contextWindow: 128000,
    supportsVision: false,
    supportsToolCalls: true,
  },
  groq: {
    provider: "groq",
    modelId: "llama3-70b-8192",
    maxTokens: 8192,
    temperature: 0.1,
    contextWindow: 8192,
    supportsVision: false,
    supportsToolCalls: true,
  },
  ollama: {
    provider: "ollama",
    modelId: "llama3.2:3b",
    maxTokens: 4096,
    temperature: 0.1,
    contextWindow: 4096,
    supportsVision: false,
    supportsToolCalls: false,
  },
};

// Environment setup
function setupProviderEnv(provider: string) {
  // Clear existing env vars
  Object.keys(process.env).forEach((key) => {
    if (key.includes("_API_KEY") || key.includes("OLLAMA")) {
      delete process.env[key];
    }
  });

  // Set test env vars
  switch (provider) {
    case "anthropic":
      process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
      break;
    case "openai":
      process.env.OPENAI_API_KEY = "test-openai-key";
      break;
    case "google":
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
      break;
    case "grok":
      process.env.XAI_API_KEY = "test-grok-key";
      break;
    case "groq":
      process.env.GROQ_API_KEY = "test-groq-key";
      break;
  }
}

/**
 * Run basic provider construction tests and return results.
 * Used by the /verify command for model flexibility scoring.
 */
export async function runProviderProofTests(): Promise<{
  totalProviders: number;
  passedProviders: number;
  failedProviders: number;
  results: Array<{
    provider: string;
    passed: boolean;
    error?: string;
  }>;
}> {
  const results: Array<{
    provider: string;
    passed: boolean;
    error?: string;
  }> = [];

  for (const [providerName, config] of Object.entries(PROVIDER_TEST_CONFIGS)) {
    try {
      setupProviderEnv(providerName);
      const builder = PROVIDER_BUILDERS[providerName];

      if (!builder) {
        results.push({
          provider: providerName,
          passed: false,
          error: `No builder found for provider ${providerName}`,
        });
        continue;
      }

      // Test basic provider construction
      const provider = builder(config);

      // Basic validation that provider was created
      if (!provider) {
        results.push({
          provider: providerName,
          passed: false,
          error: `Provider construction returned null/undefined`,
        });
        continue;
      }

      results.push({ provider: providerName, passed: true });
    } catch (error) {
      results.push({
        provider: providerName,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const passedProviders = results.filter((r) => r.passed).length;
  const failedProviders = results.length - passedProviders;

  return {
    totalProviders: results.length,
    passedProviders,
    failedProviders,
    results,
  };
}
