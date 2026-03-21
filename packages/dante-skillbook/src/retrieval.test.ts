import { describe, it, expect } from "vitest";
import { getRelevantSkills, scoreSkill } from "./retrieval.js";
import type { Skill, TaskContext } from "./types.js";

const makeSkill = (
  overrides: Partial<Skill> & Pick<Skill, "id" | "title" | "content" | "section">,
): Skill => ({
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("getRelevantSkills", () => {
  const skills: Skill[] = [
    makeSkill({
      id: "s1",
      title: "TypeScript null checks",
      content: "Always add null checks",
      section: "coding",
    }),
    makeSkill({ id: "s2", title: "Async patterns", content: "Use async/await", section: "coding" }),
    makeSkill({
      id: "s3",
      title: "Research strategies",
      content: "Use multiple sources",
      section: "research",
    }),
  ];

  it("returns top-K skills by relevance", () => {
    const result = getRelevantSkills(skills, { keywords: ["null", "typescript"] }, 2);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("s1");
  });

  it("returns by recency when no context", () => {
    const result = getRelevantSkills(skills, {}, 2);
    expect(result).toHaveLength(2);
  });

  it("respects limit", () => {
    const result = getRelevantSkills(skills, { keywords: ["coding"] }, 1);
    expect(result).toHaveLength(1);
  });

  it("returns empty for zero-score matches", () => {
    const result = getRelevantSkills(skills, { keywords: ["zzz-no-match-xyz"] }, 5);
    expect(result).toHaveLength(0);
  });
});

describe("scoreSkill", () => {
  it("scores higher with matching keywords", () => {
    const skill = makeSkill({
      id: "s1",
      title: "TypeScript types",
      content: "Always use strict types",
      section: "coding",
    });
    const score = scoreSkill(skill, { taskType: "coding" }, ["typescript", "types"]);
    expect(score).toBeGreaterThan(0);
  });

  it("trust score boosts result", () => {
    const low = makeSkill({
      id: "s1",
      title: "X",
      content: "do X",
      section: "coding",
      trustScore: 0.1,
    });
    const high = makeSkill({
      id: "s2",
      title: "X",
      content: "do X",
      section: "coding",
      trustScore: 1.0,
    });
    const ctx: TaskContext = { taskType: "coding" };
    expect(scoreSkill(high, ctx, ["x", "do"])).toBeGreaterThan(scoreSkill(low, ctx, ["x", "do"]));
  });
});
