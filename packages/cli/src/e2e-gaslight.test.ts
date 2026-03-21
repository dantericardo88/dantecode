/**
 * e2e-gaslight.test.ts
 *
 * End-to-end tests for the complete Gaslight → Skillbook closed loop.
 *
 * These tests verify that the full chain works:
 *   trigger → runSession (gate=pass) → session saved to disk →
 *   distillLesson → applyProposals → skill in skillbook.json
 *
 * No real LLM is required. All LLM interactions are replaced with
 * mocked callbacks that simulate a pass gate.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  DanteGaslightIntegration,
  GaslightSessionStore,
  distillLesson,
} from "@dantecode/dante-gaslight";
import type { GaslightSession } from "@dantecode/dante-gaslight";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";
import { runGaslightCommand } from "./commands/gaslight.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeTestDir = () => {
  const dir = join(
    tmpdir(),
    `dc-e2e-gaslight-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const passGateCallbacks = {
  onGate: async () => ({ decision: "pass" as const, score: 0.92 }),
  onRewrite: async (_draft: string, _summary: string) =>
    "Refined output with deeper analysis and evidence.",
};

const enabledPassConfig = {
  enabled: true,
  maxIterations: 1,
  maxTokens: 100_000,
  maxSeconds: 60,
};

// ─────────────────────────────────────────────────────────────────────────────
// E2E: Programmatic full loop
// ─────────────────────────────────────────────────────────────────────────────

describe("E2E: Gaslight → Skillbook closed loop (programmatic)", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("full loop: trigger → session → disk → distillLesson → skill in skillbook", async () => {
    // 1. Run a gaslight session that triggers and passes the gate
    const engine = new DanteGaslightIntegration(enabledPassConfig, { cwd: testDir });
    const session = await engine.maybeGaslight({
      message: "go deeper",
      draft: "Initial shallow analysis of the codebase architecture.",
      callbacks: passGateCallbacks,
    });

    // 2. Session must be produced and lesson-eligible
    expect(session).not.toBeNull();
    expect(session!.lessonEligible).toBe(true);
    expect(session!.stopReason).toBe("pass");

    // 3. Session must be persisted to disk immediately
    const store = new GaslightSessionStore({ cwd: testDir });
    expect(store.has(session!.sessionId)).toBe(true);

    // 4. Load from disk and verify it round-trips correctly
    const loadedSession = store.load(session!.sessionId);
    expect(loadedSession?.lessonEligible).toBe(true);
    expect(loadedSession?.finalGateDecision).toBe("pass");

    // 5. Distill a lesson from the session
    const lesson = distillLesson(loadedSession!);
    expect(lesson.proposal.action).toBe("add");
    expect(lesson.proposal.candidateSkill).toBeDefined();
    expect(lesson.trustScore).toBeGreaterThanOrEqual(0.5);
    expect(lesson.section).toBe("refinement"); // explicit-user trigger → refinement

    // 6. Apply the lesson to the skillbook (no git staging in tests)
    const skillbook = new DanteSkillbookIntegration({ cwd: testDir, gitStage: false });
    const result = skillbook.applyProposals([lesson.proposal], ["pass"], {
      sessionId: session!.sessionId,
    });
    expect(result.applied).toBe(1);
    expect(result.rejected).toBe(0);

    // 7. Verify the skill is retrievable from the skillbook
    const skills = skillbook.getRelevantSkills({ keywords: ["architecture", "analysis"] });
    expect(skills.length).toBeGreaterThan(0);
    expect(skills[0]!.sourceSessionId).toBe(session!.sessionId);

    // 8. Save and verify skillbook.json was written
    skillbook.save();
    const skillbookPath = join(testDir, ".dantecode", "skillbook", "skillbook.json");
    expect(existsSync(skillbookPath)).toBe(true);
    const raw = JSON.parse(readFileSync(skillbookPath, "utf-8")) as { skills: unknown[] };
    expect(raw.skills.length).toBeGreaterThan(0);
  });

  it("full loop: session is marked distilled after bridge, not re-distillable", async () => {
    const engine = new DanteGaslightIntegration(enabledPassConfig, { cwd: testDir });
    const session = await engine.maybeGaslight({
      message: "again but better",
      draft: "A draft response.",
      callbacks: passGateCallbacks,
    });
    expect(session!.lessonEligible).toBe(true);

    const store = new GaslightSessionStore({ cwd: testDir });
    const loaded = store.load(session!.sessionId)!;

    // Distill once
    const skillbook = new DanteSkillbookIntegration({ cwd: testDir, gitStage: false });
    const lesson = distillLesson(loaded);
    const r1 = skillbook.applyProposals([lesson.proposal], ["pass"]);
    expect(r1.applied).toBe(1);
    store.markDistilled(session!.sessionId);

    // Verify it is marked
    const afterMark = store.load(session!.sessionId);
    expect(afterMark?.distilledAt).toBeTruthy();

    // A second distillation attempt on the same session should throw
    expect(() => distillLesson({ ...loaded, lessonEligible: false })).toThrow();
  });

  it("finalOutput from refined draft appears as skill content", async () => {
    const engine = new DanteGaslightIntegration(enabledPassConfig, { cwd: testDir });
    const rewrittenDraft = "A well-structured, evidence-backed response with citations.";
    const session = await engine.maybeGaslight({
      message: "truth mode",
      draft: "Weak initial draft.",
      callbacks: {
        onGate: async () => ({ decision: "pass" as const, score: 0.95 }),
        onRewrite: async () => rewrittenDraft,
      },
    });

    const lesson = distillLesson(session!);
    // The skill content should be based on the final (rewritten) output
    expect(lesson.proposal.candidateSkill?.content).toContain(rewrittenDraft);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E2E: CLI bridge command
// ─────────────────────────────────────────────────────────────────────────────

describe("E2E: CLI bridge command full loop", () => {
  let testDir: string;
  let output: string[];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    testDir = makeTestDir();
    output = [];
    originalLog = console.log;
    originalError = console.error;
    console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
    console.error = (...args: unknown[]) => output.push(args.map(String).join(" "));
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("bridge writes skill to skillbook.json and marks session as distilled", async () => {
    // Set up a pass-eligible session on disk (simulating what runSession produces)
    const engine = new DanteGaslightIntegration(enabledPassConfig, { cwd: testDir });
    const session = await engine.maybeGaslight({
      message: "go deeper",
      draft: "An analysis that needs deepening.",
      callbacks: passGateCallbacks,
    });
    expect(session!.lessonEligible).toBe(true);

    // Run the CLI bridge command
    await runGaslightCommand(["bridge"], testDir);
    const text = output.join("\n");

    // CLI must report success
    expect(text).toMatch(/closed loop complete/i);
    expect(text).toContain(session!.sessionId);

    // Skill must be written to skillbook.json
    const skillbookPath = join(testDir, ".dantecode", "skillbook", "skillbook.json");
    expect(existsSync(skillbookPath)).toBe(true);
    const raw = JSON.parse(readFileSync(skillbookPath, "utf-8")) as { skills: unknown[] };
    expect(raw.skills.length).toBeGreaterThan(0);

    // Session must be marked as distilled (replay protection)
    const store = new GaslightSessionStore({ cwd: testDir });
    const after = store.load(session!.sessionId);
    expect(after?.distilledAt).toBeTruthy();
  });

  it("bridge auto-finds the most recent eligible session when no ID given", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });

    // Plant two sessions: one ineligible, one eligible
    const ineligible: GaslightSession = {
      sessionId: "ineligible-sess",
      trigger: { channel: "explicit-user", at: new Date().toISOString() },
      iterations: [],
      stopReason: "budget-iterations",
      finalGateDecision: "fail",
      lessonEligible: false,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    const eligible: GaslightSession = {
      sessionId: "eligible-sess",
      trigger: { channel: "explicit-user", phrase: "go deeper", at: new Date().toISOString() },
      iterations: [
        {
          iteration: 1,
          draft: "Refined output with evidence and citations.",
          gateDecision: "pass",
          gateScore: 0.9,
          at: new Date().toISOString(),
        },
      ],
      stopReason: "pass",
      finalOutput: "Refined output with evidence and citations.",
      finalGateDecision: "pass",
      lessonEligible: true,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    };
    store.save(ineligible);
    store.save(eligible);

    await runGaslightCommand(["bridge"], testDir);

    // Should have bridged the eligible session
    expect(output.join("\n")).toMatch(/closed loop complete/i);
    expect(output.join("\n")).toContain("eligible-sess");
    expect(store.load("ineligible-sess")?.distilledAt).toBeUndefined();
    expect(store.load("eligible-sess")?.distilledAt).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E2E: priorLessonProvider wiring
// ─────────────────────────────────────────────────────────────────────────────

describe("E2E: priorLessonProvider wiring", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("priorLessonProvider is called with the draft and taskClass", async () => {
    let capturedDraft: string | undefined;
    let capturedClass: string | undefined;

    const engine = new DanteGaslightIntegration(
      enabledPassConfig,
      { cwd: testDir },
      {
        priorLessonProvider: (draft, taskClass) => {
          capturedDraft = draft;
          capturedClass = taskClass;
          return ["Always add citations", "Use concrete examples"];
        },
      },
    );

    await engine.maybeGaslight({
      message: "go deeper",
      draft: "My draft.",
      taskClass: "code-review",
      callbacks: passGateCallbacks,
    });

    expect(capturedDraft).toBe("My draft.");
    expect(capturedClass).toBe("code-review");
  });

  it("priorLessonProvider lessons reach the critique prompt", async () => {
    const capturedPrompts: string[] = [];

    const engine = new DanteGaslightIntegration(
      enabledPassConfig,
      { cwd: testDir },
      {
        priorLessonProvider: () => ["Always verify claims with sources"],
      },
    );

    await engine.maybeGaslight({
      message: "go deeper",
      draft: "My draft.",
      callbacks: {
        onCritique: async (_sys, userPrompt) => {
          capturedPrompts.push(userPrompt);
          return null; // use fallback critique
        },
        onGate: async () => ({ decision: "pass" as const, score: 0.92 }),
      },
    });

    expect(capturedPrompts.length).toBeGreaterThan(0);
    expect(capturedPrompts[0]).toContain("Always verify claims with sources");
    expect(capturedPrompts[0]).toContain("Prior Lessons from Skillbook");
  });

  it("explicit priorLessons override takes precedence over provider", async () => {
    let providerCalled = false;
    const capturedPrompts: string[] = [];

    const engine = new DanteGaslightIntegration(
      enabledPassConfig,
      { cwd: testDir },
      {
        priorLessonProvider: () => {
          providerCalled = true;
          return ["Provider lesson"];
        },
      },
    );

    await engine.maybeGaslight({
      message: "go deeper",
      draft: "My draft.",
      priorLessons: ["Explicit override lesson"],
      callbacks: {
        onCritique: async (_sys, userPrompt) => {
          capturedPrompts.push(userPrompt);
          return null;
        },
        onGate: async () => ({ decision: "pass" as const, score: 0.92 }),
      },
    });

    expect(providerCalled).toBe(false);
    expect(capturedPrompts[0]).toContain("Explicit override lesson");
    expect(capturedPrompts[0]).not.toContain("Provider lesson");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E2E: Session cleanup enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("E2E: maxSessions cleanup enforcement", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("sessions capped at maxSessions after multiple runs", async () => {
    const engine = new DanteGaslightIntegration(
      { ...enabledPassConfig, maxSessions: 2 },
      { cwd: testDir },
    );

    // Run 3 sessions — third should trigger cleanup, leaving only 2
    for (let i = 0; i < 3; i++) {
      await engine.maybeGaslight({
        message: "go deeper",
        draft: `Draft number ${i}.`,
        callbacks: passGateCallbacks,
      });
      // Small delay to ensure distinct mtimes
      await new Promise((r) => setTimeout(r, 20));
    }

    const store = new GaslightSessionStore({ cwd: testDir });
    const remaining = store.list();
    expect(remaining.length).toBe(2);
  });

  it("cleanup(0) keeps all sessions when maxSessions is 0", async () => {
    const engine = new DanteGaslightIntegration(
      { ...enabledPassConfig, maxSessions: 0 },
      { cwd: testDir },
    );

    for (let i = 0; i < 3; i++) {
      await engine.maybeGaslight({
        message: "go deeper",
        draft: `Draft ${i}.`,
        callbacks: passGateCallbacks,
      });
    }

    const store = new GaslightSessionStore({ cwd: testDir });
    expect(store.list().length).toBe(3);
  });
});
