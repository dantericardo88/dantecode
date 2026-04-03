import { describe, it, expect, beforeEach } from "vitest";
import {
  VerificationRailRegistry,
  evaluateRail,
  globalVerificationRailRegistry,
} from "./rails-enforcer.js";
import type { VerificationRail } from "./rails-enforcer.js";

describe("VerificationRailRegistry — Core Operations", () => {
  let registry: VerificationRailRegistry;

  beforeEach(() => {
    registry = new VerificationRailRegistry();
  });

  it("adds and lists rails", () => {
    registry.addRail({
      id: "rail-1",
      name: "Completeness Check",
      requiredSubstrings: ["Summary", "Conclusion"],
    });
    const rails = registry.listRails();
    expect(rails).toHaveLength(1);
    expect(rails[0]!.name).toBe("Completeness Check");
  });

  it("defaults mode to 'hard' when not specified", () => {
    const rail = registry.addRail({
      id: "rail-default-mode",
      name: "Default Mode Rail",
    });
    expect(rail.mode).toBe("hard");
  });

  it("preserves 'soft' mode when specified", () => {
    const rail = registry.addRail({
      id: "rail-soft",
      name: "Soft Rail",
      mode: "soft",
    });
    expect(rail.mode).toBe("soft");
  });

  it("clears all rails", () => {
    registry.addRail({ id: "rail-a", name: "Rail A" });
    registry.addRail({ id: "rail-b", name: "Rail B" });
    expect(registry.listRails()).toHaveLength(2);
    registry.clear();
    expect(registry.listRails()).toHaveLength(0);
  });

  it("overwrites rail with same ID", () => {
    registry.addRail({ id: "rail-overwrite", name: "Original" });
    registry.addRail({ id: "rail-overwrite", name: "Updated" });
    const rails = registry.listRails();
    expect(rails).toHaveLength(1);
    expect(rails[0]!.name).toBe("Updated");
  });

  it("returns deep copies from listRails (mutations do not affect registry)", () => {
    registry.addRail({
      id: "rail-copy",
      name: "Copy Test",
      requiredSubstrings: ["original"],
    });
    const listed = registry.listRails();
    listed[0]!.requiredSubstrings!.push("mutated");
    const fresh = registry.listRails();
    expect(fresh[0]!.requiredSubstrings).toEqual(["original"]);
  });
});

describe("evaluateRail — Individual Rail Evaluation", () => {
  it("passes when all required substrings are present", () => {
    const rail: VerificationRail = {
      id: "rail-pass",
      name: "Pass Rail",
      requiredSubstrings: ["Summary", "Details"],
    };
    const finding = evaluateRail(rail, "Summary of the work. Details are below.");
    expect(finding.passed).toBe(true);
    expect(finding.violations).toHaveLength(0);
  });

  it("fails when required substring is missing", () => {
    const rail: VerificationRail = {
      id: "rail-missing",
      name: "Missing Content",
      requiredSubstrings: ["Conclusion"],
    };
    const finding = evaluateRail(rail, "Summary without the required section.");
    expect(finding.passed).toBe(false);
    expect(finding.violations.some((v) => v.includes("Conclusion"))).toBe(true);
  });

  it("fails when forbidden pattern is present", () => {
    const rail: VerificationRail = {
      id: "rail-forbidden",
      name: "No Placeholders",
      forbiddenPatterns: ["TODO"],
    };
    const finding = evaluateRail(rail, "Content with TODO: finish later");
    expect(finding.passed).toBe(false);
    expect(finding.violations.some((v) => v.includes("TODO"))).toBe(true);
  });

  it("fails when output is below minimum length", () => {
    const rail: VerificationRail = {
      id: "rail-minlen",
      name: "Min Length",
      minLength: 100,
    };
    const finding = evaluateRail(rail, "Short output.");
    expect(finding.passed).toBe(false);
    expect(finding.violations.some((v) => v.includes("below minimum"))).toBe(true);
  });

  it("fails when output exceeds maximum length", () => {
    const rail: VerificationRail = {
      id: "rail-maxlen",
      name: "Max Length",
      maxLength: 10,
    };
    const finding = evaluateRail(rail, "This output is longer than ten characters.");
    expect(finding.passed).toBe(false);
    expect(finding.violations.some((v) => v.includes("exceeds maximum"))).toBe(true);
  });

  it("is case-insensitive for required substrings", () => {
    const rail: VerificationRail = {
      id: "rail-case",
      name: "Case Test",
      requiredSubstrings: ["SUMMARY"],
    };
    const finding = evaluateRail(rail, "Here is a summary of findings.");
    expect(finding.passed).toBe(true);
  });

  it("is case-insensitive for forbidden patterns", () => {
    const rail: VerificationRail = {
      id: "rail-case-forbidden",
      name: "Case Forbidden",
      forbiddenPatterns: ["fixme"],
    };
    const finding = evaluateRail(rail, "This has a FIXME note");
    expect(finding.passed).toBe(false);
  });

  it("collects multiple violations", () => {
    const rail: VerificationRail = {
      id: "rail-multi",
      name: "Multi Check",
      requiredSubstrings: ["Summary", "Conclusion"],
      forbiddenPatterns: ["TODO"],
      minLength: 1000,
    };
    const finding = evaluateRail(rail, "TODO: write content");
    expect(finding.passed).toBe(false);
    expect(finding.violations.length).toBeGreaterThanOrEqual(3);
  });

  it("returns correct railId and railName", () => {
    const rail: VerificationRail = {
      id: "rail-meta",
      name: "Metadata Check",
    };
    const finding = evaluateRail(rail, "any output");
    expect(finding.railId).toBe("rail-meta");
    expect(finding.railName).toBe("Metadata Check");
  });
});

describe("VerificationRailRegistry — evaluate method", () => {
  it("evaluates all registered rails against output", () => {
    const registry = new VerificationRailRegistry();
    registry.addRail({
      id: "r1",
      name: "Has Summary",
      requiredSubstrings: ["Summary"],
    });
    registry.addRail({
      id: "r2",
      name: "No TODO",
      forbiddenPatterns: ["TODO"],
    });

    const findings = registry.evaluate("task description", "Summary: done. No issues.");
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.passed)).toBe(true);
  });

  it("accepts custom rail list for evaluation", () => {
    const registry = new VerificationRailRegistry();
    const customRails: VerificationRail[] = [
      { id: "custom-1", name: "Custom", requiredSubstrings: ["Required"] },
    ];
    const findings = registry.evaluate("task", "Has Required content", customRails);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.passed).toBe(true);
  });
});

describe("globalVerificationRailRegistry", () => {
  beforeEach(() => {
    globalVerificationRailRegistry.clear();
  });

  it("is a singleton instance", () => {
    globalVerificationRailRegistry.addRail({ id: "global-1", name: "Global Rail" });
    expect(globalVerificationRailRegistry.listRails()).toHaveLength(1);
  });
});
