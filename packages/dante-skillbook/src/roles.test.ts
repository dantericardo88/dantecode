import { describe, it, expect } from "vitest";
import {
  buildAgentRole,
  buildReflectorRole,
  buildSkillManagerRole,
  parseSkillManagerOutput,
} from "./roles.js";
import type { Skill, TaskResult } from "./types.js";

const makeSkill = (): Skill => ({
  id: "s1",
  title: "Use TypeScript",
  content: "Always use strict TypeScript.",
  section: "coding",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const makeTaskResult = (): TaskResult => ({
  runId: "run-1",
  taskType: "code-generation",
  outcome: "success",
  summary: "Added null checks to all API handlers.",
  evidence: ["all tests pass", "no type errors"],
  sessionId: "sess-1",
});

describe("buildAgentRole", () => {
  it("returns systemPrompt and userPrompt", () => {
    const role = buildAgentRole({ task: "Write a sorting function", relevantSkills: [] });
    expect(role.systemPrompt).toContain("DanteAgent");
    expect(role.userPrompt).toContain("sorting function");
    expect(role.modelHint).toBe("primary");
  });

  it("injects skills into userPrompt", () => {
    const role = buildAgentRole({ task: "Fix bug", relevantSkills: [makeSkill()] });
    expect(role.userPrompt).toContain("Use TypeScript");
  });
});

describe("buildReflectorRole", () => {
  it("returns systemPrompt and userPrompt", () => {
    const role = buildReflectorRole({ taskResult: makeTaskResult() });
    expect(role.systemPrompt).toContain("DanteReflector");
    expect(role.userPrompt).toContain("null checks");
    expect(role.modelHint).toBe("fast");
  });

  it("includes evidence in userPrompt", () => {
    const role = buildReflectorRole({ taskResult: makeTaskResult() });
    expect(role.userPrompt).toContain("all tests pass");
  });
});

describe("buildSkillManagerRole", () => {
  it("returns systemPrompt and userPrompt", () => {
    const role = buildSkillManagerRole({ reflectionText: "Strategy A worked well.", existingSkillIds: ["s1"] });
    expect(role.systemPrompt).toContain("DanteSkillManager");
    expect(role.userPrompt).toContain("Strategy A");
    expect(role.userPrompt).toContain("s1");
    expect(role.modelHint).toBe("fast");
  });
});

describe("parseSkillManagerOutput", () => {
  it("parses valid JSON array", () => {
    const raw = `Here are my proposals:\n[{"action":"add","rationale":"useful","candidateSkill":{"id":"s2","title":"T","content":"C","section":"coding","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}}]`;
    const ops = parseSkillManagerOutput(raw);
    expect(ops).toHaveLength(1);
    expect(ops[0].action).toBe("add");
  });

  it("returns [] for invalid JSON", () => {
    expect(parseSkillManagerOutput("No JSON here")).toHaveLength(0);
  });

  it("returns [] for empty array", () => {
    expect(parseSkillManagerOutput("[]")).toHaveLength(0);
  });

  it("filters out items without action", () => {
    const raw = `[{"rationale":"missing action"}]`;
    expect(parseSkillManagerOutput(raw)).toHaveLength(0);
  });
});
