// ============================================================================
// Integration Tests — Live Provider Verification
// These tests call REAL APIs. They only run when the required env vars are set.
// Run with: npx vitest run tests/integration/live-providers.test.ts
// ============================================================================

import { describe, it, expect } from "vitest";
import { ModelRouterImpl } from "@dantecode/core";
import type { ModelRouterConfig, ModelConfig } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GROK_KEY = process.env["XAI_API_KEY"] ?? process.env["GROK_API_KEY"];
const ANTHROPIC_KEY = process.env["ANTHROPIC_API_KEY"];
const OPENAI_KEY = process.env["OPENAI_API_KEY"];

async function isOllamaRunning(): Promise<boolean> {
  try {
    const resp = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function getOllamaModels(): Promise<string[]> {
  try {
    const resp = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(3000),
    });
    const data = (await resp.json()) as { models: Array<{ name: string }> };
    return data.models.map((m) => m.name);
  } catch {
    return [];
  }
}

function makeRouter(
  modelOverrides: Partial<ModelConfig>,
  fallback: ModelConfig[] = [],
): ModelRouterImpl {
  const config: ModelRouterConfig = {
    default: {
      provider: "grok",
      modelId: "grok-3-fast",
      maxTokens: 256,
      temperature: 0,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: true,
      ...modelOverrides,
    },
    fallback,
    overrides: {},
  };
  return new ModelRouterImpl(config, ".", "integration-test");
}

// ---------------------------------------------------------------------------
// Grok Provider — Live API
// ---------------------------------------------------------------------------

describe.skipIf(!GROK_KEY)("Grok Provider (LIVE)", () => {
  it("generates a real text response from Grok", async () => {
    const router = makeRouter({
      provider: "grok",
      modelId: "grok-3-fast",
      apiKey: GROK_KEY,
    });

    const result = await router.generate(
      [{ role: "user", content: "What is 2+2? Answer with just the number." }],
      { maxTokens: 32 },
    );

    expect(result).toBeTruthy();
    expect(result).toContain("4");
  }, 30_000);

  it("streams real tokens from Grok", async () => {
    const router = makeRouter({
      provider: "grok",
      modelId: "grok-3-fast",
      apiKey: GROK_KEY,
    });

    const result = await router.stream(
      [{ role: "user", content: "Say hello in exactly 3 words." }],
      { maxTokens: 32 },
    );

    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join("");
    expect(fullText.length).toBeGreaterThan(0);
  }, 30_000);

  it("tracks cost after generation", async () => {
    const router = makeRouter({
      provider: "grok",
      modelId: "grok-3-fast",
      apiKey: GROK_KEY,
    });

    await router.generate(
      [{ role: "user", content: "Hi" }],
      { maxTokens: 16 },
    );

    const cost = router.getCost();
    expect(cost.totalCostUSD).toBeGreaterThan(0);
    expect(cost.totalInputTokens).toBeGreaterThan(0);
    expect(cost.totalOutputTokens).toBeGreaterThan(0);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Anthropic Provider — Live API
// ---------------------------------------------------------------------------

describe.skipIf(!ANTHROPIC_KEY)("Anthropic Provider (LIVE)", () => {
  it("generates a real text response from Claude", async () => {
    const router = makeRouter({
      provider: "anthropic",
      modelId: "claude-haiku-4-5-20251001",
      apiKey: ANTHROPIC_KEY,
    });

    const result = await router.generate(
      [{ role: "user", content: "What is 3+3? Answer with just the number." }],
      { maxTokens: 32 },
    );

    expect(result).toContain("6");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// OpenAI Provider — Live API
// ---------------------------------------------------------------------------

describe.skipIf(!OPENAI_KEY)("OpenAI Provider (LIVE)", () => {
  it("generates a real text response from GPT", async () => {
    const router = makeRouter({
      provider: "openai",
      modelId: "gpt-4o-mini",
      apiKey: OPENAI_KEY,
    });

    const result = await router.generate(
      [{ role: "user", content: "What is 5+5? Answer with just the number." }],
      { maxTokens: 32 },
    );

    expect(result).toContain("10");
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Ollama Provider — Local Model
// ---------------------------------------------------------------------------

describe("Ollama Provider (LOCAL)", () => {
  it("generates a response from local Ollama model", async () => {
    const running = await isOllamaRunning();
    if (!running) {
      console.log("Ollama not running — skipping");
      return;
    }

    const models = await getOllamaModels();
    const preferredModels = ["qwen2.5-coder:7b", "qwen2.5-coder:latest", "llama3.1:8b", "mistral:7b"];
    const model = preferredModels.find((m) => models.includes(m)) ?? models[0];
    if (!model) {
      console.log("No Ollama models available — skipping");
      return;
    }

    const router = makeRouter({ provider: "ollama", modelId: model });

    const result = await router.generate(
      [{ role: "user", content: "What is 7+7? Answer with just the number." }],
      { maxTokens: 32 },
    );

    expect(result).toBeTruthy();
    expect(result.length).toBeGreaterThan(0);
    console.log(`Ollama (${model}) response: ${result.trim()}`);
  }, 120_000);

  it("streams tokens from local Ollama model", async () => {
    const running = await isOllamaRunning();
    if (!running) {
      console.log("Ollama not running — skipping");
      return;
    }

    const models = await getOllamaModels();
    const preferredModels = ["qwen2.5-coder:7b", "qwen2.5-coder:latest", "llama3.1:8b"];
    const model = preferredModels.find((m) => models.includes(m)) ?? models[0];
    if (!model) {
      console.log("No Ollama models available — skipping");
      return;
    }

    const router = makeRouter({ provider: "ollama", modelId: model });

    const result = await router.stream(
      [{ role: "user", content: "Say hello." }],
      { maxTokens: 32 },
    );

    const chunks: string[] = [];
    for await (const chunk of result.textStream) {
      chunks.push(chunk);
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join("");
    expect(fullText.length).toBeGreaterThan(0);
    console.log(`Ollama streaming (${model}): ${fullText.trim()}`);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Fallback Chain — Live
// ---------------------------------------------------------------------------

describe("Fallback Chain (LIVE)", () => {
  it("falls back from missing provider to available one", async () => {
    const running = await isOllamaRunning();
    if (!running && !GROK_KEY) {
      console.log("Neither Ollama nor Grok available — skipping");
      return;
    }

    const models = await getOllamaModels();
    const ollamaModel = models[0];

    const fallback: ModelConfig[] = [];
    if (ollamaModel) {
      fallback.push({
        provider: "ollama",
        modelId: ollamaModel,
        maxTokens: 32,
        temperature: 0,
        contextWindow: 4096,
        supportsVision: false,
        supportsToolCalls: false,
      });
    } else if (GROK_KEY) {
      fallback.push({
        provider: "grok",
        modelId: "grok-3-fast",
        maxTokens: 32,
        temperature: 0,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: true,
        apiKey: GROK_KEY,
      });
    }

    const router = makeRouter(
      {
        provider: "openai",
        modelId: "gpt-99-nonexistent",
        apiKey: "sk-fake-key-that-will-fail",
      },
      fallback,
    );

    const result = await router.generate(
      [{ role: "user", content: "What is 1+1? Answer with just the number." }],
      { maxTokens: 32 },
    );

    expect(result).toBeTruthy();
    const logs = router.getLogs();
    const hasFallback = logs.some((l) => l.action === "fallback");
    expect(hasFallback).toBe(true);
  }, 120_000);
});
