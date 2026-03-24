import { describe, it, expect } from "vitest";
import { SkillVersionManager } from "./skill-version-manager.js";

const NOW = 1_700_000_000_000;

describe("SkillVersionManager", () => {
  it("bumps semver correctly for major/minor/patch", () => {
    const manager = new SkillVersionManager();
    expect(manager.bumpVersion("1.2.3", "major")).toBe("2.0.0");
    expect(manager.bumpVersion("1.2.3", "minor")).toBe("1.3.0");
    expect(manager.bumpVersion("1.2.3", "patch")).toBe("1.2.4");
    expect(manager.bumpVersion("0.0.0", "patch")).toBe("0.0.1");
  });

  it("detects breaking changes when exports are removed", () => {
    const manager = new SkillVersionManager();
    const oldExports = ["ClassA", "ClassB", "functionC"];
    const newExports = ["ClassA", "functionC"]; // ClassB removed
    expect(manager.detectBreakingChange(oldExports, newExports)).toBe(true);
  });

  it("no breaking change when exports are added or unchanged", () => {
    const manager = new SkillVersionManager();
    const oldExports = ["ClassA", "ClassB"];
    const newExportsAdded = ["ClassA", "ClassB", "ClassC"];
    expect(manager.detectBreakingChange(oldExports, newExportsAdded)).toBe(false);

    const unchanged = ["ClassA", "ClassB"];
    expect(manager.detectBreakingChange(oldExports, unchanged)).toBe(false);
  });

  it("tracks version history with addVersion", () => {
    const manager = new SkillVersionManager({ nowFn: () => NOW });
    manager.addVersion("skill-1", "1.0.0", { config: "v1" });
    manager.addVersion("skill-1", "1.1.0", { config: "v1.1" });
    manager.addVersion("skill-1", "1.2.0", { config: "v1.2" });

    const history = manager.getHistory("skill-1");
    expect(history.length).toBe(3);
    expect(history[0]!.version).toBe("1.0.0");
    expect(history[2]!.version).toBe("1.2.0");
    expect(history[1]!.changeType).toBe("minor");
  });

  it("rollback restores previous version and removes current", () => {
    const manager = new SkillVersionManager({ nowFn: () => NOW });
    manager.addVersion("skill-1", "1.0.0", { state: "original" });
    manager.addVersion("skill-1", "2.0.0", { state: "breaking" });

    const rolledBack = manager.rollback("skill-1");
    expect(rolledBack).not.toBeNull();
    expect(rolledBack!.version).toBe("1.0.0");
    expect(rolledBack!.snapshot).toEqual({ state: "original" });

    // History should only have 1 entry now
    const history = manager.getHistory("skill-1");
    expect(history.length).toBe(1);
    expect(manager.getLatestVersion("skill-1")).toBe("1.0.0");
  });

  it("rollback returns null when no previous version exists", () => {
    const manager = new SkillVersionManager();
    expect(manager.rollback("nonexistent")).toBeNull();

    manager.addVersion("skill-1", "1.0.0", {});
    expect(manager.rollback("skill-1")).toBeNull(); // only 1 version
  });

  it("getHistory returns empty array for unknown skill", () => {
    const manager = new SkillVersionManager();
    expect(manager.getHistory("unknown")).toEqual([]);
    expect(manager.getLatestVersion("unknown")).toBeNull();
  });
});
