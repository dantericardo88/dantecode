import { describe, expect, it } from "vitest";
import type { ModelConfig } from "@dantecode/config-types";
import { getProviderExecutionProfile, inferReasoningCapability } from "./provider-execution-profile.js";

const baseConfig: ModelConfig = {
  provider: "grok",
  modelId: "grok-4-1-fast-reasoning",
  maxTokens: 8192,
  temperature: 0.1,
  contextWindow: 131072,
  supportsVision: false,
  supportsToolCalls: true,
};

describe("inferReasoningCapability", () => {
  it("detects reasoning-capable grok models by id", () => {
    expect(inferReasoningCapability(baseConfig)).toBe(true);
  });

  it("respects explicit supportsExtendedThinking=false", () => {
    expect(
      inferReasoningCapability({
        ...baseConfig,
        supportsExtendedThinking: false,
      }),
    ).toBe(false);
  });
});

describe("getProviderExecutionProfile", () => {
  it("builds anthropic thinking options with adaptive budgets", () => {
    const profile = getProviderExecutionProfile(
      {
        ...baseConfig,
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        supportsExtendedThinking: true,
        reasoningEffort: "high",
      },
      { thinkingBudget: 4096 },
    );

    expect(profile.providerOptions).toEqual({
      anthropic: {
        thinking: {
          type: "enabled",
          budgetTokens: 4096,
        },
        reasoningEffort: "high",
      },
    });
    expect(profile.topP).toBe(0.95);
  });

  it("adds grok sampling defaults and provider thinking options", () => {
    const profile = getProviderExecutionProfile(
      {
        ...baseConfig,
        supportsExtendedThinking: true,
        reasoningEffort: "medium",
      },
      {},
    );

    expect(profile.temperature).toBe(0.1);
    expect(profile.topP).toBe(0.9);
    expect(profile.providerOptions).toEqual({
      grok: {
        reasoningEffort: "medium",
        thinkingBudget: 4096,
      },
    });
  });

  it("applies google topK defaults", () => {
    const profile = getProviderExecutionProfile(
      {
        ...baseConfig,
        provider: "google",
        modelId: "gemini-2.5-pro",
        supportsExtendedThinking: true,
      },
      { thinkingBudget: 2048 },
    );

    expect(profile.topP).toBe(1);
    expect(profile.topK).toBe(32);
    expect(profile.providerOptions).toEqual({
      google: {
        reasoningEffort: "medium",
        thinkingConfig: {
          thinkingBudget: 2048,
        },
      },
    });
  });
});
