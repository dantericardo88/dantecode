import { describe, it, expect } from "vitest";
import { computeStats } from "./stats.js";
import type { Skill } from "./types.js";

const makeSkill = (id: string, section: string): Skill => ({
  id,
  title: id,
  content: "Content",
  section,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("computeStats", () => {
  it("empty skillbook", () => {
    const stats = computeStats([]);
    expect(stats.totalSkills).toBe(0);
    expect(stats.sections).toEqual({});
    expect(stats.lastUpdatedAt).toBeUndefined();
  });

  it("counts by section", () => {
    const skills = [makeSkill("s1", "coding"), makeSkill("s2", "coding"), makeSkill("s3", "research")];
    const stats = computeStats(skills);
    expect(stats.totalSkills).toBe(3);
    expect(stats.sections.coding).toBe(2);
    expect(stats.sections.research).toBe(1);
  });

  it("tracks lastUpdatedAt", () => {
    const older = { ...makeSkill("s1", "coding"), updatedAt: "2026-01-01T00:00:00.000Z" };
    const newer = { ...makeSkill("s2", "coding"), updatedAt: "2026-06-01T00:00:00.000Z" };
    const stats = computeStats([older, newer]);
    expect(stats.lastUpdatedAt).toBe("2026-06-01T00:00:00.000Z");
  });
});
