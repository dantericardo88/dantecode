import { describe, expect, it, vi } from "vitest";

import type { ExecutionLedger } from "@dantecode/config-types";

import { recordExecutionEvidence } from "./verification-hooks.js";
import type { ToolResult } from "./tools.js";

function makeLedger(): ExecutionLedger {
  return {
    toolCallRecords: [],
    mutationRecords: [],
    validationRecords: [],
  };
}

function makeToolResult(overrides?: Partial<ToolResult>): ToolResult {
  return {
    toolName: "Write",
    content: "ok",
    isError: false,
    ok: true,
    mutationRecords: [],
    validationRecords: [],
    ...overrides,
  };
}

describe("verification-hooks", () => {
  it("records tool calls, mutations, and validations into the execution ledger", async () => {
    const ledger = makeLedger();
    const persist = {
      recordToolCall: vi.fn().mockResolvedValue(undefined),
      recordMutation: vi.fn().mockResolvedValue(undefined),
      recordValidation: vi.fn().mockResolvedValue(undefined),
    };

    const firstMutationTime = await recordExecutionEvidence(
      {
        id: "tool-1",
        name: "Write",
        input: { file_path: "src/example.ts" },
      },
      makeToolResult({
        mutationRecords: [
          {
            id: "mutation-1",
            toolCallId: "stale-id",
            path: "src/example.ts",
            beforeHash: "before",
            afterHash: "after",
            diffSummary: "+1 -0",
            lineCount: 1,
            additions: 1,
            deletions: 0,
            timestamp: "2026-04-16T00:00:00.000Z",
          },
        ],
        validationRecords: [
          {
            id: "validation-1",
            toolCallId: "stale-id",
            type: "test",
            command: "npm test",
            exitCode: 0,
            output: "ok",
            passed: true,
            timestamp: "2026-04-16T00:00:00.000Z",
          },
        ],
      }),
      {
        executionLedger: ledger,
        firstMutationTime: null,
        projectRoot: "/tmp/project",
        sessionId: "session-1",
        modelLabel: "openai/gpt-test",
        now: () => 1234,
        timestamp: () => "2026-04-16T00:00:00.000Z",
      },
      persist,
    );

    expect(firstMutationTime).toBe(1234);
    expect(ledger.toolCallRecords).toHaveLength(1);
    expect(ledger.toolCallRecords[0]).toMatchObject({
      id: "tool-1",
      toolName: "Write",
    });
    expect(ledger.mutationRecords).toHaveLength(1);
    expect(ledger.mutationRecords[0]?.toolCallId).toBe("tool-1");
    expect(ledger.validationRecords).toHaveLength(1);
    expect(ledger.validationRecords[0]?.toolCallId).toBe("tool-1");
    expect(persist.recordToolCall).toHaveBeenCalledTimes(1);
    expect(persist.recordMutation).toHaveBeenCalledTimes(1);
    expect(persist.recordValidation).toHaveBeenCalledTimes(1);
  });

  it("preserves an existing firstMutationTime when later tool results also mutate files", async () => {
    const ledger = makeLedger();
    const persist = {
      recordToolCall: vi.fn().mockResolvedValue(undefined),
      recordMutation: vi.fn().mockResolvedValue(undefined),
      recordValidation: vi.fn().mockResolvedValue(undefined),
    };

    const firstMutationTime = await recordExecutionEvidence(
      {
        id: "tool-2",
        name: "Edit",
        input: { file_path: "src/example.ts" },
      },
      makeToolResult({
        toolName: "Edit",
        mutationRecords: [
          {
            id: "mutation-2",
            toolCallId: "stale-id",
            path: "src/example.ts",
            beforeHash: "before",
            afterHash: "after",
            diffSummary: "+1 -1",
            lineCount: 2,
            additions: 1,
            deletions: 1,
            timestamp: "2026-04-16T00:00:01.000Z",
          },
        ],
      }),
      {
        executionLedger: ledger,
        firstMutationTime: 777,
        projectRoot: "/tmp/project",
        sessionId: "session-1",
        modelLabel: "openai/gpt-test",
        now: () => 9999,
        timestamp: () => "2026-04-16T00:00:01.000Z",
      },
      persist,
    );

    expect(firstMutationTime).toBe(777);
    expect(ledger.mutationRecords[0]?.toolCallId).toBe("tool-2");
  });
});
