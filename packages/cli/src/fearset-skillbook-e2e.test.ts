/**
 * fearset-skillbook-e2e.test.ts
 *
 * End-to-end tests for the Skillbook → FearSet prior-lessons feedback loop.
 *
 * Full data flow under test:
 *   1. runFearSetEngine (mock callbacks, gate=pass) → FearSetResult
 *   2. distillFearSetLesson(result) → DistilledLesson[]
 *   3. skillbook.applyProposals(proposals, decisions) → persists to disk
 *   4. skillbook.getRelevantSkills({ keywords }) → Skill[]
 *   5. priorLessons = skills.map(s => s.title)
 *   6. runFearSetEngine(context, trigger, callbacks, { priorLessons }) where
 *      onColumn captures the userPrompt for each column
 *   7. Assert: captured prompts contain the lesson title AND
 *              the "Prior Skillbook Lessons" header
 *
 * No real LLM required — all callbacks are in-memory mocks.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  runFearSetEngine,
  distillFearSetLesson,
  type FearSetCallbacks,
} from "@dantecode/dante-gaslight";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";
import type { FearSetTrigger } from "@dantecode/runtime-spine";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeTestDir = () => {
  const dir = join(
    tmpdir(),
    `dc-fearset-sb-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const EXPLICIT_TRIGGER: FearSetTrigger = {
  channel: "explicit-user",
  rationale: "E2E test invocation.",
  at: new Date().toISOString(),
};

const ENABLED_CONFIG = {
  enabled: true,
  mode: "standard" as const,
  maxTokensPerColumn: 50_000,
  maxSecondsPerColumn: 300,
  robustnessPassThreshold: 0.7,
  minRiskReduction: 0.2,
  policyTaskClasses: [],
  sandboxSimulation: false,
};

/** Passing gate JSON for mock callbacks. */
function makePassGateJson(): string {
  return JSON.stringify({
    overall: 0.85,
    byColumn: { define: 0.9, prevent: 0.8, repair: 0.85, benefits: 0.7, inaction: 0.7 },
    hasSimulationEvidence: false,
    estimatedRiskReduction: 0.65,
    gateDecision: "pass",
    justification: "E2E test gate.",
  });
}

/** Minimal valid column JSON strings per column type. */
function makeColumnJson(column: string): string {
  switch (column) {
    case "define":
      return JSON.stringify({
        worstCases: ["Downstream API consumers break"],
        blastRadius: "API consumers",
        reversible: false,
      });
    case "prevent":
      return JSON.stringify({
        preventionActions: [
          {
            id: "pa-1",
            description: "Deprecation notice",
            mechanism: "Email + docs",
            riskReduction: 0.7,
            simulationStatus: "non-simulatable",
          },
        ],
      });
    case "repair":
      return JSON.stringify({
        repairPlans: [
          {
            id: "rp-1",
            description: "Restore v1 endpoint",
            steps: ["Revert deploy"],
            estimatedRecovery: "1 hour",
            simulationStatus: "non-simulatable",
          },
        ],
      });
    case "benefits":
      return JSON.stringify({ benefits: ["Reduced maintenance burden", "Faster iteration on v2"] });
    case "inaction":
      return JSON.stringify({
        inactionCosts: [
          { description: "Technical debt compounds", timeHorizon: "6 months", severity: "high" },
        ],
      });
    default:
      return JSON.stringify({ rawOutput: "fallback" });
  }
}

/** Base callbacks that always pass the gate and return valid column content. */
function makePassCallbacks(overrides: Partial<FearSetCallbacks> = {}): FearSetCallbacks {
  return {
    onColumn: async (_sys, _user, column) => makeColumnJson(column),
    onGate: async () => makePassGateJson(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Skillbook → FearSet prior-lessons E2E loop", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // ── E2E-01: Full loop — distill → store → retrieve → inject → verify ─────
  it("E2E-01: lesson from 'Should we sunset the v1 API?' flows into second run's column userPrompt", async () => {
    // Step 1 — Run FearSet, gate must pass
    const result = await runFearSetEngine(
      "Should we sunset the v1 API?",
      EXPLICIT_TRIGGER,
      makePassCallbacks(),
      { config: ENABLED_CONFIG },
    );
    expect(result.passed).toBe(true);

    // Step 2 — Distill lessons from the passed result
    const lessons = distillFearSetLesson(result);
    expect(lessons.length).toBeGreaterThan(0);

    // Step 3 — Store all distilled lessons in the skillbook
    const skillbook = new DanteSkillbookIntegration({ cwd: testDir, gitStage: false });
    const { applied } = skillbook.applyProposals(
      lessons.map((l) => l.proposal),
      lessons.map(() => "pass" as const),
    );
    expect(applied).toBe(lessons.length);

    // Step 4 — Retrieve relevant skills by keywords
    const skills = skillbook.getRelevantSkills({ keywords: ["sunset", "API"] });
    expect(skills.length).toBeGreaterThan(0);
    const priorLessons = skills.map((s) => s.title);

    // Step 5 — Second FearSet run with priorLessons, capture userPrompts
    const capturedPrompts: string[] = [];
    await runFearSetEngine(
      "Should we migrate away from the v1 API?",
      EXPLICIT_TRIGGER,
      makePassCallbacks({
        onColumn: async (_sys, userPrompt, column) => {
          capturedPrompts.push(userPrompt);
          return makeColumnJson(column);
        },
      }),
      { config: ENABLED_CONFIG, priorLessons },
    );

    // Step 6 — Every captured prompt must reference a prior lesson
    expect(capturedPrompts.length).toBeGreaterThan(0);
    const hasPriorLessonHeader = capturedPrompts.some((p) => p.includes("Prior Skillbook Lessons"));
    expect(hasPriorLessonHeader).toBe(true);

    // And at least one lesson title appears verbatim in one of the prompts
    const anyTitleInjected = priorLessons.some((title) =>
      capturedPrompts.some((p) => p.includes(title)),
    );
    expect(anyTitleInjected).toBe(true);
  });

  // ── E2E-02: All 5 columns receive the prior-lessons injection ────────────
  it("E2E-02: all 5 column userPrompts contain 'Prior Skillbook Lessons' header when priorLessons is non-empty", async () => {
    const priorLessons = [
      "Always publish a migration guide before deprecating any API endpoint.",
      "Notify all API key holders 6 months before sunset.",
    ];

    const capturedByColumn: Record<string, string> = {};

    await runFearSetEngine(
      "Sunset legacy endpoint",
      EXPLICIT_TRIGGER,
      makePassCallbacks({
        onColumn: async (_sys, userPrompt, column) => {
          capturedByColumn[column] = userPrompt;
          return makeColumnJson(column);
        },
      }),
      { config: ENABLED_CONFIG, priorLessons },
    );

    const columnNames = ["define", "prevent", "repair", "benefits", "inaction"];
    for (const col of columnNames) {
      expect(capturedByColumn[col], `column ${col} missing prior lessons header`).toContain(
        "Prior Skillbook Lessons",
      );
    }
  });

  // ── E2E-03: Empty priorLessons → no injection header ─────────────────────
  it("E2E-03: empty priorLessons array → no column userPrompt contains 'Prior Skillbook Lessons'", async () => {
    const capturedPrompts: string[] = [];

    await runFearSetEngine(
      "Sunset legacy endpoint",
      EXPLICIT_TRIGGER,
      makePassCallbacks({
        onColumn: async (_sys, userPrompt, column) => {
          capturedPrompts.push(userPrompt);
          return makeColumnJson(column);
        },
      }),
      { config: ENABLED_CONFIG, priorLessons: [] },
    );

    expect(capturedPrompts.length).toBeGreaterThan(0);
    const anyHasHeader = capturedPrompts.some((p) => p.includes("Prior Skillbook Lessons"));
    expect(anyHasHeader).toBe(false);
  });
});
