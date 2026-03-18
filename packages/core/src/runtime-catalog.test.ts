import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  MODEL_CATALOG,
  PROVIDER_CATALOG,
  SURFACE_RELEASE_MATRIX,
  getDefaultModelCatalogEntry,
  getModelCatalogEntry,
  getModelsForProvider,
  getProviderCatalogEntry,
  groupCatalogModels,
  inferProviderFromModelId,
  parseModelReference,
} from "./runtime-catalog.js";

describe("runtime catalog", () => {
  it("exposes the default model entry", () => {
    const entry = getDefaultModelCatalogEntry();
    expect(entry.id).toBe(DEFAULT_MODEL_ID);
    expect(entry.defaultSelected).toBe(true);
  });

  it("groups models by provider label", () => {
    const groups = groupCatalogModels();
    expect(groups.some((group) => group.groupLabel === "xAI / Grok")).toBe(true);
    expect(groups.some((group) => group.groupLabel === "Local (Ollama)")).toBe(true);
  });

  it("returns provider metadata for tier-1 and advanced providers", () => {
    expect(getProviderCatalogEntry("grok")?.supportTier).toBe("tier1");
    expect(getProviderCatalogEntry("groq")?.supportTier).toBe("advanced");
  });

  it("infers providers from bare model IDs", () => {
    expect(inferProviderFromModelId("claude-sonnet-4-6")).toBe("anthropic");
    expect(inferProviderFromModelId("gemini-2.5-pro")).toBe("google");
    expect(inferProviderFromModelId("llama3")).toBe("ollama");
    expect(inferProviderFromModelId("qwen2.5-coder:7b")).toBe("ollama");
  });

  it("parses provider-qualified and bare model references", () => {
    expect(parseModelReference("openai/gpt-4.1")).toEqual({
      id: "openai/gpt-4.1",
      provider: "openai",
      modelId: "gpt-4.1",
    });
    expect(parseModelReference("claude-sonnet-4-6")).toEqual({
      id: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
    });
    expect(parseModelReference("llama3")).toEqual({
      id: "ollama/llama3",
      provider: "ollama",
      modelId: "llama3",
    });
  });

  it("keeps model and provider catalogs internally consistent", () => {
    for (const model of MODEL_CATALOG) {
      expect(getProviderCatalogEntry(model.provider)).toBeDefined();
      expect(getModelCatalogEntry(model.id)?.id).toBe(model.id);
    }

    for (const provider of PROVIDER_CATALOG) {
      if (provider.id === "custom") {
        continue;
      }
      expect(getModelsForProvider(provider.id).length).toBeGreaterThan(0);
    }
  });

  it("marks desktop as experimental in the surface matrix", () => {
    const desktop = SURFACE_RELEASE_MATRIX.find((entry) => entry.id === "desktop");
    expect(desktop?.releaseRing).toBe("experimental");
    expect(desktop?.shipTarget).toBe(false);
  });

  it("contains 30+ models in the catalog", () => {
    expect(MODEL_CATALOG.length).toBeGreaterThanOrEqual(30);
  });

  it("includes GPT-5 family models", () => {
    expect(getModelCatalogEntry("openai/gpt-5")).toBeDefined();
    expect(getModelCatalogEntry("openai/gpt-5-mini")).toBeDefined();
    expect(getModelCatalogEntry("openai/gpt-5.1-codex-mini")).toBeDefined();
  });

  it("includes o4-mini reasoning model", () => {
    const entry = getModelCatalogEntry("openai/o4-mini");
    expect(entry).toBeDefined();
    expect(entry?.reasoningModel).toBe(true);
    expect(entry?.supportsExtendedThinking).toBe(true);
  });

  it("includes DeepSeek R1 as a reasoning model", () => {
    const entry = getModelCatalogEntry("ollama/deepseek-r1:14b");
    expect(entry).toBeDefined();
    expect(entry?.reasoningModel).toBe(true);
    expect(entry?.supportsExtendedThinking).toBe(true);
  });

  it("includes code-focused Ollama models", () => {
    expect(getModelCatalogEntry("ollama/deepseek-coder-v2:16b")).toBeDefined();
    expect(getModelCatalogEntry("ollama/codellama:34b")).toBeDefined();
    expect(getModelCatalogEntry("ollama/starcoder2:15b")).toBeDefined();
  });

  it("marks Anthropic models as supporting extended thinking", () => {
    const opus = getModelCatalogEntry("anthropic/claude-opus-4-6");
    const sonnet = getModelCatalogEntry("anthropic/claude-sonnet-4-6");
    expect(opus?.supportsExtendedThinking).toBe(true);
    expect(sonnet?.supportsExtendedThinking).toBe(true);
  });

  it("marks Grok reasoning models with extended thinking", () => {
    const entry = getModelCatalogEntry("grok/grok-4.20-beta-0309-reasoning");
    expect(entry?.supportsExtendedThinking).toBe(true);
    expect(entry?.reasoningModel).toBe(true);
  });

  it("infers provider for new model patterns", () => {
    expect(inferProviderFromModelId("o4-mini")).toBe("openai");
    expect(inferProviderFromModelId("deepseek-r1:14b")).toBe("ollama");
    expect(inferProviderFromModelId("deepseek-coder-v2:16b")).toBe("ollama");
    expect(inferProviderFromModelId("codellama:34b")).toBe("ollama");
    expect(inferProviderFromModelId("starcoder2:15b")).toBe("ollama");
    expect(inferProviderFromModelId("gpt-5")).toBe("openai");
    expect(inferProviderFromModelId("gpt-5-mini")).toBe("openai");
  });
});
