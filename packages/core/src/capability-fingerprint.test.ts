/**
 * capability-fingerprint.test.ts
 *
 * 25 Vitest unit tests for CapabilityFingerprint.
 * All fs calls are intercepted via fsFn injection — no real disk I/O.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ModelCapabilities } from "./capability-fingerprint.js";
import { CapabilityFingerprint } from "./capability-fingerprint.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFsFn(persistedData?: ModelCapabilities[]) {
  return {
    readFile: vi.fn().mockImplementation(async () => {
      if (persistedData === undefined) {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        throw err;
      }
      return JSON.stringify(persistedData);
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCustomModel(overrides: Partial<ModelCapabilities> = {}): ModelCapabilities {
  return {
    modelId: "custom-model-1",
    provider: "custom-provider",
    contextWindow: 32_000,
    supportsVision: false,
    supportsFunctionCalling: true,
    supportsStreaming: true,
    supportedLanguages: ["en"],
    averageLatencyMs: 500,
    costPer1kInputTokens: 0.001,
    costPer1kOutputTokens: 0.002,
    maxOutputTokens: 2048,
    strengths: ["speed", "cost-effective"],
    weaknesses: ["reasoning"],
    lastUpdated: "2026-01-01",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("CapabilityFingerprint", () => {
  let fsFn: ReturnType<typeof makeFsFn>;
  let fp: CapabilityFingerprint;

  beforeEach(() => {
    fsFn = makeFsFn(); // default: ENOENT (no persisted file)
    fp = new CapabilityFingerprint("/project", { fsFn });
  });

  // 1. Constructor loads built-in fingerprints
  it("1. constructor seeds built-in fingerprints without calling load()", () => {
    const models = fp.listModels();
    expect(models.length).toBeGreaterThanOrEqual(7);
  });

  // 2. getCapability() returns model by id
  it("2. getCapability() returns a known model", () => {
    const m = fp.getCapability("claude-opus-4-6");
    expect(m).toBeDefined();
    expect(m!.modelId).toBe("claude-opus-4-6");
    expect(m!.provider).toBe("anthropic");
  });

  // 3. getCapability() returns undefined for unknown
  it("3. getCapability() returns undefined for an unknown modelId", () => {
    expect(fp.getCapability("does-not-exist")).toBeUndefined();
  });

  // 4. findBestModel() returns model matching criteria
  it("4. findBestModel() returns a model for a valid task", () => {
    const result = fp.findBestModel({ task: "complex reasoning and analysis" });
    expect(result).toBeDefined();
    expect(typeof result!.modelId).toBe("string");
  });

  // 5. findBestModel() filters by requiresVision
  it("5. findBestModel() returns only vision-capable models when requiresVision=true", () => {
    const result = fp.findBestModel({ task: "image analysis", requiresVision: true });
    expect(result).toBeDefined();
    expect(result!.supportsVision).toBe(true);
  });

  // 6. findBestModel() filters by maxCost
  it("6. findBestModel() excludes expensive models when maxCostPer1kTokens is set", () => {
    // claude-opus-4-6 avg cost = (0.015 + 0.075)/2 = 0.045 → should be excluded
    const result = fp.findBestModel({
      task: "summarize text",
      maxCostPer1kTokens: 0.001,
    });
    expect(result).toBeDefined();
    const avg = (result!.costPer1kInputTokens + result!.costPer1kOutputTokens) / 2;
    expect(avg).toBeLessThanOrEqual(0.001);
  });

  // 7. findBestModel() filters by minContextWindow
  it("7. findBestModel() returns model with sufficient context window", () => {
    const result = fp.findBestModel({
      task: "very long document analysis",
      minContextWindow: 500_000,
    });
    expect(result).toBeDefined();
    expect(result!.contextWindow).toBeGreaterThanOrEqual(500_000);
  });

  // 8. findBestModel() returns undefined when no match
  it("8. findBestModel() returns undefined when constraints eliminate all models", () => {
    const result = fp.findBestModel({
      task: "anything",
      maxLatencyMs: 1, // impossibly tight
    });
    expect(result).toBeUndefined();
  });

  // 9. findBestModel() prefers preferred providers
  it("9. findBestModel() boosts score for preferred providers", () => {
    // With no other constraints, a preferred provider should win against equal alternatives
    const withPref = fp.findBestModel({
      task: "code generation",
      preferredProviders: ["google"],
    });
    expect(withPref).toBeDefined();
    expect(withPref!.provider).toBe("google");
  });

  // 10. updateCapability() modifies model
  it("10. updateCapability() applies partial update to a known model", async () => {
    await fp.updateCapability("claude-haiku-4-5", { averageLatencyMs: 999 });
    expect(fp.getCapability("claude-haiku-4-5")!.averageLatencyMs).toBe(999);
  });

  // 11. listModels() returns all models
  it("11. listModels() with no filter returns all registered models", () => {
    const all = fp.listModels();
    expect(all.length).toBeGreaterThanOrEqual(7);
  });

  // 12. listModels() filters by provider
  it("12. listModels(provider) returns only models from that provider", () => {
    const anthropic = fp.listModels("anthropic");
    expect(anthropic.length).toBeGreaterThanOrEqual(3);
    for (const m of anthropic) {
      expect(m.provider).toBe("anthropic");
    }
  });

  // 13. addFingerprint() adds new model
  it("13. addFingerprint() adds a brand-new model", async () => {
    const newModel = makeCustomModel();
    await fp.addFingerprint(newModel);
    expect(fp.getCapability("custom-model-1")).toBeDefined();
    expect(fsFn.writeFile).toHaveBeenCalled();
  });

  // 14. addFingerprint() overwrites existing
  it("14. addFingerprint() overwrites an existing entry", async () => {
    const updated = {
      ...fp.getCapability("claude-haiku-4-5")!,
      averageLatencyMs: 123,
    };
    await fp.addFingerprint(updated);
    expect(fp.getCapability("claude-haiku-4-5")!.averageLatencyMs).toBe(123);
  });

  // 15. getProviders() returns unique providers
  it("15. getProviders() returns unique sorted provider names", () => {
    const providers = fp.getProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("google");
    expect(providers).toContain("meta");
    // No duplicates
    expect(new Set(providers).size).toBe(providers.length);
  });

  // 16. estimateCost() computes correct cost
  it("16. estimateCost() returns correct dollar value", () => {
    // claude-opus-4-6: input=0.015/1k, output=0.075/1k
    // 1000 input + 500 output = 0.015 + 0.0375 = 0.0525
    const cost = fp.estimateCost("claude-opus-4-6", 1000, 500);
    expect(cost).toBeCloseTo(0.0525, 6);
  });

  // 17. estimateCost() returns 0 for unknown model
  it("17. estimateCost() returns 0 for an unknown modelId", () => {
    expect(fp.estimateCost("ghost-model", 1000, 1000)).toBe(0);
  });

  // 18. load() is idempotent
  it("18. load() called twice keeps built-ins without error", async () => {
    await fp.load();
    const countAfterFirst = fp.listModels().length;
    await fp.load();
    expect(fp.listModels().length).toBe(countAfterFirst);
  });

  // 19. save() writes JSON
  it("19. save() calls writeFile with JSON array", async () => {
    await fp.save();
    expect(fsFn.writeFile).toHaveBeenCalledOnce();
    const [, content] = fsFn.writeFile.mock.calls[0]!;
    const parsed = JSON.parse(content as string);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(7);
  });

  // 20. load() merges custom with built-ins
  it("20. load() merges persisted entries on top of built-ins", async () => {
    const customCap = makeCustomModel({ modelId: "persisted-model" });
    const fsFn2 = makeFsFn([customCap]);
    const fp2 = new CapabilityFingerprint("/project", { fsFn: fsFn2 });
    await fp2.load();
    // Built-ins still present
    expect(fp2.getCapability("claude-opus-4-6")).toBeDefined();
    // Persisted model also present
    expect(fp2.getCapability("persisted-model")).toBeDefined();
  });

  // 21. Built-ins include claude-opus-4-6
  it("21. built-ins include claude-opus-4-6 with correct provider", () => {
    const m = fp.getCapability("claude-opus-4-6");
    expect(m).toBeDefined();
    expect(m!.provider).toBe("anthropic");
    expect(m!.supportsVision).toBe(true);
  });

  // 22. Built-ins include gpt-4o
  it("22. built-ins include gpt-4o with function calling support", () => {
    const m = fp.getCapability("gpt-4o");
    expect(m).toBeDefined();
    expect(m!.provider).toBe("openai");
    expect(m!.supportsFunctionCalling).toBe(true);
  });

  // 23. findBestModel() considers task keywords
  it("23. findBestModel() scores vision-strength models higher for vision tasks", () => {
    // llama-3.1-70b doesn't support vision; gpt-4o does and has 'vision' in strengths
    const result = fp.findBestModel({
      task: "vision image recognition multimodal",
      requiresVision: true,
    });
    expect(result).toBeDefined();
    // The returned model must support vision
    expect(result!.supportsVision).toBe(true);
    // And should mention vision or multimodal in its strengths
    const strengthsText = result!.strengths.join(" ").toLowerCase();
    expect(strengthsText.includes("vision") || strengthsText.includes("multimodal")).toBe(true);
  });

  // 24. updateCapability() persists via save
  it("24. updateCapability() calls save() (writeFile) after modification", async () => {
    await fp.updateCapability("gpt-4o-mini", { maxOutputTokens: 8192 });
    expect(fsFn.writeFile).toHaveBeenCalled();
    expect(fp.getCapability("gpt-4o-mini")!.maxOutputTokens).toBe(8192);
  });

  // 25. Multiple providers returned correctly
  it("25. getProviders() includes all four built-in providers", () => {
    const providers = fp.getProviders();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("google");
    expect(providers).toContain("meta");
    expect(providers.length).toBe(4);
  });
});
