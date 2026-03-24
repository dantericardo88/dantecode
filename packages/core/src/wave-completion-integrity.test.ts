import { describe, it, expect } from "vitest";
import { isValidWaveCompletion, isWaveComplete } from "./skill-wave-orchestrator.js";

describe("wave-completion-integrity", () => {
  describe("isValidWaveCompletion", () => {
    it("returns true when [WAVE COMPLETE] is at the end of the response", () => {
      expect(isValidWaveCompletion("All tasks done. [WAVE COMPLETE]")).toBe(true);
    });

    it("returns true when [WAVE COMPLETE] has short closing remarks after it", () => {
      expect(
        isValidWaveCompletion("All tasks done. [WAVE COMPLETE]\n\nMoving on to the next wave."),
      ).toBe(true);
    });

    it("returns false when [WAVE COMPLETE] appears mid-response with substantial content after", () => {
      const longContent = "a".repeat(300);
      expect(
        isValidWaveCompletion(`Thinking about this... [WAVE COMPLETE] but actually I need to do more work. ${longContent}`),
      ).toBe(false);
    });

    it("returns false when there is no [WAVE COMPLETE] signal", () => {
      expect(isValidWaveCompletion("I have finished all the tasks.")).toBe(false);
    });

    it("is case-insensitive", () => {
      expect(isValidWaveCompletion("Done. [wave complete]")).toBe(true);
      expect(isValidWaveCompletion("Done. [Wave Complete]")).toBe(true);
    });

    it("allows whitespace variants in the signal", () => {
      expect(isValidWaveCompletion("Done. [WAVE  COMPLETE]")).toBe(true);
    });
  });

  describe("isWaveComplete (original, for comparison)", () => {
    it("returns true even when signal is mid-response", () => {
      const longContent = "a".repeat(300);
      // isWaveComplete doesn't validate terminal position
      expect(isWaveComplete(`[WAVE COMPLETE] ${longContent}`)).toBe(true);
    });
  });
});
