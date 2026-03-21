import { describe, it, expect } from "vitest";
import { isMeaningfulTask, runLiteReflection, runReflectionLoop } from "./reflection-loop.js";
import type { TaskResult } from "./types.js";

const makeResult = (overrides?: Partial<TaskResult>): TaskResult => ({
  runId: "run-1",
  taskType: "code-generation",
  outcome: "success",
  summary: "Implemented null checks.",
  evidence: ["tests pass"],
  sessionId: "sess-1",
  ...overrides,
});

describe("isMeaningfulTask", () => {
  it("true for code-generation", () => {
    expect(isMeaningfulTask(makeResult())).toBe(true);
  });

  it("true for failure regardless of type", () => {
    expect(isMeaningfulTask(makeResult({ taskType: "trivial", outcome: "failure" }))).toBe(true);
  });

  it("false for trivial success", () => {
    expect(isMeaningfulTask(makeResult({ taskType: "trivial", outcome: "success" }))).toBe(false);
  });
});

describe("runLiteReflection", () => {
  it("includes task type, outcome, summary", () => {
    const text = runLiteReflection(makeResult());
    expect(text).toContain("code-generation");
    expect(text).toContain("success");
    expect(text).toContain("Implemented null checks.");
  });

  it("includes evidence when present", () => {
    const text = runLiteReflection(makeResult({ evidence: ["test A", "test B"] }));
    expect(text).toContain("test A");
  });

  it("includes failure advice on failure outcome", () => {
    const text = runLiteReflection(makeResult({ outcome: "failure" }));
    expect(text).toContain("failed");
  });
});

describe("runReflectionLoop", () => {
  it("returns empty proposals without LLM", async () => {
    const result = await runReflectionLoop(makeResult(), []);
    expect(result.proposedUpdates).toHaveLength(0);
    expect(result.reflectionText).toBeTruthy();
    expect(result.mode).toBe("standard");
  });

  it("lite mode works without LLM", async () => {
    const result = await runReflectionLoop(makeResult(), [], { mode: "lite" });
    expect(result.mode).toBe("lite");
  });

  it("passes LLM output through skill manager", async () => {
    let callCount = 0;
    const fakeLlm = async (_sys: string, _user: string): Promise<string> => {
      callCount++;
      if (callCount === 1) return "Good reflection text.";
      return `[{"action":"add","rationale":"good","candidateSkill":{"id":"s1","title":"T","content":"C","section":"coding","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}}]`;
    };
    const result = await runReflectionLoop(makeResult(), [], {}, fakeLlm);
    expect(result.proposedUpdates).toHaveLength(1);
    expect(result.proposedUpdates[0].action).toBe("add");
    expect(callCount).toBe(2);
  });
});
