import { describe, it, expect, beforeEach } from "vitest";
import { DanteSkillbook } from "./skillbook.js";
import type { UpdateOperation, Skill } from "./types.js";

const makeSkill = (overrides?: Partial<Skill>): Skill => ({
  id: "skill-1",
  title: "Test Skill",
  content: "Do X when Y.",
  section: "coding",
  trustScore: 0.9,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("DanteSkillbook", () => {
  let book: DanteSkillbook;

  beforeEach(() => {
    book = new DanteSkillbook();
  });

  it("starts empty", () => {
    expect(book.getSkills()).toHaveLength(0);
    expect(book.stats().totalSkills).toBe(0);
  });

  it("adds a skill on pass decision", () => {
    const skill = makeSkill({ id: "s1" });
    const op: UpdateOperation = { action: "add", candidateSkill: skill, rationale: "useful" };
    const applied = book.applyUpdate(op, "pass");
    expect(applied).toBe(true);
    expect(book.getSkills()).toHaveLength(1);
    expect(book.stats().totalSkills).toBe(1);
    expect(book.stats().sections["coding"]).toBe(1);
  });

  it("rejects add on fail decision", () => {
    const skill = makeSkill();
    const op: UpdateOperation = { action: "add", candidateSkill: skill, rationale: "x" };
    const applied = book.applyUpdate(op, "fail");
    expect(applied).toBe(false);
    expect(book.getSkills()).toHaveLength(0);
  });

  it("rejects add on review-required decision", () => {
    const skill = makeSkill();
    const op: UpdateOperation = { action: "add", candidateSkill: skill, rationale: "x" };
    const applied = book.applyUpdate(op, "review-required");
    expect(applied).toBe(false);
  });

  it("refines an existing skill", () => {
    book.applyUpdate({ action: "add", candidateSkill: makeSkill({ id: "s1" }), rationale: "init" }, "pass");
    const refined = makeSkill({ id: "s1", content: "Improved content." });
    book.applyUpdate({ action: "refine", targetSkillId: "s1", candidateSkill: refined, rationale: "better" }, "pass");
    expect(book.findById("s1")?.content).toBe("Improved content.");
  });

  it("removes a skill", () => {
    book.applyUpdate({ action: "add", candidateSkill: makeSkill({ id: "s1" }), rationale: "init" }, "pass");
    book.applyUpdate({ action: "remove", targetSkillId: "s1", rationale: "stale" }, "pass");
    expect(book.getSkills()).toHaveLength(0);
  });

  it("merges skill content", () => {
    book.applyUpdate({ action: "add", candidateSkill: makeSkill({ id: "s1", content: "Part A." }), rationale: "init" }, "pass");
    book.applyUpdate({ action: "merge", targetSkillId: "s1", candidateSkill: makeSkill({ content: "Part B." }), rationale: "merge" }, "pass");
    expect(book.findById("s1")?.content).toContain("Part A.");
    expect(book.findById("s1")?.content).toContain("Part B.");
  });

  it("reject action returns false without mutation", () => {
    book.applyUpdate({ action: "add", candidateSkill: makeSkill({ id: "s1" }), rationale: "init" }, "pass");
    const result = book.applyUpdate({ action: "reject", rationale: "bad" }, "pass");
    expect(result).toBe(false);
    expect(book.getSkills()).toHaveLength(1); // unchanged
  });

  it("getData returns a copy", () => {
    const data = book.getData();
    data.skills.push(makeSkill());
    expect(book.getSkills()).toHaveLength(0);
  });

  it("_replaceSkills updates internal state", () => {
    const skills = [makeSkill({ id: "s1" }), makeSkill({ id: "s2", section: "research" })];
    book._replaceSkills(skills);
    expect(book.stats().totalSkills).toBe(2);
    expect(book.stats().sections["research"]).toBe(1);
  });
});
