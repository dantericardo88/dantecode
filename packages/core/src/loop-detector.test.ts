// ============================================================================
// @dantecode/core — Loop Detector Tests
// Tests for CrewAI-inspired stuck-loop detection with action fingerprinting.
// Covers: max iterations, identical consecutive, cyclic patterns, exceptions.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { LoopDetector, fingerprintAction } from "./loop-detector.js";

describe("LoopDetector", () => {
  let detector: LoopDetector;

  beforeEach(() => {
    detector = new LoopDetector({
      maxIterations: 10,
      identicalThreshold: 3,
      patternWindowSize: 10,
      minCycleLength: 2,
      maxCycleLength: 4,
    });
  });

  // --------------------------------------------------------------------------
  // Max iterations (CrewAI-style ceiling)
  // --------------------------------------------------------------------------

  describe("max iterations", () => {
    it("triggers stuck after reaching max iterations", () => {
      for (let i = 0; i < 9; i++) {
        const result = detector.recordAction("tool_call", `action_${i}`);
        expect(result.stuck).toBe(false);
      }

      const result = detector.recordAction("tool_call", "action_9");
      expect(result.stuck).toBe(true);
      expect(result.reason).toBe("max_iterations");
      expect(result.iterationCount).toBe(10);
    });

    it("does not trigger before max iterations", () => {
      for (let i = 0; i < 9; i++) {
        const result = detector.recordAction("tool_call", `unique_action_${i}`);
        expect(result.stuck).toBe(false);
      }
    });

    it("uses default max iterations of 25", () => {
      const defaultDetector = new LoopDetector();
      expect(defaultDetector.getMaxIterations()).toBe(25);
    });
  });

  // --------------------------------------------------------------------------
  // Identical consecutive actions
  // --------------------------------------------------------------------------

  describe("identical consecutive actions", () => {
    it("detects 3 identical consecutive actions", () => {
      detector.recordAction("tool_call", "git status");
      detector.recordAction("tool_call", "git status");
      const result = detector.recordAction("tool_call", "git status");

      expect(result.stuck).toBe(true);
      expect(result.reason).toBe("identical_consecutive");
      expect(result.consecutiveRepeats).toBe(3);
    });

    it("does not trigger for 2 identical actions (below threshold)", () => {
      detector.recordAction("tool_call", "git status");
      const result = detector.recordAction("tool_call", "git status");

      expect(result.stuck).toBe(false);
      expect(result.consecutiveRepeats).toBe(2);
    });

    it("resets consecutive count when different action occurs", () => {
      detector.recordAction("tool_call", "git status");
      detector.recordAction("tool_call", "git status");
      detector.recordAction("edit", "change file");
      const result = detector.recordAction("tool_call", "git status");

      expect(result.stuck).toBe(false);
      expect(result.consecutiveRepeats).toBe(1);
    });

    it("exempts allowed repeat types", () => {
      // "continue" and "empty" are allowed by default
      detector.recordAction("continue", "continue");
      detector.recordAction("continue", "continue");
      const result = detector.recordAction("continue", "continue");

      expect(result.stuck).toBe(false);
    });

    it("normalizes content for fingerprinting", () => {
      // Different line numbers but same semantic content should match
      detector.recordAction("tool_call", "Error at line 42: type mismatch");
      detector.recordAction("tool_call", "Error at line 99: type mismatch");
      const result = detector.recordAction("tool_call", "Error at line 7: type mismatch");

      // All three have same fingerprint because numbers are normalized
      expect(result.stuck).toBe(true);
      expect(result.reason).toBe("identical_consecutive");
    });
  });

  // --------------------------------------------------------------------------
  // Cyclic pattern detection
  // --------------------------------------------------------------------------

  describe("cyclic pattern detection", () => {
    it("detects ABAB cycle (length 2)", () => {
      detector.recordAction("edit", "fix code");
      detector.recordAction("bash", "npm test");
      detector.recordAction("edit", "fix code");
      const result = detector.recordAction("bash", "npm test");

      expect(result.stuck).toBe(true);
      expect(result.reason).toBe("cyclic_pattern");
      expect(result.details).toContain("length 2");
    });

    it("detects ABCABC cycle (length 3)", () => {
      detector.recordAction("edit", "fix A");
      detector.recordAction("bash", "build");
      detector.recordAction("tool_call", "lint");
      detector.recordAction("edit", "fix A");
      detector.recordAction("bash", "build");
      const result = detector.recordAction("tool_call", "lint");

      expect(result.stuck).toBe(true);
      expect(result.reason).toBe("cyclic_pattern");
    });

    it("does not trigger for non-repeating patterns", () => {
      detector.recordAction("edit", "fix A");
      detector.recordAction("bash", "build");
      detector.recordAction("edit", "fix B");
      const result = detector.recordAction("bash", "test");

      expect(result.stuck).toBe(false);
    });

    it("requires at least 2 full repetitions", () => {
      // Only 1 repetition of AB — not enough
      detector.recordAction("edit", "fix");
      const result = detector.recordAction("bash", "test");

      expect(result.stuck).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Reset and state management
  // --------------------------------------------------------------------------

  describe("reset and state", () => {
    it("resets all state", () => {
      detector.recordAction("tool_call", "action");
      detector.recordAction("tool_call", "action");
      detector.reset();

      expect(detector.getIterationCount()).toBe(0);
      expect(detector.getActionHistory().length).toBe(0);
    });

    it("allows new detection after reset", () => {
      // Fill up to near max
      for (let i = 0; i < 9; i++) {
        detector.recordAction("tool_call", `action_${i}`);
      }

      detector.reset();

      const result = detector.recordAction("tool_call", "fresh_action");
      expect(result.stuck).toBe(false);
      expect(result.iterationCount).toBe(1);
    });

    it("returns iteration count", () => {
      detector.recordAction("a", "1");
      detector.recordAction("b", "2");
      expect(detector.getIterationCount()).toBe(2);
    });

    it("returns action history", () => {
      detector.recordAction("edit", "content A");
      detector.recordAction("bash", "npm test");

      const history = detector.getActionHistory();
      expect(history.length).toBe(2);
      expect(history[0]!.type).toBe("edit");
      expect(history[1]!.type).toBe("bash");
    });

    it("truncates action content to 500 chars", () => {
      const longContent = "x".repeat(1000);
      detector.recordAction("edit", longContent);

      const history = detector.getActionHistory();
      expect(history[0]!.content.length).toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // Priority: identical > cyclic > max_iterations
  // --------------------------------------------------------------------------

  describe("detection priority", () => {
    it("identical consecutive takes priority over cyclic", () => {
      // AAA pattern — both identical consecutive (3x A) and could be cyclic
      detector.recordAction("tool_call", "same action");
      detector.recordAction("tool_call", "same action");
      const result = detector.recordAction("tool_call", "same action");

      expect(result.stuck).toBe(true);
      expect(result.reason).toBe("identical_consecutive");
    });
  });

  // --------------------------------------------------------------------------
  // fingerprintAction utility
  // --------------------------------------------------------------------------

  describe("fingerprintAction", () => {
    it("produces consistent fingerprints", () => {
      const fp1 = fingerprintAction("edit", "fix the bug");
      const fp2 = fingerprintAction("edit", "fix the bug");
      expect(fp1).toBe(fp2);
    });

    it("normalizes whitespace", () => {
      const fp1 = fingerprintAction("edit", "fix   the    bug");
      const fp2 = fingerprintAction("edit", "fix the bug");
      expect(fp1).toBe(fp2);
    });

    it("normalizes numbers", () => {
      const fp1 = fingerprintAction("error", "line 42 col 10");
      const fp2 = fingerprintAction("error", "line 99 col 5");
      expect(fp1).toBe(fp2);
    });

    it("normalizes case", () => {
      const fp1 = fingerprintAction("edit", "Fix The Bug");
      const fp2 = fingerprintAction("edit", "fix the bug");
      expect(fp1).toBe(fp2);
    });

    it("differentiates by type", () => {
      const fp1 = fingerprintAction("edit", "content");
      const fp2 = fingerprintAction("bash", "content");
      expect(fp1).not.toBe(fp2);
    });

    it("produces 16-char hex fingerprints", () => {
      const fp = fingerprintAction("tool_call", "some action");
      expect(fp.length).toBe(16);
      expect(/^[0-9a-f]+$/.test(fp)).toBe(true);
    });
  });
});
