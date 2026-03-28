import { describe, expect, it } from "vitest";
import {
  buildApprovalGatewayProfile,
  getModeToolExclusions,
  normalizeApprovalMode,
} from "./approval-modes.js";

describe("approval modes", () => {
  it("normalizes canonical and legacy approval modes", () => {
    expect(normalizeApprovalMode("review")).toBe("review");
    expect(normalizeApprovalMode("default")).toBe("review");
    expect(normalizeApprovalMode("apply")).toBe("apply");
    expect(normalizeApprovalMode("auto-edit")).toBe("apply");
    expect(normalizeApprovalMode("autoforge")).toBe("autoforge");
    expect(normalizeApprovalMode("plan")).toBe("plan");
    expect(normalizeApprovalMode("yolo")).toBe("yolo");
    expect(normalizeApprovalMode(" BUILD ")).toBeNull();
  });

  it("builds plan mode as an auto-deny profile for mutation tools", () => {
    const profile = buildApprovalGatewayProfile("plan");

    expect(profile.enabled).toBe(true);
    expect(profile.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tools: expect.arrayContaining(["Write", "Edit", "Bash", "SubAgent"]),
          decision: "auto_deny",
        }),
      ]),
    );
  });

  describe("getModeToolExclusions", () => {
    it("plan mode excludes all mutation and execution tools", () => {
      const excluded = getModeToolExclusions("plan");
      expect(excluded).toContain("Write");
      expect(excluded).toContain("Edit");
      expect(excluded).toContain("NotebookEdit");
      expect(excluded).toContain("Bash");
      expect(excluded).toContain("GitCommit");
      expect(excluded).toContain("GitPush");
      expect(excluded).toContain("SubAgent");
      expect(excluded).toHaveLength(7);
    });

    it("review mode excludes the same tools as plan mode", () => {
      const excluded = getModeToolExclusions("review");
      expect(excluded).toEqual(getModeToolExclusions("plan"));
    });

    it("apply mode returns empty array — all tools allowed", () => {
      expect(getModeToolExclusions("apply")).toEqual([]);
    });

    it("autoforge mode returns empty array — all tools allowed", () => {
      expect(getModeToolExclusions("autoforge")).toEqual([]);
    });

    it("yolo mode returns empty array — all tools allowed", () => {
      expect(getModeToolExclusions("yolo")).toEqual([]);
    });

    it("plan exclusions do not include read-only tools", () => {
      const excluded = getModeToolExclusions("plan");
      expect(excluded).not.toContain("Read");
      expect(excluded).not.toContain("Glob");
      expect(excluded).not.toContain("Grep");
      expect(excluded).not.toContain("WebSearch");
      expect(excluded).not.toContain("WebFetch");
      expect(excluded).not.toContain("TodoWrite");
      expect(excluded).not.toContain("GitHubSearch");
      expect(excluded).not.toContain("GitHubOps");
      expect(excluded).not.toContain("AskUser");
      expect(excluded).not.toContain("Memory");
    });
  });

  it("builds apply and autoforge profiles that still gate shell and subagents", () => {
    const applyProfile = buildApprovalGatewayProfile("apply");
    const autoforgeProfile = buildApprovalGatewayProfile("autoforge");

    expect(applyProfile.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tools: expect.arrayContaining(["Bash", "GitCommit", "GitPush", "SubAgent"]),
          decision: "requires_approval",
        }),
      ]),
    );
    expect(autoforgeProfile.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tools: expect.arrayContaining(["Bash", "GitCommit", "GitPush", "SubAgent"]),
          decision: "requires_approval",
        }),
      ]),
    );
  });
});
