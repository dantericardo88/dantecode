import { describe, it, expect } from "vitest";
import { pruneSkills } from "./pruning.js";
import type { Skill } from "./types.js";

const makeSkill = (id: string, section = "coding", trustScore = 0.8, daysOld = 0): Skill => {
  const updatedAt = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000).toISOString();
  return { id, title: id, content: `Content for ${id}`, section, trustScore, createdAt: updatedAt, updatedAt };
};

describe("pruneSkills", () => {
  it("returns all skills when within limits", () => {
    const skills = [makeSkill("s1"), makeSkill("s2")];
    expect(pruneSkills(skills)).toHaveLength(2);
  });

  it("caps per section", () => {
    const skills = Array.from({ length: 5 }, (_, i) => makeSkill(`s${i}`, "coding"));
    const result = pruneSkills(skills, { maxPerSection: 3 });
    const codingCount = result.filter(s => s.section === "coding").length;
    expect(codingCount).toBeLessThanOrEqual(3);
  });

  it("respects global max", () => {
    const skills = Array.from({ length: 10 }, (_, i) => makeSkill(`s${i}`, i % 2 === 0 ? "coding" : "research"));
    const result = pruneSkills(skills, { maxTotal: 5 });
    expect(result).toHaveLength(5);
  });

  it("filters by minTrustScore", () => {
    const skills = [makeSkill("s1", "coding", 0.9), makeSkill("s2", "coding", 0.3)];
    const result = pruneSkills(skills, { minTrustScore: 0.5 });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("s1");
  });

  it("filters by maxAgeDays", () => {
    const fresh = makeSkill("fresh", "coding", 0.8, 0);
    const stale = makeSkill("stale", "coding", 0.8, 100);
    const result = pruneSkills([fresh, stale], { maxAgeDays: 30 });
    expect(result.map(s => s.id)).toContain("fresh");
    expect(result.map(s => s.id)).not.toContain("stale");
  });
});
