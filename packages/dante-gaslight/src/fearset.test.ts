/**
 * fearset.test.ts
 *
 * Comprehensive tests for the DanteFearSet engine:
 *  - risk-classifier: classifyRisk, buildFearSetTrigger
 *  - gaslighter-role: buildFearSetColumnPrompt, parseFearSetColumnOutput,
 *                     buildFearSetRobustnessPrompt
 *  - fearset-engine: runFearSetEngine (offline, lite, isStopped, onColumnComplete,
 *                    heuristic gate, LLM gate, sandbox simulation)
 *  - lesson-distiller: distillFearSetLesson
 *  - fearset-stats: computeFearSetStats, formatFearSetStats
 *  - integration: DanteGaslightIntegration FearSet surface
 *
 * Golden flows:
 *  GF-01 — Full manual /fearset run through integration with mock callbacks
 *  GF-04 — distillFearSetLessons writes FearSet-tagged sections
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ─── Subjects ────────────────────────────────────────────────────────────────

import {
  classifyRisk,
  classifyRiskWithLlm,
  parseLlmClassification,
  FEARSET_CLASSIFY_RUBRIC,
  buildFearSetTrigger,
} from "./risk-classifier.js";
import {
  buildFearSetColumnPrompt,
  parseFearSetColumnOutput,
  buildFearSetRobustnessPrompt,
  FEARSET_SYSTEM_PROMPT,
} from "./gaslighter-role.js";
import {
  runFearSetEngine,
  type FearSetCallbacks,
} from "./fearset-engine.js";
import { distillFearSetLesson } from "./lesson-distiller.js";
import { computeFearSetStats, formatFearSetStats } from "./fearset-stats.js";
import { DanteGaslightIntegration } from "./integration.js";

// ─── Types ───────────────────────────────────────────────────────────────────

import type {
  FearSetResult,
  FearSetTrigger,
  FearColumn,
  FearSetColumnName,
} from "@dantecode/runtime-spine";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const makeTestDir = () => {
  const dir = join(
    tmpdir(),
    `dc-fearset-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const ENABLED_FEARSET_CONFIG = {
  enabled: true,
  mode: "standard" as const,
  maxTokensPerColumn: 50_000,
  maxSecondsPerColumn: 300,
  robustnessPassThreshold: 0.7,
  minRiskReduction: 0.2,
  policyTaskClasses: ["destructive-op", "architecture-decision"],
  sandboxSimulation: false,
};

/** A minimal passing trigger for explicit-user channel. */
const EXPLICIT_TRIGGER: FearSetTrigger = {
  channel: "explicit-user",
  rationale: "Manual /fearset invocation.",
  at: new Date().toISOString(),
};

/** Build a valid define-column JSON string. */
function makeDefineJson(worstCases: string[] = ["data loss", "downtime"]): string {
  return JSON.stringify({
    worstCases,
    blastRadius: "All production users",
    reversible: false,
  });
}

/** Build a valid prevent-column JSON string. */
function makePreventJson(): string {
  return JSON.stringify({
    preventionActions: [
      {
        id: "pa-1",
        description: "Enable feature flags",
        mechanism: "Gradual rollout to 5% of users first",
        riskReduction: 0.7,
        simulationStatus: "non-simulatable",
      },
    ],
  });
}

/** Build a valid repair-column JSON string. */
function makeRepairJson(): string {
  return JSON.stringify({
    repairPlans: [
      {
        id: "rp-1",
        description: "Rollback via git revert",
        steps: ["Identify bad commit", "Run git revert", "Deploy hotfix"],
        estimatedRecovery: "30 minutes",
        simulationStatus: "non-simulatable",
      },
    ],
  });
}

/** Build a valid benefits-column JSON string. */
function makeBenefitsJson(): string {
  return JSON.stringify({
    benefits: ["Increased user engagement", "10% revenue lift"],
  });
}

/** Build a valid inaction-column JSON string. */
function makeInactionJson(): string {
  return JSON.stringify({
    inactionCosts: [
      {
        description: "Competitors will ship first",
        timeHorizon: "3 months",
        severity: "high",
      },
    ],
  });
}

/** Build a passing robustness gate response JSON string. */
function makeGatePassJson(): string {
  return JSON.stringify({
    overall: 0.85,
    byColumn: {
      define: 0.9,
      prevent: 0.8,
      repair: 0.85,
      benefits: 0.7,
      inaction: 0.7,
    },
    hasSimulationEvidence: false,
    estimatedRiskReduction: 0.65,
    gateDecision: "pass",
    justification: "All five columns are substantive and actionable.",
  });
}

/**
 * Build a set of standard mock callbacks that return valid JSON for each column
 * and a passing gate. Suitable for full-run tests.
 */
function makeMockCallbacks(overrides: Partial<FearSetCallbacks> = {}): FearSetCallbacks {
  return {
    onColumn: async (_sys, _user, column) => {
      switch (column) {
        case "define":
          return makeDefineJson();
        case "prevent":
          return makePreventJson();
        case "repair":
          return makeRepairJson();
        case "benefits":
          return makeBenefitsJson();
        case "inaction":
          return makeInactionJson();
        default:
          return JSON.stringify({ rawOutput: "fallback" });
      }
    },
    onGate: async () => makeGatePassJson(),
    ...overrides,
  };
}

/**
 * Build a minimal FearSetResult that has passed the gate and contains
 * substantive columns (with parsed data). Used in distillation and stats tests.
 */
function makePassedResult(overrides: Partial<FearSetResult> = {}): FearSetResult {
  const now = new Date().toISOString();
  const base: FearSetResult = {
    id: "00000000-0000-0000-0000-000000000001",
    trigger: EXPLICIT_TRIGGER,
    context: "Should I launch this feature to prod?",
    columns: [
      {
        name: "define",
        rawOutput: makeDefineJson(["Data corruption", "Auth failure"]),
        worstCases: ["Data corruption", "Auth failure"],
        preventionActions: [],
        repairPlans: [],
        benefits: [],
        inactionCosts: [],
        completedAt: now,
      },
      {
        name: "prevent",
        rawOutput: makePreventJson(),
        worstCases: [],
        preventionActions: [
          {
            id: "pa-1",
            description: "Feature flags",
            mechanism: "Gradual rollout",
            riskReduction: 0.6,
            simulationStatus: "non-simulatable",
          },
        ],
        repairPlans: [],
        benefits: [],
        inactionCosts: [],
        completedAt: now,
      },
      {
        name: "repair",
        rawOutput: makeRepairJson(),
        worstCases: [],
        preventionActions: [],
        repairPlans: [
          {
            id: "rp-1",
            description: "Rollback",
            steps: ["Identify commit", "Revert", "Deploy"],
            estimatedRecovery: "30 min",
            simulationStatus: "non-simulatable",
          },
        ],
        benefits: [],
        inactionCosts: [],
        completedAt: now,
      },
      {
        name: "benefits",
        rawOutput: makeBenefitsJson(),
        worstCases: [],
        preventionActions: [],
        repairPlans: [],
        benefits: ["More engagement"],
        inactionCosts: [],
        completedAt: now,
      },
      {
        name: "inaction",
        rawOutput: makeInactionJson(),
        worstCases: [],
        preventionActions: [],
        repairPlans: [],
        benefits: [],
        inactionCosts: [
          { description: "Competitors ship first", timeHorizon: "3 months", severity: "high" },
        ],
        completedAt: now,
      },
    ],
    robustnessScore: {
      overall: 0.82,
      byColumn: { define: 0.9, prevent: 0.8, repair: 0.8, benefits: 0.7, inaction: 0.7 },
      hasSimulationEvidence: false,
      estimatedRiskReduction: 0.6,
      gateDecision: "pass",
      justification: "All columns populated.",
      scoredAt: now,
    },
    passed: true,
    mode: "standard",
    startedAt: now,
    completedAt: now,
    ...overrides,
  };
  return base;
}

// ═════════════════════════════════════════════════════════════════════════════
// classifyRisk
// ═════════════════════════════════════════════════════════════════════════════

describe("classifyRisk", () => {
  const cfg = { enabled: true, policyTaskClasses: ["destructive-op"] };

  it("returns shouldTrigger=false and channel=null when FearSet is disabled", () => {
    const r = classifyRisk("/fearset check this", { config: { enabled: false, policyTaskClasses: [] } });
    expect(r.shouldTrigger).toBe(false);
    expect(r.channel).toBeNull();
    expect(r.reasons).toContain("FearSet disabled");
    expect(r.confidence).toBe(1);
  });

  it("returns shouldTrigger=false when config is omitted (undefined treated as disabled)", () => {
    const r = classifyRisk("/fearset go");
    expect(r.shouldTrigger).toBe(false);
    expect(r.channel).toBeNull();
  });

  it("detects explicit-user channel via /fearset prefix", () => {
    const r = classifyRisk("/fearset Should I launch this?", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("explicit-user");
    expect(r.confidence).toBe(1.0);
  });

  it("detects explicit-user channel via 'worst-case scenario' phrase", () => {
    const r = classifyRisk("What is the worst-case scenario here?", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("explicit-user");
  });

  it("detects explicit-user channel via 'should I launch' phrase", () => {
    const r = classifyRisk("Should I launch to production right now?", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("explicit-user");
  });

  it("detects explicit-user channel via 'what could go wrong'", () => {
    const r = classifyRisk("what could go wrong with this migration", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("explicit-user");
  });

  it("detects destructive channel for rm -rf", () => {
    const r = classifyRisk("I need to rm -rf the old data directory", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("destructive");
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it("detects destructive channel for drop table", () => {
    const r = classifyRisk("drop table users in production", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("destructive");
  });

  it("detects destructive channel for purge data", () => {
    const r = classifyRisk("We will purge data from the old DB", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("destructive");
  });

  it("detects destructive channel for 'nuke'", () => {
    const r = classifyRisk("Let's nuke the staging environment", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("destructive");
  });

  it("detects long-horizon channel for 'over the next quarter'", () => {
    const r = classifyRisk("Let's plan this over the next quarter", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("long-horizon");
    expect(r.confidence).toBeCloseTo(0.75);
  });

  it("detects long-horizon channel for 'multi-phase'", () => {
    const r = classifyRisk("This is a multi-phase migration plan", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("long-horizon");
  });

  it("detects long-horizon channel for 'road-map'", () => {
    const r = classifyRisk("Build the road-map for Q3", { config: cfg });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("long-horizon");
  });

  it("detects policy channel when taskClass is in policyTaskClasses", () => {
    const r = classifyRisk("Ordinary task description", {
      taskClass: "destructive-op",
      config: cfg,
    });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("policy");
    expect(r.confidence).toBeCloseTo(0.85);
  });

  it("does not trigger policy channel when taskClass is not in policyTaskClasses", () => {
    const r = classifyRisk("Ordinary task description", {
      taskClass: "code-review",
      config: cfg,
    });
    expect(r.shouldTrigger).toBe(false);
  });

  it("detects weak-robustness channel when verificationScore < 0.5", () => {
    const r = classifyRisk("Some plan here", {
      verificationScore: 0.3,
      config: cfg,
    });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("weak-robustness");
    expect(r.confidence).toBeCloseTo(0.8);
    expect(r.reasons[0]).toContain("0.30");
  });

  it("does not trigger weak-robustness when verificationScore >= 0.5", () => {
    const r = classifyRisk("Some plan here", {
      verificationScore: 0.5,
      config: cfg,
    });
    expect(r.shouldTrigger).toBe(false);
  });

  it("detects repeated-failure channel when priorFailureCount >= 2", () => {
    const r = classifyRisk("This task keeps failing", {
      priorFailureCount: 3,
      config: cfg,
    });
    expect(r.shouldTrigger).toBe(true);
    expect(r.channel).toBe("repeated-failure");
    expect(r.confidence).toBeCloseTo(0.85);
    expect(r.reasons[0]).toContain("3 prior failures");
  });

  it("does not trigger repeated-failure when priorFailureCount < 2", () => {
    const r = classifyRisk("This task keeps failing", {
      priorFailureCount: 1,
      config: cfg,
    });
    expect(r.shouldTrigger).toBe(false);
  });

  it("explicit-user channel takes priority over destructive", () => {
    const r = classifyRisk("/fearset should I rm -rf this?", { config: cfg });
    expect(r.channel).toBe("explicit-user");
  });

  it("returns reasons array with at least one entry on trigger", () => {
    const r = classifyRisk("/fearset go", { config: cfg });
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildFearSetTrigger
// ═════════════════════════════════════════════════════════════════════════════

describe("buildFearSetTrigger", () => {
  it("returns null when shouldTrigger is false", () => {
    const classification = { shouldTrigger: false, channel: null, reasons: [], confidence: 1 };
    expect(buildFearSetTrigger(classification)).toBeNull();
  });

  it("returns null when channel is null even if shouldTrigger is true", () => {
    const classification = { shouldTrigger: true, channel: null, reasons: [], confidence: 1 };
    expect(buildFearSetTrigger(classification)).toBeNull();
  });

  it("builds trigger with correct channel from classification", () => {
    const classification = {
      shouldTrigger: true,
      channel: "explicit-user" as const,
      reasons: ["Explicit /fearset detected."],
      confidence: 1.0,
    };
    const trigger = buildFearSetTrigger(classification);
    expect(trigger).not.toBeNull();
    expect(trigger!.channel).toBe("explicit-user");
  });

  it("rationale joins all reasons with a space", () => {
    const classification = {
      shouldTrigger: true,
      channel: "destructive" as const,
      reasons: ["Reason A.", "Reason B."],
      confidence: 0.9,
    };
    const trigger = buildFearSetTrigger(classification);
    expect(trigger!.rationale).toBe("Reason A. Reason B.");
  });

  it("injects taskClass into trigger when provided", () => {
    const classification = {
      shouldTrigger: true,
      channel: "policy" as const,
      reasons: ["Policy match."],
      confidence: 0.85,
    };
    const trigger = buildFearSetTrigger(classification, { taskClass: "architecture-decision" });
    expect(trigger!.taskClass).toBe("architecture-decision");
  });

  it("injects sessionId into trigger when provided", () => {
    const classification = {
      shouldTrigger: true,
      channel: "repeated-failure" as const,
      reasons: ["3 failures."],
      confidence: 0.85,
    };
    const trigger = buildFearSetTrigger(classification, { sessionId: "sess-xyz" });
    expect(trigger!.sessionId).toBe("sess-xyz");
  });

  it("trigger.at is a valid ISO timestamp string", () => {
    const classification = {
      shouldTrigger: true,
      channel: "long-horizon" as const,
      reasons: ["Long horizon."],
      confidence: 0.75,
    };
    const trigger = buildFearSetTrigger(classification);
    expect(() => new Date(trigger!.at)).not.toThrow();
    expect(new Date(trigger!.at).getFullYear()).toBeGreaterThan(2020);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildFearSetColumnPrompt
// ═════════════════════════════════════════════════════════════════════════════

describe("buildFearSetColumnPrompt", () => {
  const CTX = "Should I launch this feature to prod?";

  it("returns a non-empty string for each column", () => {
    const columns: FearSetColumnName[] = ["define", "prevent", "repair", "benefits", "inaction"];
    for (const col of columns) {
      const prompt = buildFearSetColumnPrompt(CTX, col);
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(20);
    }
  });

  it("includes the decision context in the prompt", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "define");
    expect(prompt).toContain(CTX);
  });

  it("includes the column keyword in the prompt (DEFINE)", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "define");
    expect(prompt.toUpperCase()).toContain("DEFINE");
  });

  it("includes the column keyword in the prompt (PREVENT)", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "prevent");
    expect(prompt.toUpperCase()).toContain("PREVENT");
  });

  it("includes the column keyword in the prompt (REPAIR)", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "repair");
    expect(prompt.toUpperCase()).toContain("REPAIR");
  });

  it("includes the column keyword in the prompt (BENEFITS)", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "benefits");
    expect(prompt.toUpperCase()).toContain("BENEFITS");
  });

  it("includes the column keyword in the prompt (INACTION)", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "inaction");
    expect(prompt.toUpperCase()).toContain("INACTION");
  });

  it("injects prior lessons when provided", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "define", {}, ["Lesson one", "Lesson two"]);
    expect(prompt).toContain("Lesson one");
    expect(prompt).toContain("Lesson two");
    expect(prompt).toContain("Prior Skillbook Lessons");
  });

  it("does not include lessons section when priorLessons is empty", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "define", {}, []);
    expect(prompt).not.toContain("Prior Skillbook Lessons");
  });

  it("includes prior column outputs when provided", () => {
    const priorOutputs = { define: "Worst case: data loss" };
    const prompt = buildFearSetColumnPrompt(CTX, "prevent", priorOutputs);
    expect(prompt).toContain("Worst case: data loss");
    expect(prompt).toContain("Prior Column Outputs");
  });

  it("labels prior column output with uppercased column name", () => {
    const priorOutputs = { define: "Some output" };
    const prompt = buildFearSetColumnPrompt(CTX, "prevent", priorOutputs);
    expect(prompt).toContain("DEFINE");
  });

  it("does not include prior column section when priorColumnOutputs is empty", () => {
    const prompt = buildFearSetColumnPrompt(CTX, "prevent", {});
    expect(prompt).not.toContain("Prior Column Outputs");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// parseFearSetColumnOutput
// ═════════════════════════════════════════════════════════════════════════════

describe("parseFearSetColumnOutput", () => {
  it("parses valid JSON wrapped in other text", () => {
    const raw = `Here is my analysis:\n${JSON.stringify({ worstCases: ["loss", "downtime"] })}`;
    const result = parseFearSetColumnOutput(raw, "define");
    expect(result).not.toBeNull();
    expect(Array.isArray((result as Record<string, unknown>)["worstCases"])).toBe(true);
  });

  it("returns null when raw string contains no JSON object", () => {
    const result = parseFearSetColumnOutput("No JSON here at all", "define");
    expect(result).toBeNull();
  });

  it("returns null on malformed JSON", () => {
    const result = parseFearSetColumnOutput("{ bad json: [", "define");
    expect(result).toBeNull();
  });

  it("preserves all fields from parsed JSON", () => {
    const raw = JSON.stringify({
      preventionActions: [{ id: "x", description: "d", mechanism: "m", riskReduction: 0.5 }],
    });
    const result = parseFearSetColumnOutput(raw, "prevent");
    expect(result).not.toBeNull();
    const actions = (result as Record<string, unknown>)["preventionActions"];
    expect(Array.isArray(actions)).toBe(true);
  });

  it("injects rawOutput field when missing from JSON", () => {
    const raw = JSON.stringify({ benefits: ["gain A"] });
    const result = parseFearSetColumnOutput(raw, "benefits");
    expect(result).not.toBeNull();
    expect(typeof (result as Record<string, unknown>)["rawOutput"]).toBe("string");
  });

  it("does not overwrite existing rawOutput field", () => {
    const raw = JSON.stringify({ rawOutput: "explicit", worstCases: [] });
    const result = parseFearSetColumnOutput(raw, "define");
    expect((result as Record<string, unknown>)["rawOutput"]).toBe("explicit");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildFearSetRobustnessPrompt
// ═════════════════════════════════════════════════════════════════════════════

describe("buildFearSetRobustnessPrompt", () => {
  const columns = [
    { name: "define" as const, rawOutput: "Define output here" },
    { name: "prevent" as const, rawOutput: "Prevent output here" },
    { name: "repair" as const, rawOutput: "Repair output here" },
  ];

  it("returns a non-empty string", () => {
    const prompt = buildFearSetRobustnessPrompt(columns, "some context");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  it("includes the context in the prompt", () => {
    const prompt = buildFearSetRobustnessPrompt(columns, "Launch feature to prod");
    expect(prompt).toContain("Launch feature to prod");
  });

  it("includes rawOutput text from each column", () => {
    const prompt = buildFearSetRobustnessPrompt(columns, "ctx");
    expect(prompt).toContain("Define output here");
    expect(prompt).toContain("Prevent output here");
    expect(prompt).toContain("Repair output here");
  });

  it("includes all five column names as uppercase headers", () => {
    const allCols = [
      { name: "define" as const, rawOutput: "d" },
      { name: "prevent" as const, rawOutput: "p" },
      { name: "repair" as const, rawOutput: "r" },
      { name: "benefits" as const, rawOutput: "b" },
      { name: "inaction" as const, rawOutput: "i" },
    ];
    const prompt = buildFearSetRobustnessPrompt(allCols, "ctx");
    for (const name of ["DEFINE", "PREVENT", "REPAIR", "BENEFITS", "INACTION"]) {
      expect(prompt).toContain(name);
    }
  });

  it("mentions gateDecision in expected JSON schema section", () => {
    const prompt = buildFearSetRobustnessPrompt(columns, "ctx");
    expect(prompt).toContain("gateDecision");
  });

  it("asks for 'overall' robustness number in prompt", () => {
    const prompt = buildFearSetRobustnessPrompt(columns, "ctx");
    expect(prompt).toContain("overall");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// runFearSetEngine — offline / fallback mode
// ═════════════════════════════════════════════════════════════════════════════

describe("runFearSetEngine — offline/fallback mode (no callbacks)", () => {
  it("returns a FearSetResult with an id (UUID)", async () => {
    const result = await runFearSetEngine(
      "Should I launch?",
      EXPLICIT_TRIGGER,
      {},
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("runs all 5 columns in standard mode", async () => {
    const result = await runFearSetEngine(
      "Should I launch?",
      EXPLICIT_TRIGGER,
      {},
      { config: ENABLED_FEARSET_CONFIG },
    );
    const names = result.columns.map((c) => c.name);
    expect(names).toContain("define");
    expect(names).toContain("prevent");
    expect(names).toContain("repair");
    expect(names).toContain("benefits");
    expect(names).toContain("inaction");
    expect(result.columns).toHaveLength(5);
  });

  it("populates rawOutput on fallback columns with offline marker", async () => {
    const result = await runFearSetEngine(
      "Some context",
      EXPLICIT_TRIGGER,
      {},
      { config: ENABLED_FEARSET_CONFIG },
    );
    for (const col of result.columns) {
      expect(col.rawOutput).toContain("offline mode");
    }
  });

  it("uses heuristic gate when no onGate callback is provided", async () => {
    const result = await runFearSetEngine(
      "Some context",
      EXPLICIT_TRIGGER,
      {},
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.robustnessScore).toBeDefined();
    expect(["pass", "fail", "review-required"]).toContain(result.robustnessScore!.gateDecision);
  });

  it("stores context and trigger in result", async () => {
    const ctx = "Deploy to staging tonight";
    const result = await runFearSetEngine(
      ctx,
      EXPLICIT_TRIGGER,
      {},
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.context).toBe(ctx);
    expect(result.trigger.channel).toBe("explicit-user");
  });

  it("sets mode = standard by default", async () => {
    const result = await runFearSetEngine(
      "Some context",
      EXPLICIT_TRIGGER,
      {},
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.mode).toBe("standard");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// runFearSetEngine — lite mode
// ═════════════════════════════════════════════════════════════════════════════

describe("runFearSetEngine — lite mode", () => {
  it("runs only 3 columns (define, prevent, repair)", async () => {
    const result = await runFearSetEngine(
      "Should I launch?",
      EXPLICIT_TRIGGER,
      {},
      { config: { ...ENABLED_FEARSET_CONFIG, mode: "lite" } },
    );
    const names = result.columns.map((c) => c.name);
    expect(names).toHaveLength(3);
    expect(names).toContain("define");
    expect(names).toContain("prevent");
    expect(names).toContain("repair");
    expect(names).not.toContain("benefits");
    expect(names).not.toContain("inaction");
  });

  it("sets mode = lite in result", async () => {
    const result = await runFearSetEngine(
      "Some context",
      EXPLICIT_TRIGGER,
      {},
      { config: { ...ENABLED_FEARSET_CONFIG, mode: "lite" } },
    );
    expect(result.mode).toBe("lite");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// runFearSetEngine — isStopped halts early
// ═════════════════════════════════════════════════════════════════════════════

describe("runFearSetEngine — isStopped callback", () => {
  it("halts after the first column when isStopped returns true immediately", async () => {
    let callCount = 0;
    const result = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        onColumn: async () => { callCount++; return makeDefineJson(); },
        isStopped: () => callCount >= 1,
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    // isStopped is checked BEFORE each column — after 1 completes it fires before column 2
    expect(result.columns.length).toBeLessThan(5);
  });

  it("returns result even when stopped early (no robustness score gate)", async () => {
    const result = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      { isStopped: () => true },
      { config: ENABLED_FEARSET_CONFIG },
    );
    // stopped before any column runs — no gate runs
    expect(result).toBeDefined();
    expect(result.passed).toBe(false);
  });

  it("sets completedAt on early-stop result", async () => {
    const result = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      { isStopped: () => true },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.completedAt).toBeTruthy();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// runFearSetEngine — onColumnComplete callback
// ═════════════════════════════════════════════════════════════════════════════

describe("runFearSetEngine — onColumnComplete callback", () => {
  it("fires once per completed column in standard mode", async () => {
    const fired: FearSetColumnName[] = [];
    await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onColumnComplete: (col) => { fired.push(col); },
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(fired).toHaveLength(5);
    expect(fired).toContain("define");
    expect(fired).toContain("prevent");
    expect(fired).toContain("repair");
    expect(fired).toContain("benefits");
    expect(fired).toContain("inaction");
  });

  it("provides the FearColumn object to onColumnComplete", async () => {
    const captured: FearColumn[] = [];
    await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onColumnComplete: (_col, fc) => { captured.push(fc); },
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(captured).toHaveLength(5);
    for (const col of captured) {
      expect(col.rawOutput).toBeTruthy();
    }
  });

  it("fires in column order (define first)", async () => {
    const order: FearSetColumnName[] = [];
    await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onColumnComplete: (col) => { order.push(col); },
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(order[0]).toBe("define");
    expect(order[4]).toBe("inaction");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// runFearSetEngine — onComplete callback
// ═════════════════════════════════════════════════════════════════════════════

describe("runFearSetEngine — onComplete callback", () => {
  it("fires exactly once when run completes normally", async () => {
    let callCount = 0;
    await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onComplete: () => { callCount++; },
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(callCount).toBe(1);
  });

  it("fires with the final FearSetResult", async () => {
    let captured: FearSetResult | null = null;
    const result = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onComplete: (r) => { captured = r; },
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(captured).not.toBeNull();
    expect(captured!.id).toBe(result.id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// runFearSetEngine — passed=true when heuristic gate passes
// ═════════════════════════════════════════════════════════════════════════════

describe("runFearSetEngine — heuristic gate scoring", () => {
  it("passed=true when define/prevent/repair columns have real parsed data", async () => {
    const result = await runFearSetEngine(
      "Should I launch?",
      EXPLICIT_TRIGGER,
      makeMockCallbacks(),
      { config: ENABLED_FEARSET_CONFIG },
    );
    // The mock callbacks return valid JSON with worstCases/preventionActions/repairPlans
    expect(result.robustnessScore).toBeDefined();
    // Heuristic scores the populated columns high — gate should pass
    expect(result.passed).toBe(true);
  });

  it("heuristic score is higher with populated columns than fallback columns", async () => {
    const populated = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onGate: undefined }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    const fallback = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {},
      { config: ENABLED_FEARSET_CONFIG },
    );
    const popScore = populated.robustnessScore?.overall ?? 0;
    const fallbackScore = fallback.robustnessScore?.overall ?? 0;
    expect(popScore).toBeGreaterThan(fallbackScore);
  });

  it("LLM gate response overrides heuristic when onGate is provided", async () => {
    const gateResponse = JSON.stringify({
      overall: 0.95,
      hasSimulationEvidence: true,
      estimatedRiskReduction: 0.8,
      gateDecision: "pass",
      justification: "LLM rated this extremely robust.",
    });
    const result = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onGate: async () => gateResponse,
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.robustnessScore?.overall).toBeCloseTo(0.95);
    expect(result.robustnessScore?.justification).toContain("LLM rated");
    expect(result.passed).toBe(true);
  });

  it("falls back to heuristic when onGate returns null", async () => {
    const result = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onGate: async () => null,
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.robustnessScore).toBeDefined();
    // Heuristic justification is distinguishable
    expect(result.robustnessScore?.justification).toContain("Heuristic");
  });

  it("falls back to heuristic when onGate returns invalid JSON", async () => {
    const result = await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onGate: async () => "not json at all",
      },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.robustnessScore).toBeDefined();
    expect(result.robustnessScore?.justification).toContain("Heuristic");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// runFearSetEngine — system prompt is passed to onColumn
// ═════════════════════════════════════════════════════════════════════════════

describe("runFearSetEngine — system prompt forwarding", () => {
  it("passes FEARSET_SYSTEM_PROMPT as first arg to onColumn", async () => {
    const capturedPrompts: string[] = [];
    await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        onColumn: async (sys) => {
          capturedPrompts.push(sys);
          return makeDefineJson();
        },
      },
      { config: { ...ENABLED_FEARSET_CONFIG, mode: "lite" } },
    );
    expect(capturedPrompts.length).toBeGreaterThan(0);
    for (const p of capturedPrompts) {
      expect(p).toBe(FEARSET_SYSTEM_PROMPT);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// runFearSetEngine — prior lessons are injected into column prompts
// ═════════════════════════════════════════════════════════════════════════════

describe("runFearSetEngine — priorLessons injection", () => {
  it("injects prior lessons into each column prompt", async () => {
    const capturedUserPrompts: string[] = [];
    await runFearSetEngine(
      "Context",
      EXPLICIT_TRIGGER,
      {
        onColumn: async (_sys, user, column) => {
          capturedUserPrompts.push(user);
          return column === "define" ? makeDefineJson() : JSON.stringify({});
        },
      },
      {
        config: { ...ENABLED_FEARSET_CONFIG, mode: "lite" },
        priorLessons: ["Lesson alpha", "Lesson beta"],
      },
    );
    for (const prompt of capturedUserPrompts) {
      expect(prompt).toContain("Lesson alpha");
      expect(prompt).toContain("Lesson beta");
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// distillFearSetLesson
// ═════════════════════════════════════════════════════════════════════════════

describe("distillFearSetLesson", () => {
  it("throws when result.passed === false", () => {
    const result = makePassedResult({ passed: false });
    expect(() => distillFearSetLesson(result)).toThrow(/did not pass/);
  });

  it("error message contains result ID", () => {
    const result = makePassedResult({ passed: false });
    expect(() => distillFearSetLesson(result)).toThrow(result.id);
  });

  it("returns one lesson per substantive column (5 columns → 5 lessons)", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    expect(lessons).toHaveLength(5);
  });

  it("skips columns with empty rawOutput", () => {
    const result = makePassedResult();
    result.columns[0]!.rawOutput = "   "; // whitespace-only
    const lessons = distillFearSetLesson(result);
    expect(lessons).toHaveLength(4);
  });

  it("define column uses section FearSet-Define", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const defineLessons = lessons.filter((l) => l.section === "FearSet-Define");
    expect(defineLessons.length).toBeGreaterThanOrEqual(1);
  });

  it("prevent column uses section FearSet-Prevent", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const preventLessons = lessons.filter((l) => l.section === "FearSet-Prevent");
    expect(preventLessons.length).toBeGreaterThanOrEqual(1);
  });

  it("repair column uses section FearSet-Repair", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const repairLessons = lessons.filter((l) => l.section === "FearSet-Repair");
    expect(repairLessons.length).toBeGreaterThanOrEqual(1);
  });

  it("benefits column uses section FearSet-Decision", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const decisionLessons = lessons.filter((l) => l.section === "FearSet-Decision");
    // benefits and inaction both map to FearSet-Decision
    expect(decisionLessons.length).toBeGreaterThanOrEqual(2);
  });

  it("define lesson content contains worst cases list", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const defineLesson = lessons.find((l) => l.section === "FearSet-Define");
    expect(defineLesson).toBeDefined();
    expect(defineLesson!.proposal.candidateSkill!.content).toContain("Data corruption");
    expect(defineLesson!.proposal.candidateSkill!.content).toContain("Auth failure");
  });

  it("prevent lesson content includes prevention actions block", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const preventLesson = lessons.find((l) => l.section === "FearSet-Prevent");
    expect(preventLesson).toBeDefined();
    expect(preventLesson!.proposal.candidateSkill!.content).toContain("Prevention Actions");
    expect(preventLesson!.proposal.candidateSkill!.content).toContain("Feature flags");
  });

  it("repair lesson content includes repair plans block", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const repairLesson = lessons.find((l) => l.section === "FearSet-Repair");
    expect(repairLesson).toBeDefined();
    expect(repairLesson!.proposal.candidateSkill!.content).toContain("Repair Plans");
    expect(repairLesson!.proposal.candidateSkill!.content).toContain("Rollback");
  });

  it("all proposals have action 'add'", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    for (const lesson of lessons) {
      expect(lesson.proposal.action).toBe("add");
    }
  });

  it("trustScore derives from robustnessScore.overall (clamped to [0.5, 1])", () => {
    const result = makePassedResult();
    result.robustnessScore!.overall = 0.82;
    const lessons = distillFearSetLesson(result);
    for (const lesson of lessons) {
      expect(lesson.trustScore).toBeCloseTo(0.82);
    }
  });

  it("trustScore floored at 0.5 when robustness is very low", () => {
    const result = makePassedResult();
    result.robustnessScore!.overall = 0.1;
    const lessons = distillFearSetLesson(result);
    for (const lesson of lessons) {
      expect(lesson.trustScore).toBe(0.5);
    }
  });

  it("opts.trustScore overrides robustness score (still clamped)", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result, { trustScore: 0.95 });
    for (const lesson of lessons) {
      expect(lesson.trustScore).toBeCloseTo(0.95);
    }
  });

  it("candidateSkill IDs are all unique", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const ids = lessons.map((l) => l.proposal.candidateSkill!.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("sourceSessionId is set to result.id", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    for (const lesson of lessons) {
      expect(lesson.proposal.candidateSkill!.sourceSessionId).toBe(result.id);
    }
  });

  it("rationale mentions FearSet run ID and column name", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    const defineLesson = lessons.find((l) => l.section === "FearSet-Define");
    expect(defineLesson!.proposal.rationale).toContain(result.id);
    expect(defineLesson!.proposal.rationale).toContain("define");
  });

  it("rationale mentions gate=pass", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result);
    for (const lesson of lessons) {
      expect(lesson.proposal.rationale).toContain("pass");
    }
  });

  it("opts.section overrides all column section assignments", () => {
    const result = makePassedResult();
    const lessons = distillFearSetLesson(result, { section: "custom-fearset" });
    for (const lesson of lessons) {
      expect(lesson.section).toBe("custom-fearset");
      expect(lesson.proposal.candidateSkill!.section).toBe("custom-fearset");
    }
  });

  it("prevent lesson marks SIMULATED actions when simulationStatus=simulated", () => {
    const result = makePassedResult();
    result.columns[1]!.preventionActions[0]!.simulationStatus = "simulated";
    const lessons = distillFearSetLesson(result);
    const preventLesson = lessons.find((l) => l.section === "FearSet-Prevent");
    expect(preventLesson!.proposal.candidateSkill!.content).toContain("SIMULATED");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// computeFearSetStats
// ═════════════════════════════════════════════════════════════════════════════

describe("computeFearSetStats", () => {
  it("returns all-zero stats for empty results array", () => {
    const stats = computeFearSetStats([]);
    expect(stats.totalRuns).toBe(0);
    expect(stats.passedRuns).toBe(0);
    expect(stats.failedRuns).toBe(0);
    expect(stats.reviewRequiredRuns).toBe(0);
    expect(stats.distilledRuns).toBe(0);
    expect(stats.averageRobustnessScore).toBe(0);
    expect(stats.averageRiskReduction).toBe(0);
    expect(stats.simulationCoverage).toBe(0);
    expect(stats.triggerChannelBreakdown).toEqual({});
  });

  it("counts passed and failed runs correctly", () => {
    const r1 = makePassedResult({ passed: true });
    const r2 = makePassedResult({
      id: "00000000-0000-0000-0000-000000000002",
      passed: false,
      robustnessScore: {
        overall: 0.4,
        hasSimulationEvidence: false,
        gateDecision: "fail",
        justification: "Thin columns.",
        scoredAt: new Date().toISOString(),
      },
    });
    const stats = computeFearSetStats([r1, r2]);
    expect(stats.totalRuns).toBe(2);
    expect(stats.passedRuns).toBe(1);
    expect(stats.failedRuns).toBe(1);
  });

  it("counts reviewRequired runs", () => {
    const r = makePassedResult({
      passed: false,
      robustnessScore: {
        overall: 0.6,
        hasSimulationEvidence: false,
        gateDecision: "review-required",
        justification: "Needs review.",
        scoredAt: new Date().toISOString(),
      },
    });
    const stats = computeFearSetStats([r]);
    expect(stats.reviewRequiredRuns).toBe(1);
    expect(stats.failedRuns).toBe(0);
  });

  it("counts distilled runs (those with distilledAt set)", () => {
    const r1 = makePassedResult({ distilledAt: new Date().toISOString() });
    const r2 = makePassedResult({ id: "00000000-0000-0000-0000-000000000002" });
    const stats = computeFearSetStats([r1, r2]);
    expect(stats.distilledRuns).toBe(1);
  });

  it("averageRobustnessScore is computed correctly", () => {
    const r1 = makePassedResult();
    r1.robustnessScore!.overall = 0.8;
    const r2 = makePassedResult({ id: "00000000-0000-0000-0000-000000000002" });
    r2.robustnessScore!.overall = 0.6;
    const stats = computeFearSetStats([r1, r2]);
    expect(stats.averageRobustnessScore).toBeCloseTo(0.7);
  });

  it("averageRiskReduction is computed correctly", () => {
    const r1 = makePassedResult();
    r1.robustnessScore!.estimatedRiskReduction = 0.5;
    const r2 = makePassedResult({ id: "00000000-0000-0000-0000-000000000002" });
    r2.robustnessScore!.estimatedRiskReduction = 0.3;
    const stats = computeFearSetStats([r1, r2]);
    expect(stats.averageRiskReduction).toBeCloseTo(0.4);
  });

  it("simulationCoverage reflects fraction of runs with simulation evidence", () => {
    const r1 = makePassedResult();
    r1.robustnessScore!.hasSimulationEvidence = true;
    const r2 = makePassedResult({ id: "00000000-0000-0000-0000-000000000002" });
    r2.robustnessScore!.hasSimulationEvidence = false;
    const stats = computeFearSetStats([r1, r2]);
    expect(stats.simulationCoverage).toBeCloseTo(0.5);
  });

  it("triggerChannelBreakdown counts channels correctly", () => {
    const r1 = makePassedResult();
    const r2 = makePassedResult({
      id: "00000000-0000-0000-0000-000000000002",
      trigger: { channel: "destructive", rationale: "rm -rf", at: new Date().toISOString() },
    });
    const r3 = makePassedResult({
      id: "00000000-0000-0000-0000-000000000003",
      trigger: { channel: "explicit-user", rationale: "manual", at: new Date().toISOString() },
    });
    const stats = computeFearSetStats([r1, r2, r3]);
    expect(stats.triggerChannelBreakdown["explicit-user"]).toBe(2);
    expect(stats.triggerChannelBreakdown["destructive"]).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// formatFearSetStats
// ═════════════════════════════════════════════════════════════════════════════

describe("formatFearSetStats", () => {
  it("returns a multi-line string", () => {
    const stats = computeFearSetStats([makePassedResult()]);
    const formatted = formatFearSetStats(stats);
    expect(formatted.split("\n").length).toBeGreaterThan(3);
  });

  it("includes 'DanteFearSet Stats' header", () => {
    const formatted = formatFearSetStats(computeFearSetStats([]));
    expect(formatted).toContain("DanteFearSet Stats");
  });

  it("includes total runs count", () => {
    const formatted = formatFearSetStats(computeFearSetStats([makePassedResult()]));
    expect(formatted).toContain("Total runs: 1");
  });

  it("includes passed count and percentage", () => {
    const stats = computeFearSetStats([makePassedResult()]);
    const formatted = formatFearSetStats(stats);
    expect(formatted).toContain("Passed: 1 (100%)");
  });

  it("includes avg robustness score formatted to 2 decimal places", () => {
    const result = makePassedResult();
    result.robustnessScore!.overall = 0.82;
    const formatted = formatFearSetStats(computeFearSetStats([result]));
    expect(formatted).toContain("0.82");
  });

  it("includes simulation coverage as percentage", () => {
    const r = makePassedResult();
    r.robustnessScore!.hasSimulationEvidence = true;
    const formatted = formatFearSetStats(computeFearSetStats([r]));
    expect(formatted).toContain("Simulation coverage: 100%");
  });

  it("includes trigger channel breakdown", () => {
    const formatted = formatFearSetStats(computeFearSetStats([makePassedResult()]));
    expect(formatted).toContain("explicit-user=1");
  });

  it("shows 0% pass rate when no runs passed", () => {
    const r = makePassedResult({ passed: false });
    const formatted = formatFearSetStats(computeFearSetStats([r]));
    expect(formatted).toContain("Passed: 0 (0%)");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DanteGaslightIntegration — FearSet surface
// ═════════════════════════════════════════════════════════════════════════════

describe("DanteGaslightIntegration — cmdFearSetOn/Off/Stats/Review", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("cmdFearSetOn returns string mentioning FearSet enabled", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const msg = engine.cmdFearSetOn();
    expect(msg).toContain("enabled");
    expect(msg.toLowerCase()).toContain("fearset");
  });

  it("cmdFearSetOn actually enables the fearSetConfig", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    engine.cmdFearSetOn();
    expect(engine.getFearSetConfig().enabled).toBe(true);
  });

  it("cmdFearSetOff returns string mentioning FearSet disabled", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, { enabled: true });
    const msg = engine.cmdFearSetOff();
    expect(msg.toLowerCase()).toContain("disabled");
  });

  it("cmdFearSetOff actually disables the fearSetConfig", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, { enabled: true });
    engine.cmdFearSetOff();
    expect(engine.getFearSetConfig().enabled).toBe(false);
  });

  it("cmdFearSetStats returns multi-line string with DanteFearSet header", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const stats = engine.cmdFearSetStats();
    expect(stats).toContain("DanteFearSet Stats");
    expect(stats).toContain("Total runs: 0");
  });

  it("cmdFearSetStats updates after a run", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Some decision context", makeMockCallbacks());
    const stats = engine.cmdFearSetStats();
    expect(stats).toContain("Total runs: 1");
  });

  it("cmdFearSetReview returns placeholder when no runs yet", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const review = engine.cmdFearSetReview();
    expect(review).toContain("No FearSet runs");
  });

  it("cmdFearSetReview shows last run after a run", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Should I launch this?", makeMockCallbacks());
    const review = engine.cmdFearSetReview();
    expect(review).toContain("explicit-user");
    expect(review).toContain("Should I launch this?");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DanteGaslightIntegration.runFearSet
// ═════════════════════════════════════════════════════════════════════════════

describe("DanteGaslightIntegration.runFearSet", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("stores result in fearSetResults (getFearSetResults returns it)", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const result = await engine.runFearSet("Decision context", makeMockCallbacks());
    const results = engine.getFearSetResults();
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe(result.id);
  });

  it("accumulates multiple results", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("First decision", makeMockCallbacks());
    await engine.runFearSet("Second decision", makeMockCallbacks());
    expect(engine.getFearSetResults()).toHaveLength(2);
  });

  it("result uses explicit-user trigger when called via runFearSet", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const result = await engine.runFearSet("Some decision", makeMockCallbacks());
    expect(result.trigger.channel).toBe("explicit-user");
  });

  it("passes engineOpts.priorLessons into the engine", async () => {
    const capturedPrompts: string[] = [];
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      mode: "lite",
    });
    await engine.runFearSet(
      "Decision",
      {
        onColumn: async (_sys, user) => {
          capturedPrompts.push(user);
          return makeDefineJson();
        },
      },
      { priorLessons: ["Apply lesson X"] },
    );
    expect(capturedPrompts.some((p) => p.includes("Apply lesson X"))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DanteGaslightIntegration.maybeFearSet
// ═════════════════════════════════════════════════════════════════════════════

describe("DanteGaslightIntegration.maybeFearSet", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("returns null when FearSet is disabled (default)", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const result = await engine.maybeFearSet({ message: "rm -rf the old folder" });
    expect(result).toBeNull();
  });

  it("returns null when message does not match any trigger pattern", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const result = await engine.maybeFearSet({ message: "just update the README file" });
    expect(result).toBeNull();
  });

  it("triggers when message matches destructive pattern", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const result = await engine.maybeFearSet({
      message: "drop table users permanently",
      callbacks: makeMockCallbacks(),
    });
    expect(result).not.toBeNull();
    expect(result!.trigger.channel).toBe("destructive");
  });

  it("triggers on explicit fearset command", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const result = await engine.maybeFearSet({
      message: "/fearset Should I deploy now?",
      callbacks: makeMockCallbacks(),
    });
    expect(result).not.toBeNull();
    expect(result!.trigger.channel).toBe("explicit-user");
  });

  it("stores the result in fearSetResults after auto-trigger", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.maybeFearSet({
      message: "nuke the staging database",
      callbacks: makeMockCallbacks(),
    });
    expect(engine.getFearSetResults()).toHaveLength(1);
  });

  it("passes priorLessons through to the engine", async () => {
    const capturedPrompts: string[] = [];
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      mode: "lite",
    });
    await engine.maybeFearSet({
      message: "/fearset Should I launch?",
      priorLessons: ["Check rollback plan first"],
      callbacks: {
        onColumn: async (_sys, user) => {
          capturedPrompts.push(user);
          return makeDefineJson();
        },
      },
    });
    expect(capturedPrompts.some((p) => p.includes("Check rollback plan first"))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// DanteGaslightIntegration.distillFearSetLessons
// ═════════════════════════════════════════════════════════════════════════════

describe("DanteGaslightIntegration.distillFearSetLessons", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("returns empty array when there are no results", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    expect(engine.distillFearSetLessons()).toHaveLength(0);
  });

  it("distills passed results that have not been distilled yet", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Decision", makeMockCallbacks());
    const lessons = engine.distillFearSetLessons();
    expect(lessons.length).toBeGreaterThan(0);
  });

  it("marks result as distilled after first call (sets distilledAt)", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Decision", makeMockCallbacks());
    engine.distillFearSetLessons();
    const results = engine.getFearSetResults();
    expect(results[0]!.distilledAt).toBeTruthy();
  });

  it("does not re-distill already-distilled results on second call", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Decision", makeMockCallbacks());
    const firstCall = engine.distillFearSetLessons();
    const secondCall = engine.distillFearSetLessons();
    expect(secondCall).toHaveLength(0);
    expect(firstCall.length).toBeGreaterThan(0);
  });

  it("skips failed (not passed) results", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    // Run with a gate that returns fail
    await engine.runFearSet("Decision", {
      ...makeMockCallbacks(),
      onGate: async () => JSON.stringify({
        overall: 0.2,
        hasSimulationEvidence: false,
        estimatedRiskReduction: 0.1,
        gateDecision: "fail",
        justification: "Too weak.",
      }),
    });
    const lessons = engine.distillFearSetLessons();
    expect(lessons).toHaveLength(0);
  });

  it("distills multiple passed results", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("First decision", makeMockCallbacks());
    await engine.runFearSet("Second decision", makeMockCallbacks());
    const lessons = engine.distillFearSetLessons();
    // 5 columns × 2 results = 10 lessons
    expect(lessons.length).toBe(10);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Golden Flow GF-01: Full manual /fearset run through integration
// ═════════════════════════════════════════════════════════════════════════════

describe("GF-01: Full manual /fearset run through integration", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("full /fearset flow produces passed=true result with at least one lesson", async () => {
    const columnCallCount: Record<string, number> = {};
    let gateCallCount = 0;

    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    engine.cmdFearSetOn();

    const result = await engine.runFearSet(
      "Should I launch this feature to prod?",
      {
        onColumn: async (_sys, _user, column) => {
          columnCallCount[column] = (columnCallCount[column] ?? 0) + 1;
          switch (column) {
            case "define": return makeDefineJson(["Revenue loss", "Customer churn", "Data breach"]);
            case "prevent": return makePreventJson();
            case "repair": return makeRepairJson();
            case "benefits": return makeBenefitsJson();
            case "inaction": return makeInactionJson();
            default: return "{}";
          }
        },
        onGate: async () => {
          gateCallCount++;
          return makeGatePassJson();
        },
      },
    );

    // Verify all 5 columns were called
    expect(columnCallCount["define"]).toBe(1);
    expect(columnCallCount["prevent"]).toBe(1);
    expect(columnCallCount["repair"]).toBe(1);
    expect(columnCallCount["benefits"]).toBe(1);
    expect(columnCallCount["inaction"]).toBe(1);

    // Gate was called exactly once
    expect(gateCallCount).toBe(1);

    // Result is complete and passed
    expect(result.passed).toBe(true);
    expect(result.columns).toHaveLength(5);
    expect(result.robustnessScore?.gateDecision).toBe("pass");

    // Context is preserved
    expect(result.context).toBe("Should I launch this feature to prod?");
    expect(result.trigger.channel).toBe("explicit-user");

    // Can distill at least one lesson
    const lessons = engine.distillFearSetLessons();
    expect(lessons.length).toBeGreaterThanOrEqual(1);

    // The stored result is retrievable
    expect(engine.getFearSetResults()).toHaveLength(1);

    // Stats reflect the run
    const statsStr = engine.cmdFearSetStats();
    expect(statsStr).toContain("Total runs: 1");
    expect(statsStr).toContain("Passed: 1 (100%)");
  });

  it("GF-01: define column worst-cases are parsed and stored in column", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);

    const result = await engine.runFearSet(
      "Should I launch this feature to prod?",
      makeMockCallbacks({
        onColumn: async (_sys, _user, col) => {
          if (col === "define") {
            return makeDefineJson(["Revenue loss", "Customer churn"]);
          }
          return makeDefineJson();
        },
      }),
    );

    const defineCol = result.columns.find((c) => c.name === "define");
    expect(defineCol).toBeDefined();
    expect(defineCol!.worstCases).toContain("Revenue loss");
    expect(defineCol!.worstCases).toContain("Customer churn");
  });

  it("GF-01: prevent column prevention actions are parsed and stored", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);

    const result = await engine.runFearSet(
      "Should I launch this feature to prod?",
      makeMockCallbacks(),
    );

    const preventCol = result.columns.find((c) => c.name === "prevent");
    expect(preventCol).toBeDefined();
    expect(preventCol!.preventionActions.length).toBeGreaterThan(0);
    expect(preventCol!.preventionActions[0]!.description).toBeTruthy();
    expect(preventCol!.preventionActions[0]!.mechanism).toBeTruthy();
  });

  it("GF-01: repair column repair plans are parsed and stored", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);

    const result = await engine.runFearSet(
      "Should I launch this feature to prod?",
      makeMockCallbacks(),
    );

    const repairCol = result.columns.find((c) => c.name === "repair");
    expect(repairCol).toBeDefined();
    expect(repairCol!.repairPlans.length).toBeGreaterThan(0);
    expect(repairCol!.repairPlans[0]!.steps.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Golden Flow GF-04: distillFearSetLessons writes FearSet-tagged sections
// ═════════════════════════════════════════════════════════════════════════════

describe("GF-04: distillFearSetLessons writes FearSet-tagged section proposals", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("produces FearSet-Prevent and FearSet-Repair section proposals after a passed run", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Should I deploy?", makeMockCallbacks());

    const lessons = engine.distillFearSetLessons();
    const sections = lessons.map((l) => l.section);

    expect(sections).toContain("FearSet-Prevent");
    expect(sections).toContain("FearSet-Repair");
  });

  it("produces FearSet-Define section proposal", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Should I deploy?", makeMockCallbacks());
    const lessons = engine.distillFearSetLessons();
    expect(lessons.map((l) => l.section)).toContain("FearSet-Define");
  });

  it("FearSet-Prevent proposal content references prevention mechanisms", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Should I deploy?", makeMockCallbacks());
    const lessons = engine.distillFearSetLessons();
    const preventLesson = lessons.find((l) => l.section === "FearSet-Prevent");
    expect(preventLesson).toBeDefined();
    expect(preventLesson!.proposal.candidateSkill!.content).toContain("Gradual rollout");
  });

  it("FearSet-Repair proposal content references repair steps", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Should I deploy?", makeMockCallbacks());
    const lessons = engine.distillFearSetLessons();
    const repairLesson = lessons.find((l) => l.section === "FearSet-Repair");
    expect(repairLesson).toBeDefined();
    // The repair plan has "Rollback" description and steps
    expect(repairLesson!.proposal.candidateSkill!.content).toContain("Rollback");
  });

  it("all FearSet lessons have action=add (ready for skillbook)", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Should I deploy?", makeMockCallbacks());
    const lessons = engine.distillFearSetLessons();
    for (const lesson of lessons) {
      expect(lesson.proposal.action).toBe("add");
    }
  });

  it("lessons are not produced again on second distill call (idempotent)", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Should I deploy?", makeMockCallbacks());
    const first = engine.distillFearSetLessons();
    const second = engine.distillFearSetLessons();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toHaveLength(0);
  });

  it("FearSet-tagged sections are distinguishable from regular gaslight sections", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Should I deploy?", makeMockCallbacks());
    const lessons = engine.distillFearSetLessons();
    const fearsetSections = lessons.filter((l) => l.section.startsWith("FearSet-"));
    // All 5 columns → all sections start with FearSet-
    expect(fearsetSections).toHaveLength(lessons.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4 — Extended Coverage
// GF-02, GF-03, GF-05, FearSetResultStore, budget, events, stopReason,
// synthesized recommendation, CLI-level slash-command integration
// ─────────────────────────────────────────────────────────────────────────────

import { FearSetResultStore } from "./fearset-result-store.js";
import { existsSync, writeFileSync, mkdirSync as _mkdirSync } from "node:fs";

// ─────────────────────────────────────────────────────────────────────────────
// FearSetResultStore — unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe("FearSetResultStore — save / load / has / list", () => {
  let storeDir: string;
  beforeEach(() => { storeDir = makeTestDir(); });
  afterEach(() => { rmSync(storeDir, { recursive: true, force: true }); });

  function makeResult(overrides: Partial<FearSetResult> = {}): FearSetResult {
    return {
      id: "00000000-0000-0000-0000-" + Math.random().toString(36).slice(2).padEnd(12, "0"),
      trigger: EXPLICIT_TRIGGER,
      context: "Deploy to production",
      columns: [],
      passed: true,
      mode: "standard",
      startedAt: new Date().toISOString(),
      ...overrides,
    } as FearSetResult;
  }

  it("save + has + load round-trip", () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    const r = makeResult();
    store.save(r);
    expect(store.has(r.id)).toBe(true);
    const loaded = store.load(r.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(r.id);
    expect(loaded!.context).toBe("Deploy to production");
  });

  it("load returns null for missing id", () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    expect(store.load("non-existent-id")).toBeNull();
  });

  it("list returns results newest-first by mtime", async () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    const r1 = makeResult({ context: "first" });
    store.save(r1);
    // Small delay to ensure different mtime
    await new Promise((res) => setTimeout(res, 10));
    const r2 = makeResult({ context: "second" });
    store.save(r2);
    const list = store.list();
    expect(list.length).toBe(2);
    // Newest first → r2 is first
    expect(list[0]!.context).toBe("second");
    expect(list[1]!.context).toBe("first");
  });

  it("list skips corrupt JSON files", () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    const r = makeResult();
    store.save(r);
    // Write a corrupt file alongside
    const corruptPath = storeDir + "/.dantecode/fearset/results/corrupt.json";
    _mkdirSync(storeDir + "/.dantecode/fearset/results", { recursive: true });
    writeFileSync(corruptPath, "{not valid json", "utf-8");
    const list = store.list();
    // Only the valid result is returned
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(r.id);
  });

  it("markDistilled persists distilledAt to disk", () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    const r = makeResult({ passed: true });
    store.save(r);
    expect(store.load(r.id)!.distilledAt).toBeUndefined();
    store.markDistilled(r.id);
    const reloaded = store.load(r.id);
    expect(reloaded!.distilledAt).toBeDefined();
    expect(typeof reloaded!.distilledAt).toBe("string");
  });

  it("markDistilled is a no-op for missing id", () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    // Should not throw
    expect(() => store.markDistilled("does-not-exist")).not.toThrow();
  });

  it("cleanup enforces maxResults cap, deletes oldest first", async () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    for (let i = 0; i < 4; i++) {
      store.save(makeResult());
      await new Promise((res) => setTimeout(res, 5));
    }
    expect(store.list()).toHaveLength(4);
    const deleted = store.cleanup(2);
    expect(deleted).toBe(2);
    expect(store.list()).toHaveLength(2);
  });

  it("cleanup(0) deletes everything", async () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    store.save(makeResult());
    store.save(makeResult());
    store.cleanup(0);
    expect(store.list()).toHaveLength(0);
  });

  it("has returns false before save", () => {
    const store = new FearSetResultStore({ cwd: storeDir });
    expect(store.has("not-here")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GF-02 — Auto-trigger via maybeFearSet on destructive message
// ─────────────────────────────────────────────────────────────────────────────

describe("GF-02: maybeFearSet auto-trigger on destructive message", () => {
  let testDir: string;
  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("triggers on a DROP TABLE destructive message", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    const result = await engine.maybeFearSet({
      message: "drop table users — delete all user records permanently",
      callbacks: makeMockCallbacks(),
    });
    expect(result).not.toBeNull();
    expect(result!.trigger.channel).toBe("destructive");
  });

  it("triggered result is persisted to disk immediately", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    const result = await engine.maybeFearSet({
      message: "rm -rf /data/prod — remove all production data",
      callbacks: makeMockCallbacks(),
    });
    expect(result).not.toBeNull();
    const store = new FearSetResultStore({ cwd: testDir });
    expect(store.has(result!.id)).toBe(true);
  });

  it("passed destructive result is distillable", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    // Use "purge data" pattern which matches DESTRUCTIVE_PATTERNS
    const result = await engine.maybeFearSet({
      message: "purge all data from the production database permanently",
      callbacks: makeMockCallbacks(),
    });
    expect(result).not.toBeNull();
    if (result!.passed) {
      const lessons = engine.distillFearSetLessons();
      expect(lessons.length).toBeGreaterThan(0);
    }
  });

  it("returns null when message is not risky", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    const result = await engine.maybeFearSet({
      message: "update README.md to fix typo",
      callbacks: makeMockCallbacks(),
    });
    // Low-risk message should not trigger FearSet
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GF-03 — Sandbox simulation proof
// ─────────────────────────────────────────────────────────────────────────────

describe("GF-03: sandbox simulation evidence wired through result", () => {
  let testDir: string;
  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("onSandboxSimulate callback fires and evidence appears in result", async () => {
    const simulatedIds: string[] = [];
    const callbacks = makeMockCallbacks({
      onColumn: async (_sys, _user, column) => {
        if (column === "prevent") {
          return JSON.stringify({
            preventionActions: [{
              id: "pa-sim",
              description: "Run smoke test suite",
              mechanism: "CI gate",
              riskReduction: 0.8,
              simulationStatus: "simulatable",
            }],
          });
        }
        if (column === "define") return makeDefineJson();
        if (column === "repair") return makeRepairJson();
        if (column === "benefits") return makeBenefitsJson();
        if (column === "inaction") return makeInactionJson();
        return null;
      },
      onSandboxSimulate: async (actionId: string, _kind: string) => {
        simulatedIds.push(actionId);
        return `Simulation passed for ${actionId}: all 42 smoke tests green.`;
      },
      onGate: async () => JSON.stringify({
        overall: 0.88,
        byColumn: { define: 0.9, prevent: 0.85, repair: 0.85 },
        hasSimulationEvidence: true,
        estimatedRiskReduction: 0.7,
        gateDecision: "pass",
        justification: "Evidence from simulation present.",
      }),
    });

    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      sandboxSimulation: true,
    });
    const result = await engine.runFearSet("Deploy new payment service", callbacks);

    // Simulation callback should have been invoked
    expect(simulatedIds.length).toBeGreaterThan(0);

    // The prevent column should have simulation evidence
    const preventCol = result.columns.find((c) => c.name === "prevent");
    if (preventCol) {
      const simAction = preventCol.preventionActions.find(
        (a) => a.simulationStatus === "simulated" && a.simulationEvidence,
      );
      expect(simAction).toBeDefined();
      expect(simAction!.simulationEvidence).toContain("Simulation passed");
    }
  });

  it("result.robustnessScore.hasSimulationEvidence is true when simulated", async () => {
    const callbacks = makeMockCallbacks({
      onColumn: async (_sys, _user, column) => {
        if (column === "prevent") {
          return JSON.stringify({
            preventionActions: [{
              id: "pa-sim2",
              description: "Automated integration test",
              mechanism: "Test harness",
              riskReduction: 0.75,
              simulationStatus: "simulatable",
            }],
          });
        }
        if (column === "define") return makeDefineJson();
        if (column === "repair") return makeRepairJson();
        if (column === "benefits") return makeBenefitsJson();
        if (column === "inaction") return makeInactionJson();
        return null;
      },
      onSandboxSimulate: async () => "Integration tests passed: 100% green.",
      onGate: async () => JSON.stringify({
        overall: 0.82,
        hasSimulationEvidence: true,
        estimatedRiskReduction: 0.6,
        gateDecision: "pass",
        justification: "Simulation evidence confirms prevention plan.",
      }),
    });

    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      sandboxSimulation: true,
    });
    const result = await engine.runFearSet("Ship new auth flow", callbacks);
    // Gate declares hasSimulationEvidence=true
    expect(result.robustnessScore?.hasSimulationEvidence).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GF-05 — Persistence cycle (restart simulation)
// ─────────────────────────────────────────────────────────────────────────────

describe("GF-05: persist → restart → load → distill → idempotent", () => {
  let testDir: string;
  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("result survives integration instance restart", async () => {
    // Session 1 — run and persist
    const engine1 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const result1 = await engine1.runFearSet("Should we refactor the DB layer?", makeMockCallbacks());
    expect(result1.passed).toBe(true);

    // Simulate process restart — new integration instance, same cwd
    const engine2 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const allResults = engine2.getFearSetResults();
    const found = allResults.find((r) => r.id === result1.id);
    expect(found).toBeDefined();
    expect(found!.passed).toBe(true);
  });

  it("distillFearSetLessons() works after restart and marks distilledAt on disk", async () => {
    const engine1 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const result1 = await engine1.runFearSet("Should we adopt microservices?", makeMockCallbacks());
    expect(result1.passed).toBe(true);

    // Restart
    const engine2 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const lessons = engine2.distillFearSetLessons();
    expect(lessons.length).toBeGreaterThan(0);

    // distilledAt should now be on disk
    const store = new FearSetResultStore({ cwd: testDir });
    const onDisk = store.load(result1.id);
    expect(onDisk!.distilledAt).toBeDefined();
  });

  it("second distill call after restart is idempotent (0 new lessons)", async () => {
    const engine1 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine1.runFearSet("Architecture decision: monolith vs microservices", makeMockCallbacks());

    // First distill
    const engine2 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const first = engine2.distillFearSetLessons();
    expect(first.length).toBeGreaterThan(0);

    // Second distill — same instance, no new undistilled results
    const second = engine2.distillFearSetLessons();
    expect(second).toHaveLength(0);

    // Third distill — new instance (simulates another restart)
    const engine3 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const third = engine3.distillFearSetLessons();
    // Should also be 0 because distilledAt is on disk
    expect(third).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stopReason tests
// ─────────────────────────────────────────────────────────────────────────────

describe("runFearSetEngine — stopReason and stoppedAt", () => {
  it("isStopped() immediately → stopReason is user-stop", async () => {
    const result = await runFearSetEngine(
      "Deploy critical patch",
      EXPLICIT_TRIGGER,
      {
        isStopped: () => true,
        onColumn: async () => makeDefineJson(),
        onGate: async () => makeGatePassJson(),
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(result.stopReason).toBe("user-stop");
  });

  it("user-stop result has stoppedAt timestamp", async () => {
    const result = await runFearSetEngine(
      "Deploy critical patch",
      EXPLICIT_TRIGGER,
      { isStopped: () => true },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(result.stopReason).toBe("user-stop");
    expect(result.stoppedAt).toBeDefined();
    expect(() => new Date(result.stoppedAt!)).not.toThrow();
  });

  it("normal completion sets stopReason to completed", async () => {
    const result = await runFearSetEngine(
      "Should we launch this feature?",
      EXPLICIT_TRIGGER,
      makeMockCallbacks(),
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(result.stopReason).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RuntimeEvent emission tests
// ─────────────────────────────────────────────────────────────────────────────

describe("runFearSetEngine — onEvent RuntimeEvent emission", () => {
  it("emits fearset.triggered at start", async () => {
    const events: string[] = [];
    await runFearSetEngine(
      "Launch new pricing page",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onEvent: (event) => { events.push(event.kind); },
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(events).toContain("fearset.triggered");
  });

  it("emits fearset.column.started for each column", async () => {
    const events: string[] = [];
    await runFearSetEngine(
      "Migrate DB to Postgres",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onEvent: (event) => { events.push(event.kind); },
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    const started = events.filter((e) => e === "fearset.column.started");
    // Standard mode has 5 columns → 5 column.started events
    expect(started.length).toBe(5);
  });

  it("emits fearset.column.completed for each column", async () => {
    const events: string[] = [];
    await runFearSetEngine(
      "Introduce new caching layer",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onEvent: (event) => { events.push(event.kind); },
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    const completed = events.filter((e) => e === "fearset.column.completed");
    expect(completed.length).toBe(5);
  });

  it("emits fearset.danteforge.passed when gate passes", async () => {
    const events: string[] = [];
    await runFearSetEngine(
      "Upgrade payment processor",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onEvent: (event) => { events.push(event.kind); },
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(events).toContain("fearset.danteforge.passed");
  });

  it("emits fearset.danteforge.failed when gate fails", async () => {
    const events: string[] = [];
    await runFearSetEngine(
      "Remove legacy authentication system",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks({
          onGate: async () => JSON.stringify({
            overall: 0.3,
            gateDecision: "fail",
            justification: "Insufficient prevention coverage.",
          }),
        }),
        onEvent: (event) => { events.push(event.kind); },
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(events).toContain("fearset.danteforge.failed");
  });

  it("emits fearset.stopped on user-stop", async () => {
    const events: string[] = [];
    await runFearSetEngine(
      "Deploy to prod",
      EXPLICIT_TRIGGER,
      {
        isStopped: () => true,
        onEvent: (event) => { events.push(event.kind); },
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(events).toContain("fearset.stopped");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Synthesized recommendation tests
// ─────────────────────────────────────────────────────────────────────────────

describe("runFearSetEngine — synthesizedRecommendation", () => {
  it("passing gate produces a synthesized recommendation", async () => {
    const result = await runFearSetEngine(
      "Launch v2.0 of the API",
      EXPLICIT_TRIGGER,
      makeMockCallbacks(),
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(result.passed).toBe(true);
    expect(result.synthesizedRecommendation).toBeDefined();
    expect(["go", "conditional", "no-go"]).toContain(result.synthesizedRecommendation!.decision);
    expect(result.synthesizedRecommendation!.reasoning.length).toBeGreaterThan(0);
  });

  it("failing gate produces a no-go recommendation (heuristic)", async () => {
    const result = await runFearSetEngine(
      "Wipe the staging database",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({
        onGate: async () => JSON.stringify({
          overall: 0.25,
          gateDecision: "fail",
          justification: "Plan is too weak.",
        }),
      }),
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    expect(result.passed).toBe(false);
    expect(result.synthesizedRecommendation).toBeDefined();
    expect(result.synthesizedRecommendation!.decision).toBe("no-go");
  });

  it("onSynthesize callback result is used for recommendation", async () => {
    const result = await runFearSetEngine(
      "Consolidate microservices into monolith",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({
        onSynthesize: async () => JSON.stringify({
          decision: "conditional",
          reasoning: "Proceed only after full load testing completes.",
          conditions: ["Load test passes", "CEO sign-off"],
        }),
      }),
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    if (result.passed && result.synthesizedRecommendation) {
      expect(result.synthesizedRecommendation.decision).toBe("conditional");
      expect(result.synthesizedRecommendation.conditions).toContain("Load test passes");
    }
  });

  it("synthesized recommendation conditions array is always an array", async () => {
    const result = await runFearSetEngine(
      "Rewrite core authentication service",
      EXPLICIT_TRIGGER,
      makeMockCallbacks(),
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    if (result.synthesizedRecommendation) {
      expect(Array.isArray(result.synthesizedRecommendation.conditions)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Column validation warning tests
// ─────────────────────────────────────────────────────────────────────────────

describe("runFearSetEngine — column validation warnings", () => {
  it("onColumnComplete receives warnings array", async () => {
    const warningMap: Record<string, string[]> = {};
    await runFearSetEngine(
      "Ship new payment flow",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks(),
        onColumnComplete: (colName, _col, warnings) => {
          warningMap[colName] = warnings;
        },
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    // All columns should have received a warnings array (empty or not)
    expect(Object.keys(warningMap).length).toBeGreaterThan(0);
    for (const w of Object.values(warningMap)) {
      expect(Array.isArray(w)).toBe(true);
    }
  });

  it("empty column raw output produces validation warnings on define", async () => {
    const warningMap: Record<string, string[]> = {};
    await runFearSetEngine(
      "Refactor payment module",
      EXPLICIT_TRIGGER,
      {
        ...makeMockCallbacks({
          onColumn: async (_sys, _user, column) => {
            if (column === "define") {
              // Return empty worst cases
              return JSON.stringify({ worstCases: [] });
            }
            if (column === "prevent") return makePreventJson();
            if (column === "repair") return makeRepairJson();
            if (column === "benefits") return makeBenefitsJson();
            if (column === "inaction") return makeInactionJson();
            return null;
          },
        }),
        onColumnComplete: (colName, _col, warnings) => {
          warningMap[colName] = warnings;
        },
      },
      { config: { ...ENABLED_FEARSET_CONFIG } },
    );
    // define column with no worstCases should produce a validation warning
    if (warningMap["define"]) {
      expect(warningMap["define"].some((w) => w.includes("worst-case") || w.includes("worstCase"))).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration — getFearSetResults merges in-memory + disk
// ─────────────────────────────────────────────────────────────────────────────

describe("DanteGaslightIntegration.getFearSetResults — disk merge", () => {
  let testDir: string;
  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("results from disk are included after restart", async () => {
    const engine1 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine1.runFearSet("Experiment A", makeMockCallbacks());
    await engine1.runFearSet("Experiment B", makeMockCallbacks());

    const engine2 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    const all = engine2.getFearSetResults();
    expect(all.length).toBe(2);
  });

  it("newest-first ordering is maintained across disk + memory merge", async () => {
    const engine1 = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine1.runFearSet("First run", makeMockCallbacks());
    await new Promise((res) => setTimeout(res, 10));
    await engine1.runFearSet("Second run", makeMockCallbacks());

    const all = engine1.getFearSetResults();
    expect(all[0]!.context).toBe("Second run");
    expect(all[1]!.context).toBe("First run");
  });

  it("in-memory results shadow disk copies with same ID", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, ENABLED_FEARSET_CONFIG);
    await engine.runFearSet("Shadow test", makeMockCallbacks());
    const all = engine.getFearSetResults();
    // No duplicates
    const ids = all.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 5 — Two-Tier Hybrid Classifier
// classifyRiskWithLlm + parseLlmClassification + onClassify integration
// ─────────────────────────────────────────────────────────────────────────────

// ─── parseLlmClassification unit tests ───────────────────────────────────────

describe("parseLlmClassification", () => {
  it("parses valid shouldTrigger=true response", () => {
    const raw = '{"shouldTrigger":true,"channel":"destructive","confidence":0.9,"rationale":"API retirement involves irreversible data loss."}';
    const result = parseLlmClassification(raw);
    expect(result).not.toBeNull();
    expect(result!.shouldTrigger).toBe(true);
    expect(result!.channel).toBe("destructive");
    expect(result!.confidence).toBe(0.9);
  });

  it("parses shouldTrigger=false response", () => {
    const raw = '{"shouldTrigger":false,"channel":"weak-robustness","confidence":0.95,"rationale":"No risk signals detected."}';
    const result = parseLlmClassification(raw);
    expect(result).not.toBeNull();
    expect(result!.shouldTrigger).toBe(false);
  });

  it("clamps confidence above 1 to 1", () => {
    const raw = '{"shouldTrigger":true,"channel":"long-horizon","confidence":1.5,"rationale":"Over-confident."}';
    const result = parseLlmClassification(raw);
    expect(result!.confidence).toBe(1);
  });

  it("clamps negative confidence to 0", () => {
    const raw = '{"shouldTrigger":true,"channel":"long-horizon","confidence":-0.3,"rationale":"test"}';
    const result = parseLlmClassification(raw);
    expect(result!.confidence).toBe(0);
  });

  it("returns null for invalid channel", () => {
    const raw = '{"shouldTrigger":true,"channel":"unknown-channel","confidence":0.8,"rationale":"test"}';
    expect(parseLlmClassification(raw)).toBeNull();
  });

  it("returns null for non-JSON input", () => {
    expect(parseLlmClassification("not json at all")).toBeNull();
  });

  it("returns null when shouldTrigger is not boolean", () => {
    const raw = '{"shouldTrigger":"yes","channel":"destructive","confidence":0.8,"rationale":"test"}';
    expect(parseLlmClassification(raw)).toBeNull();
  });

  it("extracts JSON embedded in surrounding text", () => {
    const raw = 'Sure! Here is my classification:\n{"shouldTrigger":true,"channel":"destructive","confidence":0.85,"rationale":"API sunset is irreversible."}\nLet me know if you need more.';
    const result = parseLlmClassification(raw);
    expect(result).not.toBeNull();
    expect(result!.shouldTrigger).toBe(true);
  });

  it("defaults confidence to 0.7 when confidence field is missing", () => {
    const raw = '{"shouldTrigger":true,"channel":"long-horizon","rationale":"multi-phase"}';
    const result = parseLlmClassification(raw);
    expect(result!.confidence).toBe(0.7);
  });
});

// ─── classifyRiskWithLlm ──────────────────────────────────────────────────────

describe("classifyRiskWithLlm", () => {
  const ENABLED_OPTS = { config: { ...ENABLED_FEARSET_CONFIG } };

  it("TC-CL-01: no callback → same result as classifyRisk() (backward compat)", async () => {
    const sync = classifyRisk("what is the weather like?", ENABLED_OPTS);
    const async_ = await classifyRiskWithLlm("what is the weather like?", ENABLED_OPTS);
    expect(async_.shouldTrigger).toBe(sync.shouldTrigger);
  });

  it("TC-CL-02: onClassify returns null → no trigger (backward compat)", async () => {
    const result = await classifyRiskWithLlm(
      "can you help me think through whether we should sunset the old API?",
      ENABLED_OPTS,
      async () => null,
    );
    expect(result.shouldTrigger).toBe(false);
  });

  it("TC-CL-03: LLM triggers nuanced 'sunset old API' → shouldTrigger=true, channel=destructive", async () => {
    const result = await classifyRiskWithLlm(
      "can you help me think through whether we should sunset the old API?",
      ENABLED_OPTS,
      async () => '{"shouldTrigger":true,"channel":"destructive","confidence":0.87,"rationale":"API retirement is irreversible system change."}',
    );
    expect(result.shouldTrigger).toBe(true);
    expect(result.channel).toBe("destructive");
    expect(result.confidence).toBe(0.87);
  });

  it("TC-CL-04: LLM triggers 'refactor auth getting complex' → long-horizon", async () => {
    const result = await classifyRiskWithLlm(
      "I want to refactor auth — it's getting complex",
      ENABLED_OPTS,
      async () => '{"shouldTrigger":true,"channel":"long-horizon","confidence":0.82,"rationale":"Multi-phase auth refactor spans several weeks."}',
    );
    expect(result.shouldTrigger).toBe(true);
    expect(result.channel).toBe("long-horizon");
  });

  it("TC-CL-05: Tier 1 fast path — regex match bypasses LLM entirely", async () => {
    const onClassify = vi.fn(async () => '{"shouldTrigger":true,"channel":"destructive","confidence":0.9,"rationale":"test"}');
    const result = await classifyRiskWithLlm(
      "drop table users",  // hits DESTRUCTIVE_PATTERNS
      ENABLED_OPTS,
      onClassify,
    );
    expect(result.shouldTrigger).toBe(true);
    expect(onClassify).not.toHaveBeenCalled();
  });

  it("TC-CL-06: LLM parse error (non-JSON) → graceful no-trigger", async () => {
    const result = await classifyRiskWithLlm(
      "refactor the auth layer",
      ENABLED_OPTS,
      async () => "Sorry, I cannot help with that.",
    );
    expect(result.shouldTrigger).toBe(false);
  });

  it("TC-CL-07: onClassify throws → graceful no-trigger (non-fatal)", async () => {
    const result = await classifyRiskWithLlm(
      "should we sunset the API?",
      ENABLED_OPTS,
      async () => { throw new Error("network error"); },
    );
    expect(result.shouldTrigger).toBe(false);
  });

  it("TC-CL-08: LLM returns shouldTrigger=false → no trigger", async () => {
    const result = await classifyRiskWithLlm(
      "add a dark mode toggle",
      ENABLED_OPTS,
      async () => '{"shouldTrigger":false,"channel":"weak-robustness","confidence":0.95,"rationale":"No risk signals."}',
    );
    expect(result.shouldTrigger).toBe(false);
  });

  it("TC-CL-09: confidence clamped from LLM → result.confidence in [0,1]", async () => {
    const result = await classifyRiskWithLlm(
      "should we retire the billing service?",
      ENABLED_OPTS,
      async () => '{"shouldTrigger":true,"channel":"destructive","confidence":2.5,"rationale":"Very confident."}',
    );
    expect(result.shouldTrigger).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
  });

  it("TC-CL-10: invalid channel in LLM response → no trigger (parse fail)", async () => {
    const result = await classifyRiskWithLlm(
      "should we sunset the v1 API?",
      ENABLED_OPTS,
      async () => '{"shouldTrigger":true,"channel":"totally-made-up","confidence":0.9,"rationale":"test"}',
    );
    expect(result.shouldTrigger).toBe(false);
  });

  it("TC-CL-11: rubric prompt passed to onClassify contains key rubric text", async () => {
    let capturedRubric = "";
    await classifyRiskWithLlm(
      "thinking through whether to sunset the v1 API",
      ENABLED_OPTS,
      async (_msg, rubric) => {
        capturedRubric = rubric;
        return '{"shouldTrigger":false,"channel":"weak-robustness","confidence":0.95,"rationale":"none"}';
      },
    );
    expect(capturedRubric).toContain("irreversible changes");
    expect(capturedRubric).toContain("sunsetting");
  });

  it("TC-CL-12: original message passed to onClassify unchanged", async () => {
    const msg = "should we sunset the v1 API and migrate users?";
    let capturedMsg = "";
    await classifyRiskWithLlm(
      msg,
      ENABLED_OPTS,
      async (message, _rubric) => {
        capturedMsg = message;
        return '{"shouldTrigger":false,"channel":"weak-robustness","confidence":0.95,"rationale":"none"}';
      },
    );
    expect(capturedMsg).toBe(msg);
  });

  it("TC-CL-13: config.enabled=false → no trigger, onClassify never called", async () => {
    const onClassify = vi.fn(async () => '{"shouldTrigger":true,"channel":"destructive","confidence":0.9,"rationale":"test"}');
    const result = await classifyRiskWithLlm(
      "sunset the old API",
      { config: { ...ENABLED_FEARSET_CONFIG, enabled: false } },
      onClassify,
    );
    expect(result.shouldTrigger).toBe(false);
    expect(onClassify).not.toHaveBeenCalled();
  });
});

// ─── DanteGaslightIntegration.maybeFearSet — onClassify integration ───────────

describe("DanteGaslightIntegration.maybeFearSet — onClassify Tier 2 integration", () => {
  let testDir: string;
  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("TC-INT-01: onClassify called when Tier 1 misses nuanced message", async () => {
    const onClassify = vi.fn(async () =>
      '{"shouldTrigger":true,"channel":"destructive","confidence":0.88,"rationale":"API retirement."}',
    );
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    const result = await engine.maybeFearSet({
      message: "can you help me think through whether we should sunset the old v1 API?",
      callbacks: { ...makeMockCallbacks(), onClassify },
    });
    expect(onClassify).toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.trigger.channel).toBe("destructive");
  });

  it("TC-INT-02: onClassify NOT called when Tier 1 regex hits", async () => {
    const onClassify = vi.fn(async () =>
      '{"shouldTrigger":true,"channel":"destructive","confidence":0.9,"rationale":"test"}',
    );
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    await engine.maybeFearSet({
      message: "rm -rf /prod/data — nuke everything",  // Tier 1 hit
      callbacks: { ...makeMockCallbacks(), onClassify },
    });
    expect(onClassify).not.toHaveBeenCalled();
  });

  it("TC-INT-03: returns null when onClassify says shouldTrigger=false", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    const result = await engine.maybeFearSet({
      message: "add a dark mode toggle to the settings page",
      callbacks: {
        ...makeMockCallbacks(),
        onClassify: async () =>
          '{"shouldTrigger":false,"channel":"weak-robustness","confidence":0.95,"rationale":"No risk."}',
      },
    });
    expect(result).toBeNull();
  });

  it("TC-INT-04: returns null when onClassify throws (non-fatal)", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    const result = await engine.maybeFearSet({
      message: "should we sunset the old billing API?",
      callbacks: {
        ...makeMockCallbacks(),
        onClassify: async () => { throw new Error("LLM unavailable"); },
      },
    });
    // LLM error → falls back to Tier 1 (no trigger for this nuanced message)
    expect(result).toBeNull();
  });

  it("TC-INT-05: LLM-detected long-horizon channel appears in result.trigger.channel", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    const result = await engine.maybeFearSet({
      message: "help me think through a 6-month migration plan for our auth system",
      callbacks: {
        ...makeMockCallbacks(),
        onClassify: async () =>
          '{"shouldTrigger":true,"channel":"long-horizon","confidence":0.85,"rationale":"6-month migration is long-horizon."}',
      },
    });
    expect(result).not.toBeNull();
    expect(result!.trigger.channel).toBe("long-horizon");
  });

  it("TC-INT-06: rubric string passed to onClassify contains key rubric question text", async () => {
    let receivedRubric = "";
    const engine = new DanteGaslightIntegration({}, { cwd: testDir }, {}, {
      ...ENABLED_FEARSET_CONFIG,
      enabled: true,
    });
    await engine.maybeFearSet({
      message: "I am wondering if we should sunset the v1 API",
      callbacks: {
        ...makeMockCallbacks(),
        onClassify: async (_msg, rubric) => {
          receivedRubric = rubric;
          return '{"shouldTrigger":false,"channel":"weak-robustness","confidence":0.95,"rationale":"none"}';
        },
      },
    });
    // The rubric must contain the key questions we want the LLM to evaluate
    expect(receivedRubric).toContain("irreversible changes");
    expect(receivedRubric).toContain("sunsetting");
    expect(receivedRubric).toContain("shouldTrigger");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// LLM callback content pipeline — semantic richness
// Verifies that specific values returned by LLM callbacks flow correctly
// through parse/apply/store into result fields.
// All tests use runFearSetEngine directly for precision (no integration layer).
// ═════════════════════════════════════════════════════════════════════════════

describe("LLM callback content pipeline — semantic richness", () => {
  // ── Test 1: onColumn define → result.columns[0].worstCases ──────────────
  it("onColumn define: specific worst-cases appear in result.columns worstCases", async () => {
    const specificCases = ["Database corruption", "Total data loss", "Auth token leak"];
    const result = await runFearSetEngine(
      "Should we migrate the auth service?",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({
        onColumn: async (_sys, _user, column) => {
          if (column === "define") return makeDefineJson(specificCases);
          return makeMockCallbacks().onColumn!(_sys, _user, column);
        },
      }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    const defineCol = result.columns.find((c) => c.name === "define");
    expect(defineCol).toBeDefined();
    expect(defineCol!.worstCases).toContain("Database corruption");
    expect(defineCol!.worstCases).toContain("Total data loss");
    expect(defineCol!.worstCases).toContain("Auth token leak");
    expect(defineCol!.worstCases).toHaveLength(3);
  });

  // ── Test 2: onColumn prevent → preventionActions[0].mechanism ───────────
  it("onColumn prevent: specific mechanism text flows into preventionActions[0].mechanism", async () => {
    const specificMechanism = "Blue-green deployment with automated health checks every 30s";
    const customPrevent = JSON.stringify({
      preventionActions: [{
        id: "pa-custom",
        description: "Blue-green switch",
        mechanism: specificMechanism,
        riskReduction: 0.8,
        simulationStatus: "non-simulatable",
      }],
    });
    const result = await runFearSetEngine(
      "Deploy the new service",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({
        onColumn: async (_sys, _user, column) => {
          if (column === "prevent") return customPrevent;
          return makeMockCallbacks().onColumn!(_sys, _user, column);
        },
      }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    const preventCol = result.columns.find((c) => c.name === "prevent");
    expect(preventCol).toBeDefined();
    expect(preventCol!.preventionActions[0]!.mechanism).toBe(specificMechanism);
  });

  // ── Test 3: onColumn repair → repairPlans[0].steps equals sent array ────
  it("onColumn repair: specific steps array is preserved in repairPlans[0].steps", async () => {
    const specificSteps = [
      "Page on-call engineer",
      "Roll back via git revert HEAD~1",
      "Run smoke tests",
      "Confirm in Datadog dashboard",
    ];
    const customRepair = JSON.stringify({
      repairPlans: [{
        id: "rp-custom",
        description: "Emergency rollback",
        steps: specificSteps,
        estimatedRecovery: "15 minutes",
        simulationStatus: "non-simulatable",
      }],
    });
    const result = await runFearSetEngine(
      "Deploy the new service",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({
        onColumn: async (_sys, _user, column) => {
          if (column === "repair") return customRepair;
          return makeMockCallbacks().onColumn!(_sys, _user, column);
        },
      }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    const repairCol = result.columns.find((c) => c.name === "repair");
    expect(repairCol).toBeDefined();
    expect(repairCol!.repairPlans[0]!.steps).toEqual(specificSteps);
  });

  // ── Test 4: onColumn benefits → benefits[0] equals sent string ──────────
  it("onColumn benefits: specific benefit string appears in benefits array", async () => {
    const specificBenefit = "30% reduction in API latency for all customers";
    const customBenefits = JSON.stringify({
      benefits: [specificBenefit, "Improved SLA compliance to 99.99%"],
    });
    const result = await runFearSetEngine(
      "Migrate to new CDN",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({
        onColumn: async (_sys, _user, column) => {
          if (column === "benefits") return customBenefits;
          return makeMockCallbacks().onColumn!(_sys, _user, column);
        },
      }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    const benefitsCol = result.columns.find((c) => c.name === "benefits");
    expect(benefitsCol).toBeDefined();
    expect(benefitsCol!.benefits[0]).toBe(specificBenefit);
  });

  // ── Test 5: onColumn inaction → inactionCosts[0].severity === "critical" ─
  it("onColumn inaction: severity 'critical' is preserved in inactionCosts[0].severity", async () => {
    const customInaction = JSON.stringify({
      inactionCosts: [{
        description: "Irreversible market share loss to competitor",
        timeHorizon: "6 weeks",
        severity: "critical",
      }],
    });
    const result = await runFearSetEngine(
      "Should we sunset the v1 API?",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({
        onColumn: async (_sys, _user, column) => {
          if (column === "inaction") return customInaction;
          return makeMockCallbacks().onColumn!(_sys, _user, column);
        },
      }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    const inactionCol = result.columns.find((c) => c.name === "inaction");
    expect(inactionCol).toBeDefined();
    expect(inactionCol!.inactionCosts[0]!.severity).toBe("critical");
  });

  // ── Test 6: onGate byColumn.define: 0.92 flows through ──────────────────
  it("onGate byColumn.define=0.92 flows through to robustnessScore.byColumn.define", async () => {
    const customGate = JSON.stringify({
      overall: 0.88,
      byColumn: { define: 0.92, prevent: 0.85, repair: 0.82, benefits: 0.78, inaction: 0.76 },
      hasSimulationEvidence: false,
      estimatedRiskReduction: 0.65,
      gateDecision: "pass",
      justification: "Strong across all columns.",
    });
    const result = await runFearSetEngine(
      "Should we sunset the v1 API?",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onGate: async () => customGate }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.robustnessScore?.byColumn?.define).toBeCloseTo(0.92);
  });

  // ── Test 7: onGate justification text flows through ──────────────────────
  it("onGate justification text appears in robustnessScore.justification", async () => {
    const specificJustification = "Define column extremely detailed; repair plan has sandbox evidence.";
    const customGate = JSON.stringify({
      overall: 0.9,
      hasSimulationEvidence: true,
      estimatedRiskReduction: 0.7,
      gateDecision: "pass",
      justification: specificJustification,
    });
    const result = await runFearSetEngine(
      "Deploy the payment service rewrite",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onGate: async () => customGate }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.robustnessScore?.justification).toContain(specificJustification);
  });

  // ── Test 8: onGate hasSimulationEvidence: true ───────────────────────────
  it("onGate hasSimulationEvidence=true flows through to robustnessScore.hasSimulationEvidence", async () => {
    const customGate = JSON.stringify({
      overall: 0.88,
      hasSimulationEvidence: true,
      estimatedRiskReduction: 0.72,
      gateDecision: "pass",
      justification: "Sandbox evidence confirmed.",
    });
    const result = await runFearSetEngine(
      "Run migration on prod",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onGate: async () => customGate }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.robustnessScore?.hasSimulationEvidence).toBe(true);
  });

  // ── Test 9: onGate estimatedRiskReduction: 0.78 flows through ───────────
  it("onGate estimatedRiskReduction=0.78 flows through to robustnessScore", async () => {
    const customGate = JSON.stringify({
      overall: 0.87,
      hasSimulationEvidence: false,
      estimatedRiskReduction: 0.78,
      gateDecision: "pass",
      justification: "High risk reduction.",
    });
    const result = await runFearSetEngine(
      "Archive old user data",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onGate: async () => customGate }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.robustnessScore?.estimatedRiskReduction).toBeCloseTo(0.78);
  });

  // ── Test 10: onSynthesize decision "conditional" flows through ───────────
  it("onSynthesize decision='conditional' appears in synthesizedRecommendation.decision", async () => {
    const synthResponse = JSON.stringify({
      decision: "conditional",
      reasoning: "Plan is solid but requires sign-off from the data team.",
      conditions: ["Get DBA sign-off", "Run in staging for 48h first"],
    });
    const result = await runFearSetEngine(
      "Should we sunset the v1 API?",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onSynthesize: async () => synthResponse }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.decision).toBe("conditional");
  });

  // ── Test 11: onSynthesize conditions array flows through ─────────────────
  it("onSynthesize conditions array flows through to synthesizedRecommendation.conditions", async () => {
    const specificConditions = [
      "Confirm rollback plan has been tested in staging",
      "Get written approval from VP of Engineering",
      "Schedule during low-traffic window (Tue 2-4am UTC)",
    ];
    const synthResponse = JSON.stringify({
      decision: "conditional",
      reasoning: "Requires gated conditions before proceeding.",
      conditions: specificConditions,
    });
    const result = await runFearSetEngine(
      "Should we sunset the v1 API?",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onSynthesize: async () => synthResponse }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.conditions).toEqual(specificConditions);
  });

  // ── Test 12: onSynthesize reasoning text flows through ───────────────────
  it("onSynthesize reasoning text appears in synthesizedRecommendation.reasoning", async () => {
    const specificReasoning = "The plan has adequate coverage across all five columns and sandbox verification was completed.";
    const synthResponse = JSON.stringify({
      decision: "go",
      reasoning: specificReasoning,
      conditions: [],
    });
    const result = await runFearSetEngine(
      "Launch the feature",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onSynthesize: async () => synthResponse }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.reasoning).toContain(specificReasoning);
  });

  // ── Test 13: Integrity — simulationStatus "simulated" without evidence → downgraded ─
  it("prevention action with simulationStatus='simulated' but no evidence is downgraded to 'partially-simulatable'", async () => {
    const integrityViolation = JSON.stringify({
      preventionActions: [{
        id: "pa-integrity",
        description: "Run DB migration in a transaction",
        mechanism: "Wrap in BEGIN/COMMIT with savepoint",
        riskReduction: 0.75,
        simulationStatus: "simulated",  // claims simulated...
        simulationEvidence: "",          // ...but provides no evidence
      }],
    });
    const result = await runFearSetEngine(
      "Run the database migration",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({
        onColumn: async (_sys, _user, column) => {
          if (column === "prevent") return integrityViolation;
          return makeMockCallbacks().onColumn!(_sys, _user, column);
        },
      }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    const preventCol = result.columns.find((c) => c.name === "prevent");
    expect(preventCol).toBeDefined();
    // Integrity guard: "simulated" without evidence must be downgraded
    expect(preventCol!.preventionActions[0]!.simulationStatus).toBe("partially-simulatable");
    expect(preventCol!.preventionActions[0]!.simulationStatus).not.toBe("simulated");
  });

  // ── Test 14: E2E narrative — "Should we sunset the v1 API?" ─────────────
  it("E2E narrative: 'Should we sunset the v1 API?' — all 5 callbacks return rich content, result is populated and passed", async () => {
    const apiSunsetCases = [
      "Client integrations break silently",
      "Revenue drop from enterprise customers",
      "Support escalations surge",
    ];
    const result = await runFearSetEngine(
      "Should we sunset the v1 API?",
      { channel: "explicit-user", rationale: "User asked /fearset", at: new Date().toISOString() },
      {
        onColumn: async (_sys, _user, column) => {
          switch (column) {
            case "define":   return makeDefineJson(apiSunsetCases);
            case "prevent":  return makePreventJson();
            case "repair":   return makeRepairJson();
            case "benefits": return makeBenefitsJson();
            case "inaction": return makeInactionJson();
            default:         return "{}";
          }
        },
        onGate: async () => makeGatePassJson(),
        onSynthesize: async () => JSON.stringify({
          decision: "conditional",
          reasoning: "The sunset is viable but requires a 6-month deprecation notice and migration guides.",
          conditions: [
            "Publish migration guide 6 months before sunset date",
            "Send email to all API key holders",
            "Maintain v1 in read-only mode for 3 months post-deprecation",
          ],
        }),
      },
      { config: ENABLED_FEARSET_CONFIG },
    );

    // All 5 columns populated
    expect(result.columns).toHaveLength(5);
    const defineCol = result.columns.find((c) => c.name === "define");
    expect(defineCol!.worstCases).toHaveLength(3);
    expect(defineCol!.worstCases).toContain("Client integrations break silently");

    const preventCol = result.columns.find((c) => c.name === "prevent");
    expect(preventCol!.preventionActions.length).toBeGreaterThan(0);

    const repairCol = result.columns.find((c) => c.name === "repair");
    expect(repairCol!.repairPlans.length).toBeGreaterThan(0);

    const benefitsCol = result.columns.find((c) => c.name === "benefits");
    expect(benefitsCol!.benefits.length).toBeGreaterThan(0);

    const inactionCol = result.columns.find((c) => c.name === "inaction");
    expect(inactionCol!.inactionCosts.length).toBeGreaterThan(0);

    // Gate passed
    expect(result.passed).toBe(true);
    expect(result.robustnessScore?.gateDecision).toBe("pass");

    // Synthesized recommendation populated from onSynthesize callback
    expect(result.synthesizedRecommendation?.decision).toBe("conditional");
    expect(result.synthesizedRecommendation?.conditions).toHaveLength(3);
    expect(result.synthesizedRecommendation?.reasoning).toContain("deprecation notice");
  });

  // ── Test 15: onSynthesize null → heuristic fires (not undefined) ─────────
  it("onSynthesize returning null falls back to heuristic recommendation (not undefined)", async () => {
    const result = await runFearSetEngine(
      "Archive the old analytics data",
      EXPLICIT_TRIGGER,
      makeMockCallbacks({ onSynthesize: async () => null }),
      { config: ENABLED_FEARSET_CONFIG },
    );
    // synthesizedRecommendation must be defined even when onSynthesize returns null
    expect(result.synthesizedRecommendation).toBeDefined();
    // Heuristic fires — decision is one of the three valid decisions
    expect(["go", "no-go", "conditional"]).toContain(result.synthesizedRecommendation!.decision);
    // Heuristic reasoning is non-empty
    expect(result.synthesizedRecommendation!.reasoning.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Heuristic recommendation quality — all decision paths
// ─────────────────────────────────────────────────────────────────────────────
// All tests use onSynthesize: undefined to force the heuristic path and
// a carefully crafted onGate JSON to exercise each branch of
// heuristicRecommendation(). No LLM inference required — fully deterministic.
// ─────────────────────────────────────────────────────────────────────────────

describe("heuristic recommendation quality — all decision paths", () => {
  /** onGate JSON that sets gateDecision, hasSimulationEvidence, estimatedRiskReduction. */
  function makeGateJson(
    gateDecision: "pass" | "fail" | "review-required",
    estimatedRiskReduction: number,
    hasSimulationEvidence: boolean,
  ): string {
    return JSON.stringify({
      overall: gateDecision === "fail" ? 0.3 : gateDecision === "review-required" ? 0.6 : 0.85,
      byColumn: { define: 0.8, prevent: 0.8, repair: 0.8, benefits: 0.7, inaction: 0.7 },
      hasSimulationEvidence,
      estimatedRiskReduction,
      gateDecision,
      justification: "test",
    });
  }

  const CB_BASE = makeMockCallbacks({ onSynthesize: undefined });

  // ── Test HR-01: gate fail → decision no-go ──────────────────────────────
  it("HR-01: gate 'fail' → synthesizedRecommendation.decision === 'no-go'", async () => {
    const result = await runFearSetEngine(
      "Drop the production database",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("fail", 0.1, false) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.decision).toBe("no-go");
  });

  // ── Test HR-02: gate fail → conditions empty ─────────────────────────────
  it("HR-02: gate 'fail' → conditions is empty array", async () => {
    const result = await runFearSetEngine(
      "Drop the production database",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("fail", 0.1, false) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.conditions).toEqual([]);
  });

  // ── Test HR-03: gate review-required → decision conditional ─────────────
  it("HR-03: gate 'review-required' → synthesizedRecommendation.decision === 'conditional'", async () => {
    const result = await runFearSetEngine(
      "Migrate auth provider",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("review-required", 0.4, false) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.decision).toBe("conditional");
  });

  // ── Test HR-04: gate review-required → conditions non-empty ─────────────
  it("HR-04: gate 'review-required' → conditions.length >= 1", async () => {
    const result = await runFearSetEngine(
      "Migrate auth provider",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("review-required", 0.4, false) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect((result.synthesizedRecommendation?.conditions ?? []).length).toBeGreaterThanOrEqual(1);
  });

  // ── Test HR-05: pass + high reduction + simulation → go ─────────────────
  it("HR-05: gate 'pass' + riskReduction 0.7 + hasSimulation → decision 'go'", async () => {
    const result = await runFearSetEngine(
      "Deploy with feature flags",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("pass", 0.7, true) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.decision).toBe("go");
  });

  // ── Test HR-06: pass + high reduction + simulation → conditions empty ────
  it("HR-06: gate 'pass' + riskReduction 0.7 + hasSimulation → conditions === []", async () => {
    const result = await runFearSetEngine(
      "Deploy with feature flags",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("pass", 0.7, true) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.conditions).toEqual([]);
  });

  // ── Test HR-07: pass + medium reduction + no simulation → sandbox-test condition ─
  it("HR-07: gate 'pass' + riskReduction 0.4 + no simulation → conditions includes 'Sandbox-test'", async () => {
    const result = await runFearSetEngine(
      "Gradual infrastructure migration",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("pass", 0.4, false) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    const conditions = result.synthesizedRecommendation?.conditions ?? [];
    expect(conditions.some((c) => c.includes("Sandbox-test"))).toBe(true);
  });

  // ── Test HR-08: pass + medium reduction + simulation → monitor-only condition ─
  it("HR-08: gate 'pass' + riskReduction 0.4 + hasSimulation → conditions === ['Monitor closely during execution']", async () => {
    const result = await runFearSetEngine(
      "Gradual infrastructure migration",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("pass", 0.4, true) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.conditions).toEqual(["Monitor closely during execution"]);
  });

  // ── Test HR-09: pass + low reduction → logging + rollback conditions ─────
  it("HR-09: gate 'pass' + riskReduction 0.1 → decision 'conditional', conditions include 'Enable detailed logging'", async () => {
    const result = await runFearSetEngine(
      "Tentative schema change",
      EXPLICIT_TRIGGER,
      { ...CB_BASE, onGate: async () => makeGateJson("pass", 0.1, false) },
      { config: ENABLED_FEARSET_CONFIG },
    );
    expect(result.synthesizedRecommendation?.decision).toBe("conditional");
    const conditions = result.synthesizedRecommendation?.conditions ?? [];
    expect(conditions.some((c) => c.includes("Enable detailed logging"))).toBe(true);
  });
});
