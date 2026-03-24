import { describe, it, expect } from "vitest";
import { isPlanModeBlocked, planModeBlockedMessage } from "./plan-mode-guard.js";

describe("plan-mode-guard", () => {
  describe("isPlanModeBlocked", () => {
    it("allows Read", () => {
      expect(isPlanModeBlocked("Read")).toBe(false);
    });
    it("allows Glob", () => {
      expect(isPlanModeBlocked("Glob")).toBe(false);
    });
    it("allows Grep", () => {
      expect(isPlanModeBlocked("Grep")).toBe(false);
    });
    it("allows WebSearch", () => {
      expect(isPlanModeBlocked("WebSearch")).toBe(false);
    });
    it("allows WebFetch", () => {
      expect(isPlanModeBlocked("WebFetch")).toBe(false);
    });
    it("allows TodoWrite", () => {
      expect(isPlanModeBlocked("TodoWrite")).toBe(false);
    });
    it("allows SubAgent", () => {
      expect(isPlanModeBlocked("SubAgent")).toBe(false);
    });
    it("blocks Write", () => {
      expect(isPlanModeBlocked("Write")).toBe(true);
    });
    it("blocks Edit", () => {
      expect(isPlanModeBlocked("Edit")).toBe(true);
    });
    it("blocks Bash", () => {
      expect(isPlanModeBlocked("Bash")).toBe(true);
    });
    it("blocks GitCommit", () => {
      expect(isPlanModeBlocked("GitCommit")).toBe(true);
    });
    it("blocks GitPush", () => {
      expect(isPlanModeBlocked("GitPush")).toBe(true);
    });
  });

  describe("planModeBlockedMessage", () => {
    it("includes the tool name", () => {
      const msg = planModeBlockedMessage("Bash");
      expect(msg).toContain("Bash");
      expect(msg).toContain("PLAN MODE ACTIVE");
    });
  });
});
