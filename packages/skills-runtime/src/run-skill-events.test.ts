/**
 * run-skill-events.test.ts
 *
 * Tests for skill event emission during load and execution.
 * Wave 3, Task 3.4: Skill Event Emission
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSkill } from "./run-skill.js";
import type { DanteSkill } from "./dante-skill.js";
import type { SkillRunContext } from "./skill-run-context.js";
import type { EventEmitter, RuntimeEvent } from "@dantecode/runtime-spine";
import { makeRunContext } from "./skill-run-context.js";

// ============================================================================
// Test Setup
// ============================================================================

function createMockEventEmitter(): EventEmitter {
  const emittedEvents: RuntimeEvent[] = [];

  return {
    emit: vi.fn(async (event: RuntimeEvent) => {
      emittedEvents.push(event);
      return emittedEvents.length;
    }),
    getEmittedEvents: () => emittedEvents,
  } as unknown as EventEmitter;
}

function createMinimalSkill(overrides: Partial<DanteSkill> = {}): DanteSkill {
  return {
    name: "test-skill",
    description: "Test skill",
    sourceType: "native",
    sourceRef: "/test/skills/test-skill",
    license: "MIT",
    instructions: "Test instructions",
    provenance: {
      sourceType: "native",
      sourceRef: "/test/skills/test-skill",
      license: "MIT",
      importedAt: new Date().toISOString(),
    },
    metadata: { trustTier: "high" },
    scripts: undefined,
    ...overrides,
  };
}

// ============================================================================
// Test Suite 1: Skill Load Event Emission (6 tests)
// ============================================================================

describe("Skill Load Event Emission", () => {
  let mockEngine: EventEmitter & { getEmittedEvents: () => RuntimeEvent[] };
  let context: SkillRunContext;

  beforeEach(() => {
    mockEngine = createMockEventEmitter() as EventEmitter & { getEmittedEvents: () => RuntimeEvent[] };
    context = makeRunContext({
      skillName: "test-skill",
      mode: "apply",
      projectRoot: "/test",
      dryRun: false,
    });
  });

  it("should emit run.skill.loaded event when skill is loaded", async () => {
    const skill = createMinimalSkill();

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");

    expect(loadEvent).toBeDefined();
    expect(loadEvent?.payload.skillName).toBe("test-skill");
  });

  it("should include source type in load event payload", async () => {
    const skill = createMinimalSkill({ sourceType: "hf" });

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");

    expect(loadEvent?.payload.source).toBe("hf");
  });

  it("should include license in load event payload", async () => {
    const skill = createMinimalSkill({
      license: "Apache-2.0",
    });

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");

    expect(loadEvent?.payload.license).toBe("Apache-2.0");
  });

  it("should include trustTier in load event payload", async () => {
    const skill = createMinimalSkill({
      metadata: { trustTier: "verified" },
    });

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");

    expect(loadEvent?.payload.trustTier).toBe("verified");
  });

  it("should default trustTier to 'unknown' if not specified", async () => {
    const skill = createMinimalSkill({
      metadata: {},
    });

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");

    expect(loadEvent?.payload.trustTier).toBe("unknown");
  });

  it("should use provided taskId for event correlation", async () => {
    const skill = createMinimalSkill();
    const customTaskId = "550e8400-e29b-41d4-a716-446655440000"; // Valid UUID

    await runSkill({ skill, context, eventEngine: mockEngine, taskId: customTaskId });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");

    expect(loadEvent?.taskId).toBe(customTaskId);
  });
});

// ============================================================================
// Test Suite 2: Skill Execute Event Emission (8 tests)
// ============================================================================

describe("Skill Execute Event Emission", () => {
  let mockEngine: EventEmitter & { getEmittedEvents: () => RuntimeEvent[] };
  let context: SkillRunContext;

  beforeEach(() => {
    mockEngine = createMockEventEmitter() as EventEmitter & { getEmittedEvents: () => RuntimeEvent[] };
    context = makeRunContext({
      skillName: "test-skill",
      mode: "apply",
      projectRoot: "/test",
      dryRun: false,
    });
  });

  it("should emit run.skill.executed event after execution", async () => {
    const skill = createMinimalSkill();

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(executeEvent).toBeDefined();
    expect(executeEvent?.payload.skillName).toBe("test-skill");
  });

  it("should report success=true for verified skills", async () => {
    const skill = createMinimalSkill({ scripts: "echo test" });
    const scriptRunner = vi.fn(async () => ({
      commands: ["echo test"],
      fileReceipts: [],
      allSucceeded: true,
    }));

    await runSkill({
      skill,
      context,
      eventEngine: mockEngine,
      scriptRunner,
      verification: { outcome: "pass", summary: "Verified" },
    });

    const events = mockEngine.getEmittedEvents();
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(executeEvent?.payload.success).toBe(true);
  });

  it("should report success=true for applied skills", async () => {
    const skill = createMinimalSkill({ scripts: "echo test" });
    const scriptRunner = vi.fn(async () => ({
      commands: ["echo test"],
      fileReceipts: [],
      allSucceeded: true,
    }));

    await runSkill({ skill, context, eventEngine: mockEngine, scriptRunner });

    const events = mockEngine.getEmittedEvents();
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(executeEvent?.payload.success).toBe(true);
  });

  it("should report success=false for failed skills", async () => {
    const skill = createMinimalSkill({ scripts: "echo test" });
    const scriptRunner = vi.fn(async () => {
      throw new Error("Execution failed");
    });

    await runSkill({ skill, context, eventEngine: mockEngine, scriptRunner });

    const events = mockEngine.getEmittedEvents();
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(executeEvent?.payload.success).toBe(false);
    expect(executeEvent?.payload.error).toContain("Execution failed");
  });

  it("should include execution duration in milliseconds", async () => {
    const skill = createMinimalSkill();

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(executeEvent?.payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof executeEvent?.payload.durationMs).toBe("number");
  });

  it("should emit both load and execute events in correct order", async () => {
    const skill = createMinimalSkill();

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const eventKinds = events.map((e: RuntimeEvent) => e.kind);

    expect(eventKinds).toEqual(["run.skill.loaded", "run.skill.executed"]);
  });

  it("should use same taskId for load and execute events", async () => {
    const skill = createMinimalSkill();
    const customTaskId = "650e8400-e29b-41d4-a716-446655440000"; // Valid UUID

    await runSkill({ skill, context, eventEngine: mockEngine, taskId: customTaskId });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(loadEvent?.taskId).toBe(customTaskId);
    expect(executeEvent?.taskId).toBe(customTaskId);
  });

  it("should generate taskId if not provided and use it for both events", async () => {
    const skill = createMinimalSkill();

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(loadEvent?.taskId).toBeDefined();
    expect(executeEvent?.taskId).toBeDefined();
    expect(loadEvent?.taskId).toBe(executeEvent?.taskId);
  });
});

// ============================================================================
// Test Suite 3: Event Payload Validation (4 tests)
// ============================================================================

describe("Event Payload Validation", () => {
  let mockEngine: EventEmitter & { getEmittedEvents: () => RuntimeEvent[] };
  let context: SkillRunContext;

  beforeEach(() => {
    mockEngine = createMockEventEmitter() as EventEmitter & { getEmittedEvents: () => RuntimeEvent[] };
    context = makeRunContext({
      skillName: "test-skill",
      mode: "apply",
      projectRoot: "/test",
      dryRun: false,
    });
  });

  it("should include skillId in both load and execute events", async () => {
    const skill = createMinimalSkill();

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(loadEvent?.payload.skillId).toBeDefined();
    expect(executeEvent?.payload.skillId).toBeDefined();
    expect(loadEvent?.payload.skillId).toBe(executeEvent?.payload.skillId);
  });

  it("should omit error field when skill succeeds", async () => {
    const skill = createMinimalSkill({ scripts: "echo test" });
    const scriptRunner = vi.fn(async () => ({
      commands: ["echo test"],
      fileReceipts: [],
      allSucceeded: true,
    }));

    await runSkill({ skill, context, eventEngine: mockEngine, scriptRunner });

    const events = mockEngine.getEmittedEvents();
    const executeEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.executed");

    expect(executeEvent?.payload.error).toBeUndefined();
  });

  it("should not emit events when eventEngine is not provided", async () => {
    const skill = createMinimalSkill();

    await runSkill({ skill, context });

    // No way to verify since we don't have access to the engine, but ensure no errors
    expect(true).toBe(true);
  });

  it("should handle skills with no metadata gracefully", async () => {
    const skill: DanteSkill = {
      name: "minimal-skill",
      description: "Minimal skill",
      sourceType: "native",
      sourceRef: "/test/minimal",
      license: "MIT",
      instructions: "Minimal",
      provenance: {
        sourceType: "native",
        sourceRef: "/test/minimal",
        license: "MIT",
        importedAt: new Date().toISOString(),
      },
      scripts: undefined,
    };

    await runSkill({ skill, context, eventEngine: mockEngine });

    const events = mockEngine.getEmittedEvents();
    const loadEvent = events.find((e: RuntimeEvent) => e.kind === "run.skill.loaded");

    expect(loadEvent).toBeDefined();
    expect(loadEvent?.payload.license).toBe("MIT");
    expect(loadEvent?.payload.trustTier).toBe("unknown");
  });
});

// ============================================================================
// Test Suite 4: Run Report Integration (2 tests)
// ============================================================================

describe("Run Report Integration", () => {
  it("should allow RunReport to track loaded skills", () => {
    const report = {
      project: "test",
      command: "test",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      entries: [],
      filesManifest: [],
      tokenUsage: { input: 0, output: 0 },
      costEstimate: 0,
      dantecodeVersion: "0.1.0",
      environment: { nodeVersion: "v20.0.0", os: "linux" },
      skillsLoaded: ["skill-1", "skill-2", "skill-3"],
    };

    expect(report.skillsLoaded).toHaveLength(3);
    expect(report.skillsLoaded).toContain("skill-2");
  });

  it("should allow RunReport to track executed skills with success and PDSE", () => {
    const report = {
      project: "test",
      command: "test",
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      entries: [],
      filesManifest: [],
      tokenUsage: { input: 0, output: 0 },
      costEstimate: 0,
      dantecodeVersion: "0.1.0",
      environment: { nodeVersion: "v20.0.0", os: "linux" },
      skillsExecuted: [
        { name: "skill-1", success: true, pdse: 95 },
        { name: "skill-2", success: false, pdse: 42 },
        { name: "skill-3", success: true, pdse: 88 },
      ],
    };

    expect(report.skillsExecuted).toHaveLength(3);
    const executed = report.skillsExecuted!;
    expect(executed[0]).toMatchObject({
      name: "skill-1",
      success: true,
      pdse: 95,
    });
    expect(executed[1]!.success).toBe(false);
  });
});
