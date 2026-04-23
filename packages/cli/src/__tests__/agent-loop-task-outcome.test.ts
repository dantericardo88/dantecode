import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dantecode/danteforge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/danteforge")>();
  return {
    ...actual,
    recordTaskOutcome: vi.fn().mockResolvedValue(undefined),
  };
});

import * as danteforgeModule from "@dantecode/danteforge";
import type { CompletionGateResult, ExecutionLedger, Session, ValidationRecord } from "@dantecode/config-types";
import {
  buildTaskOutcomeVerificationSnapshots,
  persistAgentTaskOutcome,
} from "../agent-loop.js";

const mockRecordTaskOutcome = (danteforgeModule as unknown as Record<string, ReturnType<typeof vi.fn>>)["recordTaskOutcome"]!;

function makeValidationRecord(overrides: Partial<ValidationRecord> = {}): ValidationRecord {
  return {
    id: "val-1",
    type: "test",
    command: "npm test",
    exitCode: 0,
    output: "",
    passed: true,
    timestamp: "2026-04-20T10:00:01.000Z",
    ...overrides,
  };
}

function makeCompletionGateResult(overrides: Partial<CompletionGateResult> = {}): CompletionGateResult {
  return {
    ok: true,
    timestamp: "2026-04-20T10:00:02.000Z",
    ...overrides,
  };
}

function makeSession(): Session {
  return {
    id: "session-1",
    projectRoot: "/repo",
    messages: [],
    activeFiles: [],
    readOnlyFiles: [],
    model: {
      provider: "anthropic",
      modelId: "claude-test",
      maxTokens: 4096,
      temperature: 0.2,
      contextWindow: 200000,
      supportsVision: false,
      supportsToolCalls: true,
    },
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-20T10:00:00.000Z",
    agentStack: [],
    todoList: [],
  };
}

describe("agent loop task outcome helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds verification snapshots from validation records and completion gate", () => {
    const validationRecords = [
      makeValidationRecord(),
      makeValidationRecord({
        id: "val-2",
        type: "lint",
        command: "npm run lint",
        passed: false,
        exitCode: 1,
      }),
    ];
    const completionGate = makeCompletionGateResult({
      ok: false,
      reasonCode: "missing_validation",
    });

    const snapshots = buildTaskOutcomeVerificationSnapshots(validationRecords, completionGate);

    expect(snapshots).toHaveLength(3);
    expect(snapshots[0]).toMatchObject({
      kind: "test-1",
      passed: true,
    });
    expect(snapshots[1]).toMatchObject({
      kind: "lint-2",
      passed: false,
    });
    expect(snapshots[2]).toMatchObject({
      kind: "completion-gate",
      passed: false,
    });
  });

  it("persists a COMPLETE agent outcome as success with touched files and metadata", async () => {
    const executionLedger: ExecutionLedger = {
      toolCallRecords: [],
      mutationRecords: [],
      validationRecords: [makeValidationRecord()],
      completionGateResult: makeCompletionGateResult(),
    };

    await persistAgentTaskOutcome({
      prompt: "Fix the failing route handler",
      session: makeSession(),
      sessionStatus: "COMPLETE",
      taskStartTime: new Date("2026-04-20T10:00:00.000Z").getTime(),
      completionTime: new Date("2026-04-20T10:00:05.000Z").getTime(),
      touchedFiles: ["src/routes.ts"],
      executionLedger,
      verifyRetries: 1,
      autonomyVerifyRoundsUsed: 2,
      confabulationNudges: 0,
      modelRoundTrips: 3,
    });

    expect(mockRecordTaskOutcome).toHaveBeenCalledTimes(1);
    expect(mockRecordTaskOutcome.mock.calls[0]?.[0]).toMatchObject({
      command: "agent",
      taskDescription: "Fix the failing route handler",
      success: true,
      evidenceRefs: ["src/routes.ts"],
      metadata: expect.objectContaining({
        status: "COMPLETE",
        touchedFiles: 1,
        verifyRetries: 1,
        autonomyVerifyRoundsUsed: 2,
      }),
    });
  });

  it("persists a FAILED agent outcome with error metadata", async () => {
    const executionLedger: ExecutionLedger = {
      toolCallRecords: [],
      mutationRecords: [],
      validationRecords: [],
    };

    await persistAgentTaskOutcome({
      prompt: "Do the impossible thing",
      session: makeSession(),
      sessionStatus: "FAILED",
      taskStartTime: new Date("2026-04-20T10:00:00.000Z").getTime(),
      completionTime: null,
      touchedFiles: [],
      executionLedger,
      verifyRetries: 0,
      autonomyVerifyRoundsUsed: 0,
      confabulationNudges: 1,
      modelRoundTrips: 1,
    });

    expect(mockRecordTaskOutcome).toHaveBeenCalledTimes(1);
    expect(mockRecordTaskOutcome.mock.calls[0]?.[0]).toMatchObject({
      command: "agent",
      taskDescription: "Do the impossible thing",
      success: false,
      error: "agent loop failed before reaching a valid completion state",
      metadata: expect.objectContaining({
        status: "FAILED",
        confabulationNudges: 1,
      }),
    });
  });
});
