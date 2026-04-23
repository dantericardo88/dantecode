import { describe, expect, it } from "vitest";

import {
  evaluateEmptyResponseRound,
  getAutoContinuationRefill,
  getInitialRoundBudget,
  shouldAutoContinueBudget,
} from "./loop-safety.js";

describe("loop-safety", () => {
  describe("getInitialRoundBudget", () => {
    it("uses requiredRounds when it exceeds the default floor", () => {
      expect(getInitialRoundBudget({ requiredRounds: 20, skillActive: false })).toBe(20);
    });

    it("enforces a minimum of 15 rounds when requiredRounds is lower", () => {
      expect(getInitialRoundBudget({ requiredRounds: 5, skillActive: false })).toBe(15);
    });

    it("elevates the default budget to 50 when a skill is active", () => {
      expect(getInitialRoundBudget({ skillActive: true })).toBe(50);
    });
  });

  describe("shouldAutoContinueBudget", () => {
    it("allows auto-continuation only for pipeline workflows near budget exhaustion", () => {
      expect(
        shouldAutoContinueBudget({
          remainingRounds: 1,
          isPipelineWorkflow: true,
          autoContinuations: 0,
          maxAutoContinuations: 3,
          filesModified: 1,
        }),
      ).toBe(true);
    });

    it("blocks auto-continuation when no files have been modified", () => {
      expect(
        shouldAutoContinueBudget({
          remainingRounds: 1,
          isPipelineWorkflow: true,
          autoContinuations: 0,
          maxAutoContinuations: 3,
          filesModified: 0,
        }),
      ).toBe(false);
    });
  });

  describe("getAutoContinuationRefill", () => {
    it("refills more aggressively for active skills", () => {
      expect(getAutoContinuationRefill({ skillActive: true })).toBe(50);
      expect(getAutoContinuationRefill({ skillActive: false })).toBe(15);
    });
  });

  describe("evaluateEmptyResponseRound", () => {
    it("increments the empty counter and requests a warning when text and tool calls are empty", () => {
      expect(
        evaluateEmptyResponseRound({
          responseText: "   ",
          toolCallCount: 0,
          consecutiveEmptyRounds: 1,
          maxConsecutiveEmptyRounds: 3,
        }),
      ).toEqual({
        nextConsecutiveEmptyRounds: 2,
        shouldAbort: false,
        shouldWarn: true,
      });
    });

    it("aborts once the empty response threshold is reached", () => {
      expect(
        evaluateEmptyResponseRound({
          responseText: "",
          toolCallCount: 0,
          consecutiveEmptyRounds: 2,
          maxConsecutiveEmptyRounds: 3,
        }),
      ).toEqual({
        nextConsecutiveEmptyRounds: 3,
        shouldAbort: true,
        shouldWarn: true,
      });
    });

    it("resets the counter when tool calls are present", () => {
      expect(
        evaluateEmptyResponseRound({
          responseText: "",
          toolCallCount: 1,
          consecutiveEmptyRounds: 2,
          maxConsecutiveEmptyRounds: 3,
        }),
      ).toEqual({
        nextConsecutiveEmptyRounds: 0,
        shouldAbort: false,
        shouldWarn: false,
      });
    });
  });
});
