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
});
