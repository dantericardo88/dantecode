// packages/core/src/__tests__/requirements-interview.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  validateAnswer,
  InterviewSession,
  buildRequirementsDocument,
  formatRequirementsForPrompt,
  createInterviewSession,
  WEB_APP_QUESTIONS,
  CLI_TOOL_QUESTIONS,
  type InterviewQuestion,
  type ProjectKind,
} from "../requirements-interview.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeQ(kind: InterviewQuestion["kind"], opts: Partial<InterviewQuestion> = {}): InterviewQuestion {
  return {
    id: "q-test",
    kind,
    text: "Test question?",
    category: "general",
    options: kind === "choice" || kind === "multi" ? ["optionA", "optionB", "optionC"] : undefined,
    range: kind === "numeric" ? [1, 100] : undefined,
    ...opts,
  };
}

// ─── validateAnswer ───────────────────────────────────────────────────────────

describe("validateAnswer", () => {
  it("yes_no: accepts 'yes' → true", () => {
    const result = validateAnswer(makeQ("yes_no"), "yes");
    expect(result.valid).toBe(true);
    expect(result.value).toBe(true);
  });

  it("yes_no: accepts 'n' → false", () => {
    const result = validateAnswer(makeQ("yes_no"), "n");
    expect(result.valid).toBe(true);
    expect(result.value).toBe(false);
  });

  it("yes_no: rejects invalid input", () => {
    const result = validateAnswer(makeQ("yes_no"), "maybe");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("yes");
  });

  it("freeform: accepts non-empty text", () => {
    const result = validateAnswer(makeQ("freeform"), "Hello world");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("Hello world");
  });

  it("freeform: rejects empty string", () => {
    const result = validateAnswer(makeQ("freeform"), "  ");
    expect(result.valid).toBe(false);
  });

  it("choice: accepts valid option (case-insensitive)", () => {
    const result = validateAnswer(makeQ("choice"), "optionA");
    expect(result.valid).toBe(true);
    expect(result.value).toBe("optionA");
  });

  it("choice: rejects unknown option", () => {
    const result = validateAnswer(makeQ("choice"), "optionX");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("optionA");
  });

  it("multi: accepts comma-separated valid options", () => {
    const result = validateAnswer(makeQ("multi"), "optionA, optionC");
    expect(result.valid).toBe(true);
    expect(Array.isArray(result.value)).toBe(true);
    expect(result.value).toHaveLength(2);
  });

  it("multi: rejects unknown option in list", () => {
    const result = validateAnswer(makeQ("multi"), "optionA, optionZ");
    expect(result.valid).toBe(false);
  });

  it("numeric: accepts number in range", () => {
    const result = validateAnswer(makeQ("numeric"), "42");
    expect(result.valid).toBe(true);
    expect(result.value).toBe(42);
  });

  it("numeric: rejects number outside range", () => {
    const result = validateAnswer(makeQ("numeric"), "200");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("100");
  });

  it("numeric: rejects non-numeric input", () => {
    const result = validateAnswer(makeQ("numeric"), "abc");
    expect(result.valid).toBe(false);
  });
});

// ─── InterviewSession ─────────────────────────────────────────────────────────

describe("InterviewSession", () => {
  let session: InterviewSession;

  function makeSimpleSession(): InterviewSession {
    return new InterviewSession([
      { id: "q1", kind: "freeform", text: "Q1?", category: "overview" },
      { id: "q2", kind: "yes_no", text: "Q2?", category: "features", ifYes: "q3" },
      { id: "q3", kind: "freeform", text: "Q3 follow-up?", category: "features" },
    ]);
  }

  beforeEach(() => { session = makeSimpleSession(); });

  it("starts with 'not-started' status", () => {
    expect(session.status).toBe("not-started");
  });

  it("start() changes status to 'in-progress'", () => {
    session.start();
    expect(session.status).toBe("in-progress");
  });

  it("currentQuestion returns first question initially", () => {
    expect(session.currentQuestion?.id).toBe("q1");
  });

  it("answer() advances to next question on success", () => {
    session.answer("Hello world");
    expect(session.currentQuestion?.id).toBe("q2");
  });

  it("answer() returns error for invalid input", () => {
    const result = session.answer("  "); // empty freeform
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("yes/no branching: 'yes' inserts ifYes question at front", () => {
    session.answer("Hello"); // q1
    session.answer("yes");   // q2 → yes, insert q3
    expect(session.currentQuestion?.id).toBe("q3");
  });

  it("yes/no branching: 'no' skips ifYes question", () => {
    session.answer("Hello"); // q1
    session.answer("no");    // q2 → no, q3 NOT inserted
    // q3 not in queue, session should be complete
    expect(session.status).toBe("complete");
  });

  it("skip() works for optional question", () => {
    const s = new InterviewSession([
      { id: "q1", kind: "freeform", text: "Q?", category: "g", optional: true },
    ]);
    expect(s.skip()).toBe(true);
    expect(s.status).toBe("complete");
  });

  it("skip() returns false for non-optional question", () => {
    expect(session.skip()).toBe(false);
  });

  it("abandon() sets status to 'abandoned'", () => {
    session.abandon();
    expect(session.status).toBe("abandoned");
  });

  it("status becomes 'complete' when all questions answered", () => {
    const s = new InterviewSession([
      { id: "q1", kind: "freeform", text: "Q?", category: "g" },
    ]);
    s.answer("done");
    expect(s.status).toBe("complete");
  });

  it("answeredCount increments on each answer", () => {
    expect(session.answeredCount).toBe(0);
    session.answer("x");
    expect(session.answeredCount).toBe(1);
  });

  it("formatCurrentQuestion includes question text", () => {
    const text = session.formatCurrentQuestion();
    expect(text).toContain("Q1?");
  });

  it("formatCurrentQuestion shows '(No more questions.)' when done", () => {
    const s = new InterviewSession([]);
    expect(s.formatCurrentQuestion()).toContain("No more questions");
  });

  it("getAllAnswers returns answered questions only", () => {
    session.answer("first");
    expect(session.getAllAnswers()).toHaveLength(1);
  });
});

// ─── buildRequirementsDocument ────────────────────────────────────────────────

describe("buildRequirementsDocument", () => {
  it("builds document from completed session", () => {
    const s = createInterviewSession("web-app");
    s.start();
    // Answer all questions with freeform/yes_no defaults
    while (s.currentQuestion) {
      const q = s.currentQuestion;
      if (q.kind === "freeform") s.answer("A sample answer for " + q.id);
      else if (q.kind === "yes_no") s.answer("no");
      else if (q.kind === "choice") s.answer(q.options![0]!);
      else if (q.kind === "multi") s.answer(q.options![0]!);
      else if (q.kind === "numeric") s.answer(String(q.range![0]));
      else s.skip();
    }
    const doc = buildRequirementsDocument(s, "TestApp", "web-app");
    expect(doc.projectName).toBe("TestApp");
    expect(doc.projectKind).toBe("web-app");
    expect(doc.completedAt).toBeTruthy();
  });
});

// ─── formatRequirementsForPrompt ──────────────────────────────────────────────

describe("formatRequirementsForPrompt", () => {
  it("includes project name in output", () => {
    const s = createInterviewSession("cli-tool");
    const doc = buildRequirementsDocument(s, "MyTool", "cli-tool");
    const output = formatRequirementsForPrompt(doc);
    expect(output).toContain("MyTool");
    expect(output).toContain("cli-tool");
  });

  it("includes 'not provided' when description empty", () => {
    const s = new InterviewSession([]);
    const doc = buildRequirementsDocument(s, "Empty", "unknown");
    const output = formatRequirementsForPrompt(doc);
    expect(output).toContain("not provided");
  });
});

// ─── Question Banks ───────────────────────────────────────────────────────────

describe("WEB_APP_QUESTIONS", () => {
  it("has questions with unique IDs", () => {
    const ids = WEB_APP_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes an 'overview' category question", () => {
    expect(WEB_APP_QUESTIONS.some((q) => q.category === "overview")).toBe(true);
  });
});

describe("CLI_TOOL_QUESTIONS", () => {
  it("includes a freeform question", () => {
    expect(CLI_TOOL_QUESTIONS.some((q) => q.kind === "freeform")).toBe(true);
  });
});

describe("createInterviewSession", () => {
  it("returns a session for web-app", () => {
    const s = createInterviewSession("web-app");
    expect(s.totalQuestions).toBeGreaterThan(0);
  });

  it("returns empty session for unknown kind", () => {
    const s = createInterviewSession("unknown" as ProjectKind);
    expect(s.totalQuestions).toBe(0);
  });
});
