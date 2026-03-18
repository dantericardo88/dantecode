import { describe, expect, it } from "vitest";
import {
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
} from "./execution-heuristics.js";

describe("execution heuristics", () => {
  it("recognizes prompts that require tool execution", () => {
    expect(promptRequestsToolExecution("Fix the failing build and update src/app.ts")).toBe(true);
    expect(promptRequestsToolExecution("please continue")).toBe(true);
    expect(promptRequestsToolExecution("/verify please continue")).toBe(true);
    expect(promptRequestsToolExecution("Explain how the router works")).toBe(false);
  });

  it("flags plan-only narration that should trigger a tool nudge", () => {
    expect(
      responseNeedsToolExecutionNudge(
        "Summary\n\nI will inspect the repo first, then update src/app.ts, then run tests.",
      ),
    ).toBe(true);
  });

  it("flags fake execution transcripts without tool calls", () => {
    expect(
      responseNeedsToolExecutionNudge(
        "Executing plan...\n\nRunning: Write docs/Token-Savings.md\nRound 2/50 — 1 tool executed",
      ),
    ).toBe(true);
  });

  it("does not flag short conversational replies", () => {
    expect(responseNeedsToolExecutionNudge("I can explain that.")).toBe(false);
  });
});
