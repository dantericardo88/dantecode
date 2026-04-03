import { describe, it, expect } from "vitest";
import {
  deriveSectionFromTrigger,
  extractHighSeverityInsights,
  distillLesson,
  CHANNEL_TO_SECTION,
} from "./lesson-distiller.js";
import type { GaslightSession, GaslightCritique, IterationRecord } from "./types.js";

// ────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────

const makeIteration = (overrides?: Partial<IterationRecord>): IterationRecord => ({
  iteration: 1,
  draft: "draft text",
  gateDecision: "pass",
  gateScore: 0.85,
  at: new Date().toISOString(),
  ...overrides,
});

const makeCritique = (
  descriptions: string[],
  severity: "low" | "medium" | "high" = "high",
): GaslightCritique => ({
  iteration: 1,
  points: descriptions.map((d) => ({
    aspect: "shallow-reasoning" as const,
    description: d,
    severity,
  })),
  summary: "Some critique",
  needsEvidenceEscalation: false,
  at: new Date().toISOString(),
});

function makeEligibleSession(overrides?: Partial<GaslightSession>): GaslightSession {
  return {
    sessionId: "test-session-abc",
    trigger: { channel: "explicit-user", phrase: "go deeper", at: new Date().toISOString() },
    iterations: [makeIteration()],
    stopReason: "pass",
    finalOutput: "The final refined output text here.",
    finalGateDecision: "pass",
    lessonEligible: true,
    startedAt: new Date(Date.now() - 5000).toISOString(),
    endedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────

describe("CHANNEL_TO_SECTION", () => {
  it("covers all four channels", () => {
    const keys = Object.keys(CHANNEL_TO_SECTION);
    expect(keys).toContain("explicit-user");
    expect(keys).toContain("verification");
    expect(keys).toContain("policy");
    expect(keys).toContain("audit");
  });
});

describe("deriveSectionFromTrigger", () => {
  it("explicit-user maps to refinement", () => {
    expect(deriveSectionFromTrigger("explicit-user")).toBe("refinement");
  });

  it("verification maps to quality-gates", () => {
    expect(deriveSectionFromTrigger("verification")).toBe("quality-gates");
  });

  it("policy without taskClass maps to task-patterns", () => {
    expect(deriveSectionFromTrigger("policy")).toBe("task-patterns");
  });

  it("policy with taskClass uses taskClass value", () => {
    expect(deriveSectionFromTrigger("policy", "code-generation")).toBe("code-generation");
  });

  it("audit maps to general", () => {
    expect(deriveSectionFromTrigger("audit")).toBe("general");
  });
});

describe("extractHighSeverityInsights", () => {
  it("returns empty for session with no critiques", () => {
    const session = makeEligibleSession({ iterations: [makeIteration()] });
    expect(extractHighSeverityInsights(session)).toHaveLength(0);
  });

  it("extracts high-severity descriptions", () => {
    const critique = makeCritique(["Too shallow", "Missing evidence"], "high");
    const session = makeEligibleSession({
      iterations: [makeIteration({ critique })],
    });
    const insights = extractHighSeverityInsights(session);
    expect(insights).toContain("Too shallow");
    expect(insights).toContain("Missing evidence");
  });

  it("ignores low severity", () => {
    const critique = makeCritique(["Minor issue"], "low");
    const session = makeEligibleSession({ iterations: [makeIteration({ critique })] });
    expect(extractHighSeverityInsights(session)).toHaveLength(0);
  });

  it("ignores medium severity", () => {
    const critique = makeCritique(["Medium issue"], "medium");
    const session = makeEligibleSession({ iterations: [makeIteration({ critique })] });
    expect(extractHighSeverityInsights(session)).toHaveLength(0);
  });

  it("deduplicates identical descriptions across iterations", () => {
    const c = makeCritique(["Repeated insight"], "high");
    const session = makeEligibleSession({
      iterations: [
        makeIteration({ iteration: 1, critique: c }),
        makeIteration({ iteration: 2, critique: c }),
      ],
    });
    const insights = extractHighSeverityInsights(session);
    expect(insights.filter((i) => i === "Repeated insight")).toHaveLength(1);
  });

  it("respects max parameter", () => {
    const critique = makeCritique(["A", "B", "C", "D", "E", "F"], "high");
    const session = makeEligibleSession({ iterations: [makeIteration({ critique })] });
    expect(extractHighSeverityInsights(session, 3)).toHaveLength(3);
  });

  it("collects high-severity insights across multiple different iterations", () => {
    const c1 = makeCritique(["First"], "high");
    const c2 = makeCritique(["Second"], "high");
    const session = makeEligibleSession({
      iterations: [
        makeIteration({ iteration: 1, critique: c1 }),
        makeIteration({ iteration: 2, critique: c2 }),
      ],
    });
    const insights = extractHighSeverityInsights(session);
    expect(insights).toContain("First");
    expect(insights).toContain("Second");
  });
});

describe("distillLesson", () => {
  it("throws when session is not lesson-eligible", () => {
    const session = makeEligibleSession({ lessonEligible: false });
    expect(() => distillLesson(session)).toThrow(/not lesson-eligible/);
  });

  it("error message contains session ID", () => {
    const session = makeEligibleSession({ lessonEligible: false });
    expect(() => distillLesson(session)).toThrow("test-session-abc");
  });

  it("proposal has action 'add'", () => {
    const { proposal } = distillLesson(makeEligibleSession());
    expect(proposal.action).toBe("add");
  });

  it("candidateSkill is populated", () => {
    const { proposal } = distillLesson(makeEligibleSession());
    expect(proposal.candidateSkill).toBeDefined();
    expect(proposal.candidateSkill?.content).toBeTruthy();
  });

  it("content includes finalOutput", () => {
    const { proposal } = distillLesson(makeEligibleSession());
    expect(proposal.candidateSkill?.content).toContain("The final refined output text here.");
  });

  it("content includes high-severity insights when present", () => {
    const critique = makeCritique(["Deep reasoning required"], "high");
    const session = makeEligibleSession({
      iterations: [makeIteration({ critique })],
    });
    const { proposal } = distillLesson(session);
    expect(proposal.candidateSkill?.content).toContain("Deep reasoning required");
    expect(proposal.candidateSkill?.content).toContain("Key Critique Insights");
  });

  it("content does not include insight block when no high-severity critiques", () => {
    const session = makeEligibleSession({ iterations: [makeIteration()] });
    const { proposal } = distillLesson(session);
    expect(proposal.candidateSkill?.content).not.toContain("Key Critique Insights");
  });

  it("sourceSessionId is set to session.sessionId", () => {
    const { proposal } = distillLesson(makeEligibleSession());
    expect(proposal.candidateSkill?.sourceSessionId).toBe("test-session-abc");
  });

  it("trustScore derives from last iteration gateScore", () => {
    const session = makeEligibleSession({ iterations: [makeIteration({ gateScore: 0.92 })] });
    const { trustScore } = distillLesson(session);
    expect(trustScore).toBe(0.92);
  });

  it("trustScore uses last iteration when multiple exist", () => {
    const session = makeEligibleSession({
      iterations: [
        makeIteration({ iteration: 1, gateScore: 0.6 }),
        makeIteration({ iteration: 2, gateScore: 0.88 }),
      ],
    });
    const { trustScore } = distillLesson(session);
    expect(trustScore).toBe(0.88);
  });

  it("trustScore defaults to 0.75 when gateScore is absent", () => {
    const iterNoScore = makeIteration({ gateScore: undefined });
    const session = makeEligibleSession({ iterations: [iterNoScore] });
    const { trustScore } = distillLesson(session);
    expect(trustScore).toBe(0.75);
  });

  it("trustScore is floored at 0.5", () => {
    const session = makeEligibleSession({ iterations: [makeIteration({ gateScore: 0.1 })] });
    const { trustScore } = distillLesson(session);
    expect(trustScore).toBe(0.5);
  });

  it("trustScore is capped at 1.0", () => {
    const session = makeEligibleSession({ iterations: [makeIteration({ gateScore: 1.0 })] });
    const { trustScore } = distillLesson(session);
    expect(trustScore).toBe(1.0);
  });

  it("opts.trustScore overrides gateScore but is still floored at 0.5", () => {
    const session = makeEligibleSession({ iterations: [makeIteration({ gateScore: 0.9 })] });
    const { trustScore } = distillLesson(session, { trustScore: 0.2 });
    expect(trustScore).toBe(0.5);
  });

  it("opts.section overrides derived section", () => {
    const { section, proposal } = distillLesson(makeEligibleSession(), {
      section: "custom-section",
    });
    expect(section).toBe("custom-section");
    expect(proposal.candidateSkill?.section).toBe("custom-section");
  });

  it("section defaults from trigger channel", () => {
    const { section } = distillLesson(makeEligibleSession());
    expect(section).toBe("refinement"); // explicit-user -> refinement
  });

  it("policy trigger with taskClass uses taskClass as section", () => {
    const session = makeEligibleSession({
      trigger: { channel: "policy", taskClass: "code-generation", at: new Date().toISOString() },
    });
    const { section } = distillLesson(session);
    expect(section).toBe("code-generation");
  });

  it("verification trigger uses quality-gates section", () => {
    const session = makeEligibleSession({
      trigger: { channel: "verification", at: new Date().toISOString() },
    });
    const { section } = distillLesson(session);
    expect(section).toBe("quality-gates");
  });

  it("candidateSkill.id is a UUID (36-char hyphenated hex)", () => {
    const { proposal } = distillLesson(makeEligibleSession());
    expect(proposal.candidateSkill?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("candidateSkill IDs are unique across calls", () => {
    const s = makeEligibleSession();
    const id1 = distillLesson(s).proposal.candidateSkill?.id;
    const id2 = distillLesson(s).proposal.candidateSkill?.id;
    expect(id1).not.toBe(id2);
  });

  it("rationale mentions session ID and trigger channel", () => {
    const { proposal } = distillLesson(makeEligibleSession());
    expect(proposal.rationale).toContain("test-session-abc");
    expect(proposal.rationale).toContain("explicit-user");
  });

  it("rationale mentions stop reason", () => {
    const { proposal } = distillLesson(makeEligibleSession({ stopReason: "confidence" }));
    expect(proposal.rationale).toContain("confidence");
  });

  it("opts.title overrides derived title", () => {
    const { proposal } = distillLesson(makeEligibleSession(), { title: "My Custom Title" });
    expect(proposal.candidateSkill?.title).toBe("My Custom Title");
  });

  it("derived title reflects iteration count (singular)", () => {
    const session = makeEligibleSession({ iterations: [makeIteration()] });
    const { proposal } = distillLesson(session);
    expect(proposal.candidateSkill?.title).toContain("1 iteration");
    expect(proposal.candidateSkill?.title).not.toContain("iterations");
  });

  it("derived title reflects iteration count (plural)", () => {
    const session = makeEligibleSession({
      iterations: [makeIteration({ iteration: 1 }), makeIteration({ iteration: 2 })],
    });
    const { proposal } = distillLesson(session);
    expect(proposal.candidateSkill?.title).toContain("2 iterations");
  });

  it("candidateSkill.section matches returned section", () => {
    const { proposal, section } = distillLesson(makeEligibleSession());
    expect(proposal.candidateSkill?.section).toBe(section);
  });

  it("candidateSkill.trustScore matches returned trustScore", () => {
    const { proposal, trustScore } = distillLesson(makeEligibleSession());
    expect(proposal.candidateSkill?.trustScore).toBe(trustScore);
  });

  it("createdAt uses session.endedAt when available", () => {
    const endedAt = "2026-03-20T10:00:00.000Z";
    const session = makeEligibleSession({ endedAt });
    const { proposal } = distillLesson(session);
    expect(proposal.candidateSkill?.createdAt).toBe(endedAt);
  });
});
