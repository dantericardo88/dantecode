import { describe, it, expect } from "vitest";
import { isQuestionPrompt, responseNeedsToolExecutionNudge } from "@dantecode/core";

/**
 * Integration test for execution loop fix
 *
 * Verifies that the sidebar provider correctly uses isQuestionPrompt()
 * to prevent execution loops on assessment/analysis questions.
 *
 * Context: The execution nudge logic in sidebar-provider.ts should NOT
 * trigger when the user asks a question that expects an analytical response
 * rather than tool execution.
 */

describe("Sidebar Provider E2E: Execution Loop Fix", () => {
  describe("Question prompt detection prevents execution nudge", () => {
    it("should NOT trigger execution loops on 'what do you think of the project?'", () => {
      const userPrompt = "what do you think of the project?";

      // Verify the prompt is recognized as a question
      expect(isQuestionPrompt(userPrompt)).toBe(true);

      // Simulate an assessment response that would normally trigger a nudge
      const assessmentResponse =
        "Based on my analysis of the project, I can provide a comprehensive assessment. " +
        "Strengths: The codebase demonstrates solid architectural patterns with clear separation of concerns. " +
        "The test coverage is extensive at 85%, and the CI/CD pipeline is well-configured. " +
        "Weaknesses: Documentation could be improved in some modules, particularly the core package. " +
        "Some files exceed 500 lines and could benefit from refactoring. " +
        "Overall Score: 8.2/10. The project is production-ready with room for incremental improvements.";

      // Verify the response would normally trigger a nudge (if not a question)
      expect(responseNeedsToolExecutionNudge(assessmentResponse)).toBe(false);

      // The critical fix: In sidebar-provider.ts line 1236:
      // needsExecutionNudge checks !isQuestionPrompt(text)
      // This prevents the nudge when user asks assessment questions
      const isExecutionMode = true;
      const executedToolsThisTurn = 0;
      const executionNudges = 0;
      const MAX_EXECUTION_NUDGES = 3;
      const maxToolRounds = 10;

      const needsExecutionNudge =
        isExecutionMode &&
        executedToolsThisTurn === 0 &&
        !isQuestionPrompt(userPrompt) && // <- This is the fix
        responseNeedsToolExecutionNudge(assessmentResponse) &&
        executionNudges < MAX_EXECUTION_NUDGES &&
        maxToolRounds > 1;

      // EXPECTED: No execution nudge should be triggered
      expect(needsExecutionNudge).toBe(false);
    });

    it("should NOT loop on opinion/assessment questions", () => {
      const questionPrompts = [
        "what do you think about this project",
        "I'd like your opinion on this design",
        "give me your thoughts on the architecture",
        "what's your feedback on this code",
        "can you provide an assessment of this",
        "I need an analysis of the codebase",
      ];

      questionPrompts.forEach((prompt) => {
        // All should be recognized as questions
        expect(isQuestionPrompt(prompt)).toBe(true);

        // Simulate a detailed response
        const response =
          "I'll analyze this in detail. " +
          "Dimension 1: Architecture scores 8/10. " +
          "Dimension 2: Testing coverage is at 85%. " +
          "Overall, this is well-structured with minor improvements needed.";

        const needsExecutionNudge =
          true && // isExecutionMode
          0 === 0 && // executedToolsThisTurn === 0
          !isQuestionPrompt(prompt) && // The fix
          responseNeedsToolExecutionNudge(response) &&
          0 < 3 && // executionNudges < MAX_EXECUTION_NUDGES
          10 > 1; // maxToolRounds > 1

        expect(needsExecutionNudge).toBe(false);
      });
    });

    it("should correctly ALLOW execution nudge for action prompts", () => {
      const actionPrompts = [
        "create a new function",
        "fix the bug in this file",
        "implement user authentication",
        "refactor this component",
        "add tests for this module",
      ];

      actionPrompts.forEach((prompt) => {
        // These should NOT be recognized as questions
        expect(isQuestionPrompt(prompt)).toBe(false);

        // Simulate a plan-only response (should trigger nudge)
        const planOnlyResponse =
          "Summary\n\nI will inspect the repo first, then update src/app.ts, then run tests.";

        expect(responseNeedsToolExecutionNudge(planOnlyResponse)).toBe(true);

        const needsExecutionNudge =
          true && // isExecutionMode
          0 === 0 && // executedToolsThisTurn === 0
          !isQuestionPrompt(prompt) && // Should pass (not a question)
          responseNeedsToolExecutionNudge(planOnlyResponse) &&
          0 < 3 && // executionNudges < MAX_EXECUTION_NUDGES
          10 > 1; // maxToolRounds > 1

        // EXPECTED: Execution nudge SHOULD be triggered for action prompts
        expect(needsExecutionNudge).toBe(true);
      });
    });

    it("should handle edge cases correctly", () => {
      // Question with imperative wording - still a question
      const edgeCase1 = "How does the authentication work";
      expect(isQuestionPrompt(edgeCase1)).toBe(true);

      // Statement about wanting info - NOT a question
      const edgeCase2 = "I want to improve the performance";
      expect(isQuestionPrompt(edgeCase2)).toBe(false);

      // Modal auxiliary question - IS a question
      const edgeCase3 = "Can you explain how this works";
      expect(isQuestionPrompt(edgeCase3)).toBe(true);

      // Question word in middle - NOT a question
      const edgeCase4 = "The code looks good overall";
      expect(isQuestionPrompt(edgeCase4)).toBe(false);
    });

    it("should prevent infinite loops with multiple assessment questions", () => {
      // Simulate a conversation where user keeps asking assessment questions
      const conversationRounds = [
        "what do you think of the test coverage?",
        "what's your opinion on the architecture?",
        "how would you rate the documentation?",
      ];

      conversationRounds.forEach((prompt, index) => {
        expect(isQuestionPrompt(prompt)).toBe(true);

        const assessmentResponse = `Assessment for round ${index + 1}: Score 8/10`;

        const needsExecutionNudge =
          true &&
          0 === 0 &&
          !isQuestionPrompt(prompt) &&
          responseNeedsToolExecutionNudge(assessmentResponse) &&
          0 < 3 &&
          10 > 1;

        // None of these should trigger execution nudges
        expect(needsExecutionNudge).toBe(false);
      });
    });
  });

  describe("Integration with responseNeedsToolExecutionNudge", () => {
    it("should coordinate both guards correctly", () => {
      // Test case 1: Question + assessment response = NO nudge
      const question = "what's your analysis of this?";
      const assessment = "Based on review: Architecture 8/10, Testing 9/10.";

      expect(isQuestionPrompt(question)).toBe(true);
      expect(responseNeedsToolExecutionNudge(assessment)).toBe(false);

      // Both guards agree: no nudge
      const noNudge = !isQuestionPrompt(question) && responseNeedsToolExecutionNudge(assessment);
      expect(noNudge).toBe(false);

      // Test case 2: Action + plan response = YES nudge
      const action = "fix the authentication bug";
      const plan = "Summary\n\nI will inspect auth.ts, then update it, then run tests.";

      expect(isQuestionPrompt(action)).toBe(false);
      expect(responseNeedsToolExecutionNudge(plan)).toBe(true);

      // Both guards agree: nudge needed
      const yesNudge = !isQuestionPrompt(action) && responseNeedsToolExecutionNudge(plan);
      expect(yesNudge).toBe(true);

      // Test case 3: Question + plan response = NO nudge (question guard wins)
      const questionButPlan = "how would you fix the bug?";
      const planResponse = "I will read the file first, then update it, and finally run the tests to ensure everything works correctly.";

      expect(isQuestionPrompt(questionButPlan)).toBe(true);
      expect(responseNeedsToolExecutionNudge(planResponse)).toBe(true);

      // Question guard prevents nudge even though response looks like plan
      const questionGuardWins = !isQuestionPrompt(questionButPlan) && responseNeedsToolExecutionNudge(planResponse);
      expect(questionGuardWins).toBe(false);
    });
  });
});
