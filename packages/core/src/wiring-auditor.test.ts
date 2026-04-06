import { describe, it, expect } from "vitest";
import {
  FEATURE_WIRING_MAP,
  HOT_PATH_FILES,
  getRegisteredFeatures,
  isFeatureRegistered,
  getFeatureWiring,
} from "./wiring-auditor.js";

describe("WiringAuditor", () => {
  it("FEATURE_WIRING_MAP contains stream-recovery", () => {
    expect(FEATURE_WIRING_MAP["stream-recovery"]).toBeDefined();
    expect(FEATURE_WIRING_MAP["stream-recovery"]!.fn).toBe("StreamRecovery");
  });

  it("FEATURE_WIRING_MAP contains memory-consolidation", () => {
    expect(FEATURE_WIRING_MAP["memory-consolidation"]).toBeDefined();
    expect(FEATURE_WIRING_MAP["memory-consolidation"]!.fn).toBe("MemoryConsolidator");
  });

  it("HOT_PATH_FILES includes agent-loop.ts", () => {
    expect(HOT_PATH_FILES).toContain("packages/cli/src/agent-loop.ts");
  });

  it("getRegisteredFeatures returns all keys", () => {
    const features = getRegisteredFeatures();
    expect(features).toContain("stream-recovery");
    expect(features).toContain("memory-consolidation");
    expect(features).toContain("circuit-breaker");
  });

  it("isFeatureRegistered returns true for known features", () => {
    expect(isFeatureRegistered("stream-recovery")).toBe(true);
    expect(isFeatureRegistered("loop-detector")).toBe(true);
  });

  it("isFeatureRegistered returns false for unknown features", () => {
    expect(isFeatureRegistered("nonexistent-feature")).toBe(false);
  });

  it("getFeatureWiring returns entry for known feature", () => {
    const entry = getFeatureWiring("recovery-engine");
    expect(entry).toBeDefined();
    expect(entry!.fn).toBe("RecoveryEngine");
  });

  it("getFeatureWiring returns undefined for unknown feature", () => {
    expect(getFeatureWiring("fake")).toBeUndefined();
  });
});
