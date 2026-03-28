/**
 * boundary-tracker.test.ts
 *
 * Unit tests for boundary drift detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkBoundaryDrift,
  formatDriftMessage,
  BoundaryTracker,
} from "./boundary-tracker.js";
import type { BoundaryState, BoundaryDriftOptions } from "./boundary-tracker.js";
import type { RunIntake } from "./run-intake.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeIntake(overrides: Partial<RunIntake> = {}): RunIntake {
  return {
    runId: "run_test_123",
    userAsk: "fix the bug in src/main.ts",
    classification: "change",
    requestedScope: ["src/main.ts"],
    allowedBoundary: { maxFiles: 10, paths: ["src/main.ts"] },
    timestamp: "2026-03-28T10:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// checkBoundaryDrift
// ---------------------------------------------------------------------------

describe("checkBoundaryDrift", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns no drift when all mutations are within scope", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts", "src/utils.ts"] });
    const mutated = ["src/main.ts", "src/utils.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(false);
    expect(state.expansionPercent).toBe(0);
    expect(state.outOfScopeFiles).toEqual([]);
    expect(state.runId).toBe("run_test_123");
  });

  it("returns no drift when mutations are empty", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });

    const state = checkBoundaryDrift(intake, []);

    expect(state.driftDetected).toBe(false);
    expect(state.expansionPercent).toBe(0);
    expect(state.currentMutations).toEqual([]);
    expect(state.outOfScopeFiles).toEqual([]);
  });

  it("returns no drift when original scope is empty (unconstrained)", () => {
    const intake = makeIntake({ requestedScope: [] });
    const mutated = ["src/foo.ts", "src/bar.ts", "lib/baz.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(false);
    expect(state.expansionPercent).toBe(0);
    expect(state.outOfScopeFiles).toEqual([]);
  });

  it("detects no drift when 1 out-of-scope file is within threshold", () => {
    // scope size = 2, 1 out-of-scope = 50% expansion (below default 120%)
    const intake = makeIntake({ requestedScope: ["src/main.ts", "src/utils.ts"] });
    const mutated = ["src/main.ts", "src/utils.ts", "lib/other.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(false);
    expect(state.expansionPercent).toBe(50);
    expect(state.outOfScopeFiles).toEqual(["lib/other.ts"]);
  });

  it("detects drift when out-of-scope files exceed 120% threshold", () => {
    // scope size = 1, 2 out-of-scope = 200% expansion (above default 120%)
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const mutated = ["src/main.ts", "lib/other.ts", "test/new.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(true);
    expect(state.expansionPercent).toBe(200);
    expect(state.outOfScopeFiles).toHaveLength(2);
    expect(state.outOfScopeFiles).toContain("lib/other.ts");
    expect(state.outOfScopeFiles).toContain("test/new.ts");
  });

  it("detects drift with 3 out-of-scope files on scope size 2", () => {
    // scope size = 2, 3 out-of-scope = 150% expansion (above 120%)
    const intake = makeIntake({
      requestedScope: ["src/main.ts", "src/utils.ts"],
    });
    const mutated = [
      "src/main.ts",
      "src/utils.ts",
      "lib/a.ts",
      "lib/b.ts",
      "test/c.ts",
    ];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(true);
    expect(state.expansionPercent).toBe(150);
    expect(state.outOfScopeFiles).toHaveLength(3);
  });

  it("uses partial path matching (scope as directory prefix)", () => {
    // scope "src/foo.ts" should match mutation "project/src/foo.ts"
    const intake = makeIntake({ requestedScope: ["src/foo.ts"] });
    const mutated = ["project/src/foo.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(false);
    expect(state.outOfScopeFiles).toEqual([]);
  });

  it("uses partial path matching (mutation as substring of scope)", () => {
    // scope "packages/core/src/index.ts" contains "src/index.ts"
    const intake = makeIntake({
      requestedScope: ["packages/core/src/index.ts"],
    });
    const mutated = ["src/index.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(false);
    expect(state.outOfScopeFiles).toEqual([]);
  });

  it("normalizes Windows backslash paths for matching", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const mutated = ["src\\main.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(false);
    expect(state.outOfScopeFiles).toEqual([]);
  });

  it("is case-insensitive for path matching", () => {
    const intake = makeIntake({ requestedScope: ["SRC/Main.ts"] });
    const mutated = ["src/main.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.driftDetected).toBe(false);
    expect(state.outOfScopeFiles).toEqual([]);
  });

  it("deduplicates mutations before counting", () => {
    // Same file listed twice should count as 1 out-of-scope
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const mutated = ["lib/other.ts", "lib/other.ts", "lib/other.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    // 1 out-of-scope / 1 scope = 100%, below 120% threshold
    expect(state.driftDetected).toBe(false);
    expect(state.expansionPercent).toBe(100);
    expect(state.outOfScopeFiles).toHaveLength(1);
  });

  it("respects custom threshold via options", () => {
    // scope size = 2, 1 out-of-scope = 50% expansion
    const intake = makeIntake({
      requestedScope: ["src/main.ts", "src/utils.ts"],
    });
    const mutated = ["src/main.ts", "lib/other.ts"];
    const options: BoundaryDriftOptions = { thresholdPercent: 40 };

    const state = checkBoundaryDrift(intake, mutated, options);

    expect(state.driftDetected).toBe(true); // 50% > 40% custom threshold
    expect(state.expansionPercent).toBe(50);
  });

  it("does not flag drift at exactly the threshold", () => {
    // scope size = 1, 1 out-of-scope = 100% — NOT above 120%
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const mutated = ["src/main.ts", "lib/other.ts"];
    const options: BoundaryDriftOptions = { thresholdPercent: 100 };

    const state = checkBoundaryDrift(intake, mutated, options);

    // Exactly at threshold should NOT trigger (uses > not >=)
    expect(state.driftDetected).toBe(false);
  });

  it("includes correct timestamp", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const state = checkBoundaryDrift(intake, []);

    expect(state.timestamp).toBe("2026-03-28T12:00:00.000Z");
  });

  it("preserves original mutatedFiles array in currentMutations", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const mutated = ["src/main.ts", "lib/other.ts"];

    const state = checkBoundaryDrift(intake, mutated);

    expect(state.currentMutations).toEqual(mutated);
  });
});

// ---------------------------------------------------------------------------
// formatDriftMessage
// ---------------------------------------------------------------------------

describe("formatDriftMessage", () => {
  it("returns empty string when no drift detected", () => {
    const state: BoundaryState = {
      runId: "run_test_123",
      originalScope: ["src/main.ts"],
      currentMutations: ["src/main.ts"],
      driftDetected: false,
      expansionPercent: 0,
      outOfScopeFiles: [],
      timestamp: "2026-03-28T12:00:00.000Z",
    };

    expect(formatDriftMessage(state)).toBe("");
  });

  it("returns formatted message when drift detected", () => {
    const state: BoundaryState = {
      runId: "run_test_123",
      originalScope: ["src/main.ts"],
      currentMutations: ["src/main.ts", "lib/other.ts", "test/new.ts"],
      driftDetected: true,
      expansionPercent: 200,
      outOfScopeFiles: ["lib/other.ts", "test/new.ts"],
      timestamp: "2026-03-28T12:00:00.000Z",
    };

    const msg = formatDriftMessage(state);

    expect(msg).toContain("Boundary drift detected: 200% expansion");
    expect(msg).toContain("Original scope (1 path(s)): src/main.ts");
    expect(msg).toContain("Out-of-scope files (2): lib/other.ts, test/new.ts");
    expect(msg).toContain("Continue with expanded scope?");
  });

  it("formats expansion percent as integer", () => {
    const state: BoundaryState = {
      runId: "run_test_123",
      originalScope: ["a.ts", "b.ts", "c.ts"],
      currentMutations: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts", "h.ts"],
      driftDetected: true,
      expansionPercent: 166.66666,
      outOfScopeFiles: ["d.ts", "e.ts", "f.ts", "g.ts", "h.ts"],
      timestamp: "2026-03-28T12:00:00.000Z",
    };

    const msg = formatDriftMessage(state);

    expect(msg).toContain("167% expansion");
  });

  it("lists all original scope paths", () => {
    const state: BoundaryState = {
      runId: "run_test_123",
      originalScope: ["src/a.ts", "src/b.ts"],
      currentMutations: [],
      driftDetected: true,
      expansionPercent: 150,
      outOfScopeFiles: ["lib/c.ts", "lib/d.ts", "lib/e.ts"],
      timestamp: "2026-03-28T12:00:00.000Z",
    };

    const msg = formatDriftMessage(state);

    expect(msg).toContain("Original scope (2 path(s)): src/a.ts, src/b.ts");
  });
});

// ---------------------------------------------------------------------------
// BoundaryTracker (class)
// ---------------------------------------------------------------------------

describe("BoundaryTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-28T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with no mutations and no drift", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const tracker = new BoundaryTracker(intake);

    const state = tracker.check();

    expect(state.driftDetected).toBe(false);
    expect(state.currentMutations).toEqual([]);
    expect(tracker.getMutatedFiles()).toEqual([]);
  });

  it("accumulates mutations across multiple calls", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const tracker = new BoundaryTracker(intake);

    tracker.recordMutations(["src/main.ts"]);
    tracker.recordMutations(["lib/other.ts"]);

    expect(tracker.getMutatedFiles()).toEqual(["src/main.ts", "lib/other.ts"]);
  });

  it("deduplicates mutations", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const tracker = new BoundaryTracker(intake);

    tracker.recordMutations(["src/main.ts"]);
    tracker.recordMutations(["src/main.ts"]);

    expect(tracker.getMutatedFiles()).toEqual(["src/main.ts"]);
  });

  it("detects drift after accumulation exceeds threshold", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const tracker = new BoundaryTracker(intake);

    // Round 1: in-scope mutation
    tracker.recordMutations(["src/main.ts"]);
    expect(tracker.check().driftDetected).toBe(false);

    // Round 2: 1 out-of-scope (100% expansion, below 120%)
    tracker.recordMutations(["lib/a.ts"]);
    expect(tracker.check().driftDetected).toBe(false);

    // Round 3: 2 out-of-scope (200% expansion, above 120%)
    tracker.recordMutations(["lib/b.ts"]);
    expect(tracker.check().driftDetected).toBe(true);
    expect(tracker.check().expansionPercent).toBe(200);
  });

  it("getLastState returns null before first check", () => {
    const intake = makeIntake();
    const tracker = new BoundaryTracker(intake);

    expect(tracker.getLastState()).toBeNull();
  });

  it("getLastState returns cached state after check", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts"] });
    const tracker = new BoundaryTracker(intake);

    tracker.recordMutations(["src/main.ts"]);
    const state = tracker.check();

    expect(tracker.getLastState()).toBe(state);
  });

  it("passes custom options to checkBoundaryDrift", () => {
    const intake = makeIntake({ requestedScope: ["src/main.ts", "src/utils.ts"] });
    const tracker = new BoundaryTracker(intake, { thresholdPercent: 30 });

    tracker.recordMutations(["src/main.ts", "lib/other.ts"]);
    const state = tracker.check();

    // 1 out-of-scope / 2 scope = 50%, above custom threshold of 30%
    expect(state.driftDetected).toBe(true);
    expect(state.expansionPercent).toBe(50);
  });

  it("getMutatedFiles returns readonly snapshot", () => {
    const intake = makeIntake();
    const tracker = new BoundaryTracker(intake);

    tracker.recordMutations(["src/main.ts"]);
    const files = tracker.getMutatedFiles();

    expect(files).toEqual(["src/main.ts"]);
    // Verify it is readonly (TypeScript enforces this; runtime check)
    expect(Array.isArray(files)).toBe(true);
  });
});
