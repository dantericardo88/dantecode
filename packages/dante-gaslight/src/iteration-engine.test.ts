import { describe, it, expect } from "vitest";
import { runIterationEngine, createStopController } from "./iteration-engine.js";
import type { GaslightTrigger, GaslightConfig } from "./types.js";

const trigger: GaslightTrigger = {
  channel: "explicit-user",
  phrase: "go deeper",
  at: new Date().toISOString(),
};

const minConfig: Partial<GaslightConfig> = {
  enabled: true,
  maxIterations: 2,
  maxTokens: 100_000,
  maxSeconds: 60,
  passThreshold: 0.75,
  confidenceThreshold: 0.9,
};

describe("runIterationEngine", () => {
  it("runs without callbacks and stops on iteration budget", async () => {
    const session = await runIterationEngine("Initial draft.", trigger, {}, { config: minConfig });
    expect(session.sessionId).toBeTruthy();
    expect(session.stopReason).toBe("budget-iterations");
    expect(session.iterations).toHaveLength(2);
    expect(session.finalOutput).toBeDefined();
  });

  it("stops on pass gate decision", async () => {
    let callCount = 0;
    const session = await runIterationEngine(
      "Initial draft.",
      trigger,
      {
        onGate: async () => {
          callCount++;
          return { decision: "pass" as const, score: 0.95 };
        },
      },
      { config: minConfig },
    );
    expect(session.stopReason).toBe("pass");
    expect(callCount).toBe(1);
    expect(session.lessonEligible).toBe(true);
  });

  it("stops on confidence threshold", async () => {
    const session = await runIterationEngine(
      "Initial draft.",
      trigger,
      {
        onGate: async () => ({ decision: "fail" as const, score: 0.95 }),
      },
      { config: { ...minConfig, confidenceThreshold: 0.9, maxIterations: 5 } },
    );
    expect(session.stopReason).toBe("confidence");
  });

  it("rewrites draft when onRewrite is provided", async () => {
    let lastDraft = "";
    const session = await runIterationEngine(
      "Original draft.",
      trigger,
      {
        onRewrite: async (_draft, _summary) => "Improved draft.",
        onGate: async (draft) => {
          lastDraft = draft;
          return { decision: "pass" as const, score: 0.9 };
        },
      },
      { config: minConfig },
    );
    expect(lastDraft).toBe("Improved draft.");
    expect(session.finalOutput).toBe("Improved draft.");
  });

  it("sets lessonEligible false on fail stop", async () => {
    const session = await runIterationEngine(
      "draft",
      trigger,
      {},
      { config: { ...minConfig, maxIterations: 1 } },
    );
    expect(session.lessonEligible).toBe(false);
  });

  it("calls onStop when session ends", async () => {
    let stopCalled = false;
    await runIterationEngine(
      "draft",
      trigger,
      {
        onStop: () => {
          stopCalled = true;
        },
      },
      { config: { ...minConfig, maxIterations: 1 } },
    );
    expect(stopCalled).toBe(true);
  });
});

describe("createStopController", () => {
  it("starts not stopped", () => {
    const ctrl = createStopController();
    expect(ctrl.stopped()).toBe(false);
  });

  it("stopped returns true after stop()", () => {
    const ctrl = createStopController();
    ctrl.stop();
    expect(ctrl.stopped()).toBe(true);
  });
});

describe("onLessonEligible callback", () => {
  it("fires when session ends with pass and lessonEligible=true", async () => {
    let capturedId: string | undefined;
    await runIterationEngine(
      "draft",
      trigger,
      {
        onGate: async () => ({ decision: "pass" as const, score: 0.95 }),
        onLessonEligible: (id) => {
          capturedId = id;
        },
      },
      { config: minConfig },
    );
    expect(capturedId).toBeTruthy();
  });

  it("does NOT fire when session ends without pass", async () => {
    let called = false;
    await runIterationEngine(
      "draft",
      trigger,
      {
        onLessonEligible: () => {
          called = true;
        },
      },
      { config: { ...minConfig, maxIterations: 1 } },
    );
    expect(called).toBe(false);
  });
});

describe("priorLessons injection", () => {
  it("passes priorLessons to the critique prompt", async () => {
    const capturedPrompts: string[] = [];
    await runIterationEngine(
      "draft",
      trigger,
      {
        onCritique: async (_sys, userPrompt) => {
          capturedPrompts.push(userPrompt);
          return null;
        },
        onGate: async () => ({ decision: "pass" as const, score: 0.95 }),
      },
      { config: minConfig, priorLessons: ["Always add citations"] },
    );
    expect(capturedPrompts[0]).toContain("Always add citations");
    expect(capturedPrompts[0]).toContain("Prior Lessons from Skillbook");
  });

  it("omits lessons block when priorLessons not provided", async () => {
    const capturedPrompts: string[] = [];
    await runIterationEngine(
      "draft",
      trigger,
      {
        onCritique: async (_sys, userPrompt) => {
          capturedPrompts.push(userPrompt);
          return null;
        },
        onGate: async () => ({ decision: "pass" as const, score: 0.95 }),
      },
      { config: minConfig },
    );
    expect(capturedPrompts[0]).not.toContain("Prior Lessons");
  });
});
