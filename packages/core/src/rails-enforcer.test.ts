import { beforeEach, describe, expect, it } from "vitest";
import { VerificationRailRegistry, globalVerificationRailRegistry } from "./rails-enforcer.js";

describe("VerificationRailRegistry", () => {
  beforeEach(() => {
    globalVerificationRailRegistry.clear();
  });

  it("stores rails and evaluates violations", () => {
    const registry = new VerificationRailRegistry();
    registry.addRail({
      id: "rail-summary",
      name: "Summary required",
      requiredSubstrings: ["Summary"],
      forbiddenPatterns: ["TODO"],
    });

    const findings = registry.evaluate("Write release notes", "TODO: later");

    expect(findings).toHaveLength(1);
    expect(findings[0]?.passed).toBe(false);
    expect(findings[0]?.violations.join(" ")).toContain("Summary");
    expect(findings[0]?.violations.join(" ")).toContain("TODO");
  });

  it("supports global add/list/clear operations", () => {
    globalVerificationRailRegistry.addRail({
      id: "rail-1",
      name: "Has heading",
      requiredSubstrings: ["Heading"],
      mode: "soft",
    });

    expect(globalVerificationRailRegistry.listRails()).toHaveLength(1);
    globalVerificationRailRegistry.clear();
    expect(globalVerificationRailRegistry.listRails()).toEqual([]);
  });
});
