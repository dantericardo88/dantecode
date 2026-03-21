// ============================================================================
// @dantecode/core — Skill Wave Orchestrator Tests
// Tests for wave parsing, state management, prompt building, and completion
// detection. Covers multiple skill formats and edge cases.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  parseSkillWaves,
  createWaveState,
  getCurrentWave,
  advanceWave,
  recordWaveFailure,
  buildWavePrompt,
  isWaveComplete,
  CLAUDE_WORKFLOW_MODE,
  buildBridgeWarningPreamble,
  hasBridgeCapabilityGaps,
} from "./skill-wave-orchestrator.js";
import type { BridgeActivationWarnings } from "./skill-wave-orchestrator.js";

// ---------------------------------------------------------------------------
// Wave Parsing
// ---------------------------------------------------------------------------

describe("parseSkillWaves", () => {
  it("parses Wave N: Title markers", () => {
    const instructions = [
      "Some preamble text.",
      "",
      "## Wave 1: Research",
      "Search for relevant repos on GitHub.",
      "",
      "## Wave 2: Analyze",
      "Clone and scan the top repos.",
      "",
      "## Wave 3: Implement",
      "Apply harvested patterns.",
    ].join("\n");

    const waves = parseSkillWaves(instructions);
    expect(waves).toHaveLength(3);
    expect(waves[0]!.number).toBe(1);
    expect(waves[0]!.title).toBe("Research");
    expect(waves[0]!.instructions).toContain("preamble text");
    expect(waves[0]!.instructions).toContain("Search for relevant repos");
    expect(waves[1]!.number).toBe(2);
    expect(waves[1]!.title).toBe("Analyze");
    expect(waves[1]!.instructions).toContain("Clone and scan");
    expect(waves[2]!.number).toBe(3);
    expect(waves[2]!.title).toBe("Implement");
    expect(waves[2]!.instructions).toContain("Apply harvested");
  });

  it("parses Step N: Title markers", () => {
    const instructions = [
      "## Step 1: Setup",
      "Initialize the project.",
      "",
      "## Step 2: Build",
      "Write the code.",
    ].join("\n");

    const waves = parseSkillWaves(instructions);
    expect(waves).toHaveLength(2);
    expect(waves[0]!.title).toBe("Setup");
    expect(waves[1]!.title).toBe("Build");
  });

  it("parses Phase N: Title markers", () => {
    const instructions = [
      "### Phase 1 — Discovery",
      "Find relevant patterns.",
      "",
      "### Phase 2 — Integration",
      "Apply patterns to codebase.",
    ].join("\n");

    const waves = parseSkillWaves(instructions);
    expect(waves).toHaveLength(2);
    expect(waves[0]!.title).toBe("Discovery");
    expect(waves[1]!.title).toBe("Integration");
  });

  it("parses H2 headings when no explicit wave markers exist", () => {
    const instructions = [
      "## Research Phase",
      "Search GitHub for repos.",
      "",
      "## Implementation Phase",
      "Write the code.",
      "",
      "## Verification Phase",
      "Run tests.",
    ].join("\n");

    const waves = parseSkillWaves(instructions);
    expect(waves).toHaveLength(3);
    expect(waves[0]!.title).toBe("Research Phase");
    expect(waves[1]!.title).toBe("Implementation Phase");
    expect(waves[2]!.title).toBe("Verification Phase");
  });

  it("parses numbered top-level sections as fallback", () => {
    const instructions = [
      "1. Search for repos",
      "Use gh search repos.",
      "",
      "2. Clone and analyze",
      "Run analysis.",
      "",
      "3. Implement changes",
      "Apply patterns.",
    ].join("\n");

    const waves = parseSkillWaves(instructions);
    expect(waves).toHaveLength(3);
    expect(waves[0]!.title).toBe("Search for repos");
    expect(waves[1]!.title).toBe("Clone and analyze");
    expect(waves[2]!.title).toBe("Implement changes");
  });

  it("returns single wave when no structure is detected", () => {
    const instructions = "Just do everything in one go. No structure here.";

    const waves = parseSkillWaves(instructions);
    expect(waves).toHaveLength(1);
    expect(waves[0]!.number).toBe(1);
    expect(waves[0]!.title).toBe("Full Execution");
    expect(waves[0]!.instructions).toBe(instructions);
  });

  it("preserves preamble content in first wave", () => {
    const instructions = [
      "# Important Context",
      "This is critical setup info.",
      "",
      "## Wave 1: Do Things",
      "Execute step one.",
      "",
      "## Wave 2: More Things",
      "Execute step two.",
    ].join("\n");

    const waves = parseSkillWaves(instructions);
    expect(waves).toHaveLength(2);
    // First wave should include the preamble
    expect(waves[0]!.instructions).toContain("Important Context");
    expect(waves[0]!.instructions).toContain("critical setup info");
    expect(waves[0]!.instructions).toContain("Execute step one");
  });
});

// ---------------------------------------------------------------------------
// State Management
// ---------------------------------------------------------------------------

describe("createWaveState", () => {
  it("creates initial state with correct defaults", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves);

    expect(state.currentIndex).toBe(0);
    expect(state.completedWaves).toEqual([]);
    expect(state.maxRetries).toBe(2);
    expect(state.waves).toHaveLength(2);
    expect(state.attempts).toEqual({ 1: 0, 2: 0 });
  });

  it("accepts custom maxRetries", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves, 5);
    expect(state.maxRetries).toBe(5);
  });
});

describe("getCurrentWave", () => {
  it("returns first wave initially", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves);
    const current = getCurrentWave(state);
    expect(current).toBeDefined();
    expect(current!.number).toBe(1);
  });

  it("returns null when all waves are complete", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves);
    advanceWave(state);
    advanceWave(state);
    expect(getCurrentWave(state)).toBeNull();
  });
});

describe("advanceWave", () => {
  it("moves to next wave and returns true when more remain", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar\n\n## C\nbaz");
    const state = createWaveState(waves);

    const hasMore = advanceWave(state);
    expect(hasMore).toBe(true);
    expect(state.currentIndex).toBe(1);
    expect(state.completedWaves).toEqual([1]);
    expect(getCurrentWave(state)!.number).toBe(2);
  });

  it("returns false when last wave is completed", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves);

    advanceWave(state); // 1 → 2
    const hasMore = advanceWave(state); // 2 → done
    expect(hasMore).toBe(false);
    expect(state.completedWaves).toEqual([1, 2]);
    expect(getCurrentWave(state)).toBeNull();
  });

  it("returns false when already past the end", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves);
    advanceWave(state);
    advanceWave(state);
    expect(advanceWave(state)).toBe(false);
  });
});

describe("recordWaveFailure", () => {
  it("returns true when retries remain", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves, 2);

    expect(recordWaveFailure(state)).toBe(true); // attempt 1/2
    expect(state.attempts[1]).toBe(1);
  });

  it("returns false when max retries exceeded", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves, 2);

    recordWaveFailure(state); // attempt 1
    expect(recordWaveFailure(state)).toBe(false); // attempt 2 = max
  });

  it("returns false when no current wave", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves);
    advanceWave(state);
    advanceWave(state);
    expect(recordWaveFailure(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Prompt Building
// ---------------------------------------------------------------------------

describe("buildWavePrompt", () => {
  it("includes current wave number, total, and title", () => {
    const waves = parseSkillWaves("## Research\nfoo\n\n## Implement\nbar\n\n## Verify\nbaz");
    const state = createWaveState(waves);
    const prompt = buildWavePrompt(state);

    expect(prompt).toContain("1/3");
    expect(prompt).toContain("Research");
    expect(prompt).toContain("[WAVE COMPLETE]");
  });

  it("includes completed waves list after first wave", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar\n\n## C\nbaz");
    const state = createWaveState(waves);
    advanceWave(state);
    const prompt = buildWavePrompt(state);

    expect(prompt).toContain("2/3");
    expect(prompt).toContain("Completed waves");
    expect(prompt).toContain("Wave 1");
  });

  it("includes retry warning on repeated attempts", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves);
    recordWaveFailure(state);
    const prompt = buildWavePrompt(state);

    expect(prompt).toContain("retry");
    expect(prompt).toContain("previous attempt");
  });

  it("returns completion message when all waves done", () => {
    const waves = parseSkillWaves("## A\nfoo\n\n## B\nbar");
    const state = createWaveState(waves);
    advanceWave(state);
    advanceWave(state);
    const prompt = buildWavePrompt(state);

    expect(prompt).toContain("All waves complete");
  });
});

// ---------------------------------------------------------------------------
// Wave Completion Detection
// ---------------------------------------------------------------------------

describe("isWaveComplete", () => {
  it("detects [WAVE COMPLETE] marker", () => {
    expect(isWaveComplete("Done with this wave. [WAVE COMPLETE]")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isWaveComplete("[wave complete]")).toBe(true);
    expect(isWaveComplete("[Wave Complete]")).toBe(true);
  });

  it("returns false when no marker present", () => {
    expect(isWaveComplete("I finished the wave.")).toBe(false);
    expect(isWaveComplete("Wave is complete now.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CLAUDE_WORKFLOW_MODE constant
// ---------------------------------------------------------------------------

describe("CLAUDE_WORKFLOW_MODE", () => {
  it("contains key workflow rules", () => {
    expect(CLAUDE_WORKFLOW_MODE).toContain("Read full file");
    expect(CLAUDE_WORKFLOW_MODE).toContain("Surgical Edit");
    expect(CLAUDE_WORKFLOW_MODE).toContain("[WAVE COMPLETE]");
    expect(CLAUDE_WORKFLOW_MODE).toContain("gh search repos");
  });
});

// ============================================================================
// SkillBridge Warning Surface Tests
// ============================================================================

describe("buildBridgeWarningPreamble", () => {
  const base: BridgeActivationWarnings = {
    skillName: "test-skill",
    bucket: "green",
    conversionScore: 0.95,
    runtimeWarnings: [],
    conversionWarnings: [],
    hasCapabilityGaps: false,
  };

  it("returns empty string for green skill with no warnings", () => {
    expect(buildBridgeWarningPreamble(base)).toBe("");
  });

  it("returns non-empty string when bucket is amber", () => {
    const amber: BridgeActivationWarnings = { ...base, bucket: "amber" };
    expect(buildBridgeWarningPreamble(amber).length).toBeGreaterThan(0);
  });

  it("returns non-empty string when bucket is red", () => {
    const red: BridgeActivationWarnings = { ...base, bucket: "red" };
    expect(buildBridgeWarningPreamble(red).length).toBeGreaterThan(0);
  });

  it("includes WARNING prefix for amber bucket", () => {
    const amber: BridgeActivationWarnings = { ...base, bucket: "amber" };
    expect(buildBridgeWarningPreamble(amber)).toContain("WARNING:");
  });

  it("includes BLOCKED prefix for red bucket", () => {
    const red: BridgeActivationWarnings = { ...base, bucket: "red" };
    expect(buildBridgeWarningPreamble(red)).toContain("BLOCKED:");
  });

  it("does not include emoji characters", () => {
    const amber: BridgeActivationWarnings = { ...base, bucket: "amber" };
    const result = buildBridgeWarningPreamble(amber);
    expect(result).not.toMatch(/[⚠❌]/u);
  });

  it("lists runtime warnings in output", () => {
    const withWarnings: BridgeActivationWarnings = {
      ...base,
      runtimeWarnings: ["needs shell", "needs browser"],
      hasCapabilityGaps: true,
    };
    const result = buildBridgeWarningPreamble(withWarnings);
    expect(result).toContain("needs shell");
    expect(result).toContain("needs browser");
  });

  it("lists conversion warnings in output", () => {
    const withConv: BridgeActivationWarnings = {
      ...base,
      bucket: "amber",
      conversionWarnings: ["check MCP config"],
    };
    const result = buildBridgeWarningPreamble(withConv);
    expect(result).toContain("check MCP config");
  });

  it("ends with separator line for non-green", () => {
    const amber: BridgeActivationWarnings = { ...base, bucket: "amber" };
    const result = buildBridgeWarningPreamble(amber);
    expect(result).toMatch(/---\n$/);
  });

  it("includes SkillBridge Activation Notice header for non-green", () => {
    const amber: BridgeActivationWarnings = { ...base, bucket: "amber" };
    expect(buildBridgeWarningPreamble(amber)).toContain("SkillBridge Activation Notice");
  });
});

describe("hasBridgeCapabilityGaps", () => {
  it("returns false for empty warnings array", () => {
    expect(hasBridgeCapabilityGaps([])).toBe(false);
  });

  it("returns true for non-empty warnings array", () => {
    expect(hasBridgeCapabilityGaps(["needs shell"])).toBe(true);
  });

  it("returns true for multiple warnings", () => {
    expect(hasBridgeCapabilityGaps(["needs shell", "needs browser", "needs mcp"])).toBe(true);
  });
});

describe("buildWavePrompt with bridgeWarnings", () => {
  it("prepends bridge preamble when bridgeWarnings is amber", () => {
    const waves = parseSkillWaves("## Step 1\nDo something\n\n## Step 2\nDo more");
    const state = createWaveState(waves);
    const warnings: BridgeActivationWarnings = {
      skillName: "test",
      bucket: "amber",
      conversionScore: 0.7,
      runtimeWarnings: ["needs shell"],
      conversionWarnings: [],
      hasCapabilityGaps: true,
    };
    const prompt = buildWavePrompt(state, warnings);
    expect(prompt).toContain("SkillBridge Activation Notice");
  });

  it("no preamble when bridgeWarnings is undefined", () => {
    const waves = parseSkillWaves("## Step 1\nDo something");
    const state = createWaveState(waves);
    const prompt = buildWavePrompt(state);
    expect(prompt).not.toContain("SkillBridge Activation Notice");
  });

  it("no preamble when bridgeWarnings is green with no warnings", () => {
    const waves = parseSkillWaves("## Step 1\nDo something");
    const state = createWaveState(waves);
    const greenWarnings: BridgeActivationWarnings = {
      skillName: "test", bucket: "green", conversionScore: 0.95,
      runtimeWarnings: [], conversionWarnings: [], hasCapabilityGaps: false,
    };
    const prompt = buildWavePrompt(state, greenWarnings);
    expect(prompt).not.toContain("SkillBridge Activation Notice");
  });
});

describe("buildWavePrompt — preamble position and suppression", () => {
  const amberWarnings: BridgeActivationWarnings = {
    skillName: "test-skill",
    bucket: "amber",
    conversionScore: 0.7,
    runtimeWarnings: ["needs shell"],
    conversionWarnings: [],
    hasCapabilityGaps: true,
  };

  it("injects preamble on wave 1 (currentIndex === 0)", () => {
    const waves = parseSkillWaves("## Step 1\nDo something.\n\n## Step 2\nDo more.");
    const state = createWaveState(waves);
    expect(state.currentIndex).toBe(0);
    const prompt = buildWavePrompt(state, amberWarnings);
    expect(prompt).toContain("SkillBridge Activation Notice");
  });

  it("suppresses preamble on wave 2 (currentIndex === 1)", () => {
    const waves = parseSkillWaves("## Step 1\nDo something.\n\n## Step 2\nDo more.");
    const state = createWaveState(waves);
    advanceWave(state); // advance to wave 2
    expect(state.currentIndex).toBe(1);
    const prompt = buildWavePrompt(state, amberWarnings);
    expect(prompt).not.toContain("SkillBridge Activation Notice");
  });

  it("preamble appears AFTER the ## Current Wave: header on wave 1", () => {
    const waves = parseSkillWaves("## Step 1\nDo something.\n\n## Step 2\nDo more.");
    const state = createWaveState(waves);
    const prompt = buildWavePrompt(state, amberWarnings);

    const headerIdx = prompt.indexOf("## Current Wave:");
    const preambleIdx = prompt.indexOf("## SkillBridge Activation Notice");

    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(preambleIdx).toBeGreaterThanOrEqual(0);
    expect(preambleIdx).toBeGreaterThan(headerIdx);
  });
});
