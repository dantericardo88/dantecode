import { describe, expect, it } from "vitest";
import {
  promptRequestsToolExecution,
  responseNeedsToolExecutionNudge,
  isQuestionPrompt,
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

  it("does not flag assessment/analysis responses", () => {
    const assessment =
      "Based on my review of the project, I can provide an assessment of its strengths and weaknesses. " +
      "Strengths: Well-structured codebase with clear separation of concerns. The test coverage is good. " +
      "Weaknesses: Some modules could benefit from better documentation. The error handling could be more consistent.";
    expect(responseNeedsToolExecutionNudge(assessment)).toBe(false);
  });

  it("does not flag analysis with scoring", () => {
    const analysis =
      "I'll analyze the codebase quality. Overall score: 8.0/10. " +
      "Dimensions: Architecture (8/10), Testing (9/10), Documentation (6/10). " +
      "The project shows solid engineering practices with room for improvement in docs.";
    expect(responseNeedsToolExecutionNudge(analysis)).toBe(false);
  });
});

describe("isQuestionPrompt", () => {
  it("recognizes questions with question marks", () => {
    expect(isQuestionPrompt("what do you think of the project?")).toBe(true);
    expect(isQuestionPrompt("How does this code work?")).toBe(true);
    expect(isQuestionPrompt("Is this a good approach?")).toBe(true);
  });

  it("recognizes questions starting with question words", () => {
    expect(isQuestionPrompt("what are the strengths of this project")).toBe(true);
    expect(isQuestionPrompt("How does the authentication work")).toBe(true);
    expect(isQuestionPrompt("Why is this function slow")).toBe(true);
    expect(isQuestionPrompt("When should I use this pattern")).toBe(true);
    expect(isQuestionPrompt("Where is the configuration file")).toBe(true);
    expect(isQuestionPrompt("Who wrote this module")).toBe(true);
  });

  it("recognizes questions with modal verbs", () => {
    expect(isQuestionPrompt("Can you explain how this works")).toBe(true);
    expect(isQuestionPrompt("Could you help me understand this")).toBe(true);
    expect(isQuestionPrompt("Would you recommend this approach")).toBe(true);
    expect(isQuestionPrompt("Should I refactor this code")).toBe(true);
  });

  it("recognizes questions asking for opinions/thoughts", () => {
    expect(isQuestionPrompt("what do you think about this project")).toBe(true);
    expect(isQuestionPrompt("I'd like your opinion on this design")).toBe(true);
    expect(isQuestionPrompt("give me your thoughts on the architecture")).toBe(true);
    expect(isQuestionPrompt("what's your feedback on this code")).toBe(true);
    expect(isQuestionPrompt("can you provide an assessment of this")).toBe(true);
    expect(isQuestionPrompt("I need an analysis of the codebase")).toBe(true);
  });

  it("does not flag execution requests as questions", () => {
    expect(isQuestionPrompt("create a new function")).toBe(false);
    expect(isQuestionPrompt("fix the bug in this file")).toBe(false);
    expect(isQuestionPrompt("implement user authentication")).toBe(false);
    expect(isQuestionPrompt("refactor this component")).toBe(false);
    expect(isQuestionPrompt("add tests for this module")).toBe(false);
  });

  it("does not flag statements as questions", () => {
    expect(isQuestionPrompt("The code looks good")).toBe(false);
    expect(isQuestionPrompt("I want to improve the performance")).toBe(false);
    expect(isQuestionPrompt("This needs better error handling")).toBe(false);
  });
});
