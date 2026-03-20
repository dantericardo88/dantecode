/**
 * model-router-bridge.test.ts — @dantecode/ux-polish
 * Tests for G12 — Model-router weld.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  ModelRouterBridge,
  getModelRouterBridge,
  resetModelRouterBridge,
} from "./model-router-bridge.js";
import type { RouterStateSnapshot } from "./model-router-bridge.js";

describe("ModelRouterBridge", () => {
  let bridge: ModelRouterBridge;

  beforeEach(() => {
    bridge = new ModelRouterBridge();
    resetModelRouterBridge();
  });

  describe("extractHint()", () => {
    it("returns null when state is undefined", () => {
      expect(bridge.extractHint(undefined)).toBeNull();
    });

    it("returns null when state has no activeModelId", () => {
      expect(bridge.extractHint({ activeTaskType: "code" })).toBeNull();
    });

    it("returns a RouterCapabilityHint for a known model", () => {
      const hint = bridge.extractHint({ activeModelId: "claude-sonnet-4-6" });
      expect(hint).not.toBeNull();
      expect(hint!.modelId).toBe("claude-sonnet-4-6");
      expect(hint!.costTier).toBe("balanced");
      expect(hint!.supportsStreaming).toBe(true);
    });

    it("infers budget tier for haiku models", () => {
      const hint = bridge.extractHint({ activeModelId: "claude-haiku-4-5" });
      expect(hint!.costTier).toBe("budget");
    });

    it("infers quality tier for opus models", () => {
      const hint = bridge.extractHint({ activeModelId: "claude-opus-4-6" });
      expect(hint!.costTier).toBe("quality");
    });

    it("sets supportsStreaming=false for legacy instruct models", () => {
      const hint = bridge.extractHint({ activeModelId: "gpt-3-instruct" });
      expect(hint!.supportsStreaming).toBe(false);
    });

    it("propagates taskType from state", () => {
      const hint = bridge.extractHint({ activeModelId: "claude-sonnet-4-6", activeTaskType: "code" });
      expect(hint!.taskType).toBe("code");
    });
  });

  describe("enrichSuggestions()", () => {
    const suggestions = [
      { command: "/verify", label: "Run verification", reason: "test", priority: "high" as const },
      { command: "/magic", label: "Run magic", reason: "test", priority: "medium" as const },
    ];

    it("returns suggestions unchanged when hint is null", () => {
      const result = bridge.enrichSuggestions(suggestions, null);
      expect(result).toHaveLength(2);
      expect(result[0]!.command).toBe("/verify");
    });

    it("adds modelHint to each suggestion when hint is provided", () => {
      const hint = bridge.extractHint({ activeModelId: "claude-sonnet-4-6" });
      const result = bridge.enrichSuggestions(suggestions, hint);
      expect(result[0]!.modelHint).toBeDefined();
      expect(result[1]!.modelHint).toBeDefined();
    });

    it("notes budget tier mismatch on high-priority suggestions", () => {
      const hint = bridge.extractHint({ activeModelId: "claude-haiku-4-5" });
      const result = bridge.enrichSuggestions(suggestions, hint);
      expect(result[0]!.modelHint).toContain("budget");
    });
  });

  describe("formatModelHint()", () => {
    it("formats a hint with model ID and tier", () => {
      const hint = bridge.extractHint({ activeModelId: "claude-sonnet-4-6" })!;
      const formatted = bridge.formatModelHint(hint);
      expect(formatted).toContain("claude-sonnet-4-6");
      expect(formatted).toContain("balanced");
    });

    it("includes streaming indicator", () => {
      const hint = bridge.extractHint({ activeModelId: "claude-sonnet-4-6" })!;
      const formatted = bridge.formatModelHint(hint);
      expect(formatted).toContain("streaming");
    });
  });

  describe("buildSuggestionContext()", () => {
    it("returns base context unchanged when state is null", () => {
      const base = { pdseScore: 0.9 };
      const result = bridge.buildSuggestionContext(base, null);
      expect(result).toEqual(base);
    });

    it("appends model to recentCommands when state has activeModelId", () => {
      const base = { recentCommands: ["/verify"] };
      const state: RouterStateSnapshot = { activeModelId: "claude-sonnet-4-6" };
      const result = bridge.buildSuggestionContext(base, state);
      expect(result.recentCommands).toContain("model:claude-sonnet-4-6");
      expect(result.recentCommands).toContain("/verify");
    });
  });

  describe("getModelRouterBridge() singleton", () => {
    it("returns same instance on repeated calls", () => {
      const a = getModelRouterBridge();
      const b = getModelRouterBridge();
      expect(a).toBe(b);
    });

    it("reset() clears the singleton", () => {
      const a = getModelRouterBridge();
      resetModelRouterBridge();
      const b = getModelRouterBridge();
      expect(a).not.toBe(b);
    });
  });
});
