/**
 * runtime-events.test.ts
 *
 * Tests for RuntimeEventKindSchema and payload types.
 */

import { describe, it, expect } from "vitest";
import {
  RuntimeEventKindSchema,
  buildRuntimeEvent,
  RunTaskClassifiedPayloadSchema,
  RunModeSelectedPayloadSchema,
  RunModeChangedPayloadSchema,
  RunPermissionDeniedPayloadSchema,
  RunContextAssembledPayloadSchema,
  RunSkillLoadedPayloadSchema,
  RunSkillExecutedPayloadSchema,
  RunPlanCreatedPayloadSchema,
  RunDecompositionStartedPayloadSchema,
  RunDecompositionCompletedPayloadSchema,
  RunToolStartedPayloadSchema,
  RunToolCompletedPayloadSchema,
  RunToolFailedPayloadSchema,
  RunCheckpointSavedPayloadSchema,
  RunCheckpointRestoredPayloadSchema,
  RunRepairLintStartedPayloadSchema,
  RunRepairLintCompletedPayloadSchema,
  RunRepairTestStartedPayloadSchema,
  RunRepairTestCompletedPayloadSchema,
  RunReportWrittenPayloadSchema,
  RunWorktreeCreatedPayloadSchema,
  RunWorktreeMergedPayloadSchema,
  RunWorktreeCleanedPayloadSchema,
} from "./runtime-events.js";

describe("RuntimeEventKindSchema", () => {
  it("should validate run.task.classified", () => {
    expect(() => RuntimeEventKindSchema.parse("run.task.classified")).not.toThrow();
  });

  it("should validate run.mode.selected", () => {
    expect(() => RuntimeEventKindSchema.parse("run.mode.selected")).not.toThrow();
  });

  it("should validate run.mode.changed", () => {
    expect(() => RuntimeEventKindSchema.parse("run.mode.changed")).not.toThrow();
  });

  it("should validate run.permission.denied", () => {
    expect(() => RuntimeEventKindSchema.parse("run.permission.denied")).not.toThrow();
  });

  it("should validate run.context.assembled", () => {
    expect(() => RuntimeEventKindSchema.parse("run.context.assembled")).not.toThrow();
  });

  it("should validate run.skill.loaded", () => {
    expect(() => RuntimeEventKindSchema.parse("run.skill.loaded")).not.toThrow();
  });

  it("should validate run.skill.executed", () => {
    expect(() => RuntimeEventKindSchema.parse("run.skill.executed")).not.toThrow();
  });

  it("should validate run.plan.created", () => {
    expect(() => RuntimeEventKindSchema.parse("run.plan.created")).not.toThrow();
  });

  it("should validate run.decomposition.started", () => {
    expect(() => RuntimeEventKindSchema.parse("run.decomposition.started")).not.toThrow();
  });

  it("should validate run.decomposition.completed", () => {
    expect(() => RuntimeEventKindSchema.parse("run.decomposition.completed")).not.toThrow();
  });

  it("should validate run.tool.started", () => {
    expect(() => RuntimeEventKindSchema.parse("run.tool.started")).not.toThrow();
  });

  it("should validate run.tool.completed", () => {
    expect(() => RuntimeEventKindSchema.parse("run.tool.completed")).not.toThrow();
  });

  it("should validate run.tool.failed", () => {
    expect(() => RuntimeEventKindSchema.parse("run.tool.failed")).not.toThrow();
  });

  it("should validate run.checkpoint.saved", () => {
    expect(() => RuntimeEventKindSchema.parse("run.checkpoint.saved")).not.toThrow();
  });

  it("should validate run.checkpoint.restored", () => {
    expect(() => RuntimeEventKindSchema.parse("run.checkpoint.restored")).not.toThrow();
  });

  it("should validate run.repair.lint.started", () => {
    expect(() => RuntimeEventKindSchema.parse("run.repair.lint.started")).not.toThrow();
  });

  it("should validate run.repair.lint.completed", () => {
    expect(() => RuntimeEventKindSchema.parse("run.repair.lint.completed")).not.toThrow();
  });

  it("should validate run.repair.test.started", () => {
    expect(() => RuntimeEventKindSchema.parse("run.repair.test.started")).not.toThrow();
  });

  it("should validate run.repair.test.completed", () => {
    expect(() => RuntimeEventKindSchema.parse("run.repair.test.completed")).not.toThrow();
  });

  it("should validate run.report.written", () => {
    expect(() => RuntimeEventKindSchema.parse("run.report.written")).not.toThrow();
  });

  it("should validate run.worktree.created", () => {
    expect(() => RuntimeEventKindSchema.parse("run.worktree.created")).not.toThrow();
  });

  it("should validate run.worktree.merged", () => {
    expect(() => RuntimeEventKindSchema.parse("run.worktree.merged")).not.toThrow();
  });

  it("should validate run.worktree.cleaned", () => {
    expect(() => RuntimeEventKindSchema.parse("run.worktree.cleaned")).not.toThrow();
  });

  it("should reject invalid event kinds", () => {
    expect(() => RuntimeEventKindSchema.parse("invalid.event.kind")).toThrow();
  });
});

describe("RuntimeEvent payload schemas", () => {
  it("should validate RunTaskClassifiedPayload", () => {
    const payload = {
      taskClass: "code",
      confidence: 0.95,
    };
    expect(() => RunTaskClassifiedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunModeSelectedPayload", () => {
    const payload = {
      mode: "autonomous",
      reason: "single task detected",
    };
    expect(() => RunModeSelectedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunModeChangedPayload", () => {
    const payload = {
      fromMode: "interactive",
      toMode: "council",
      reason: "escalated to multi-agent",
    };
    expect(() => RunModeChangedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunPermissionDeniedPayload", () => {
    const payload = {
      resource: "/etc/passwd",
      action: "write",
      reason: "outside project boundary",
      boundary: "project",
    };
    expect(() => RunPermissionDeniedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunContextAssembledPayload", () => {
    const payload = {
      contextSize: 50000,
      skillsLoaded: 5,
      tokensEstimated: 12000,
    };
    expect(() => RunContextAssembledPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunSkillLoadedPayload", () => {
    const payload = {
      skillId: "test-skill-123",
      skillName: "test-driven-development",
      source: "local",
    };
    expect(() => RunSkillLoadedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunSkillExecutedPayload", () => {
    const payload = {
      skillId: "test-skill-123",
      skillName: "test-driven-development",
      durationMs: 5000,
      success: true,
    };
    expect(() => RunSkillExecutedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunPlanCreatedPayload", () => {
    const payload = {
      planId: "plan-abc123",
      stepCount: 12,
      complexity: "moderate",
    };
    expect(() => RunPlanCreatedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunDecompositionStartedPayload", () => {
    const payload = {
      taskDescription: "Implement authentication system",
      targetSteps: 8,
    };
    expect(() => RunDecompositionStartedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunDecompositionCompletedPayload", () => {
    const payload = {
      stepCount: 10,
      durationMs: 3000,
      success: true,
    };
    expect(() => RunDecompositionCompletedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunToolStartedPayload", () => {
    const payload = {
      toolName: "Bash",
      toolId: "bash-001",
      params: { command: "npm test" },
    };
    expect(() => RunToolStartedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunToolCompletedPayload", () => {
    const payload = {
      toolName: "Read",
      toolId: "read-001",
      durationMs: 50,
      outputSize: 2048,
    };
    expect(() => RunToolCompletedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunToolFailedPayload", () => {
    const payload = {
      toolName: "Write",
      toolId: "write-001",
      error: "Permission denied",
      durationMs: 100,
      retryable: true,
    };
    expect(() => RunToolFailedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunCheckpointSavedPayload", () => {
    const payload = {
      checkpointId: "checkpoint-xyz789",
      version: 3,
      eventId: 150,
      sizeBytes: 10240,
    };
    expect(() => RunCheckpointSavedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunCheckpointRestoredPayload", () => {
    const payload = {
      checkpointId: "checkpoint-xyz789",
      version: 3,
      eventId: 150,
      replayEventsCount: 25,
    };
    expect(() => RunCheckpointRestoredPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunRepairLintStartedPayload", () => {
    const payload = {
      filesCount: 15,
      linter: "eslint",
    };
    expect(() => RunRepairLintStartedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunRepairLintCompletedPayload", () => {
    const payload = {
      filesCount: 15,
      errorsFound: 8,
      errorsFixed: 7,
      durationMs: 2500,
    };
    expect(() => RunRepairLintCompletedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunRepairTestStartedPayload", () => {
    const payload = {
      testCount: 45,
      testRunner: "vitest",
    };
    expect(() => RunRepairTestStartedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunRepairTestCompletedPayload", () => {
    const payload = {
      testCount: 45,
      passed: 42,
      failed: 3,
      durationMs: 15000,
    };
    expect(() => RunRepairTestCompletedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunReportWrittenPayload", () => {
    const payload = {
      reportPath: "/project/.dantecode/reports/run-123.json",
      reportType: "run",
      sizeBytes: 5120,
    };
    expect(() => RunReportWrittenPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunWorktreeCreatedPayload", () => {
    const payload = {
      worktreePath: "/project/.worktrees/lane-abc",
      worktreeBranch: "council/session-123/lane-abc",
      laneId: "lane-abc",
    };
    expect(() => RunWorktreeCreatedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunWorktreeMergedPayload", () => {
    const payload = {
      worktreeBranch: "council/session-123/lane-abc",
      targetBranch: "main",
      commitSha: "abc123def456",
      laneId: "lane-abc",
    };
    expect(() => RunWorktreeMergedPayloadSchema.parse(payload)).not.toThrow();
  });

  it("should validate RunWorktreeCleanedPayload", () => {
    const payload = {
      worktreePath: "/project/.worktrees/lane-abc",
      worktreeBranch: "council/session-123/lane-abc",
      preserved: false,
      reason: "merge successful",
    };
    expect(() => RunWorktreeCleanedPayloadSchema.parse(payload)).not.toThrow();
  });
});

describe("buildRuntimeEvent", () => {
  it("should build a complete runtime event with new event kinds", () => {
    const event = buildRuntimeEvent({
      kind: "run.task.classified",
      taskId: "550e8400-e29b-41d4-a716-446655440000",
      payload: {
        taskClass: "code",
        confidence: 0.95,
      },
    });

    expect(event.kind).toBe("run.task.classified");
    expect(event.taskId).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(event.payload.taskClass).toBe("code");
    expect(event.at).toBeDefined();
  });

  it("should auto-generate timestamp if not provided", () => {
    const event = buildRuntimeEvent({
      kind: "run.checkpoint.saved",
      taskId: "550e8400-e29b-41d4-a716-446655440000",
      payload: {
        checkpointId: "checkpoint-001",
        version: 1,
        eventId: 100,
      },
    });

    expect(event.at).toBeDefined();
    expect(new Date(event.at).toISOString()).toBe(event.at);
  });

  it("should preserve parentId if provided", () => {
    const event = buildRuntimeEvent({
      kind: "run.tool.completed",
      taskId: "550e8400-e29b-41d4-a716-446655440000",
      parentId: "650e8400-e29b-41d4-a716-446655440000",
      payload: {
        toolName: "Read",
        durationMs: 50,
      },
    });

    expect(event.parentId).toBe("650e8400-e29b-41d4-a716-446655440000");
  });
});
