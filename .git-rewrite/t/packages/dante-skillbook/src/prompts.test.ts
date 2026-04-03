import { describe, it, expect } from "vitest";
import {
  formatSkillsBlock,
  buildAgentPrompt,
  buildReflectorPrompt,
  buildSkillManagerPrompt,
  AGENT_SYSTEM_PROMPT,
  REFLECTOR_SYSTEM_PROMPT,
  SKILL_MANAGER_SYSTEM_PROMPT,
} from "./prompts.js";
import type { Skill } from "./types.js";

const makeSkill = (overrides?: Partial<Skill>): Skill => ({
  id: "s1",
  title: "Test Skill",
  content: "Do X when Y.",
  section: "coding",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("formatSkillsBlock", () => {
  it("returns empty string for no skills", () => {
    expect(formatSkillsBlock([])).toBe("");
  });

  it("includes skill title and content", () => {
    const block = formatSkillsBlock([makeSkill()]);
    expect(block).toContain("Test Skill");
    expect(block).toContain("Do X when Y.");
    expect(block).toContain("DanteSkillbook");
  });
});

describe("buildAgentPrompt", () => {
  it("includes task", () => {
    const prompt = buildAgentPrompt("Fix the bug", []);
    expect(prompt).toContain("Fix the bug");
  });

  it("injects skills when present", () => {
    const prompt = buildAgentPrompt("Fix the bug", [makeSkill()]);
    expect(prompt).toContain("DanteSkillbook");
    expect(prompt).toContain("Test Skill");
    expect(prompt).toContain("Fix the bug");
  });
});

describe("buildReflectorPrompt", () => {
  it("includes task, outcome, summary", () => {
    const prompt = buildReflectorPrompt({
      task: "Refactor X",
      outcome: "success",
      summary: "Went well",
    });
    expect(prompt).toContain("Refactor X");
    expect(prompt).toContain("success");
    expect(prompt).toContain("Went well");
  });

  it("includes evidence when provided", () => {
    const prompt = buildReflectorPrompt({
      task: "T",
      outcome: "success",
      summary: "S",
      evidence: ["Evidence A", "Evidence B"],
    });
    expect(prompt).toContain("Evidence A");
    expect(prompt).toContain("Evidence B");
  });
});

describe("buildSkillManagerPrompt", () => {
  it("includes reflection text", () => {
    const prompt = buildSkillManagerPrompt({
      reflectionText: "Great strategy found.",
      existingSkillIds: [],
    });
    expect(prompt).toContain("Great strategy found.");
  });

  it("includes existing skill IDs", () => {
    const prompt = buildSkillManagerPrompt({ reflectionText: "R", existingSkillIds: ["s1", "s2"] });
    expect(prompt).toContain("s1");
    expect(prompt).toContain("s2");
  });
});

describe("system prompts", () => {
  it("AGENT_SYSTEM_PROMPT references Skillbook", () => {
    expect(AGENT_SYSTEM_PROMPT).toContain("DanteSkillbook");
  });

  it("REFLECTOR_SYSTEM_PROMPT mentions evidence", () => {
    expect(REFLECTOR_SYSTEM_PROMPT).toContain("evidence");
  });

  it("SKILL_MANAGER_SYSTEM_PROMPT lists all actions", () => {
    expect(SKILL_MANAGER_SYSTEM_PROMPT).toContain("add");
    expect(SKILL_MANAGER_SYSTEM_PROMPT).toContain("refine");
    expect(SKILL_MANAGER_SYSTEM_PROMPT).toContain("remove");
    expect(SKILL_MANAGER_SYSTEM_PROMPT).toContain("merge");
    expect(SKILL_MANAGER_SYSTEM_PROMPT).toContain("reject");
  });
});
