// ============================================================================
// DanteCode Execution Integrity Tests
// These tests define the fail-closed runtime behavior for implementation work.
// ============================================================================

import { beforeEach, describe, expect, it } from "vitest";
import {
  CompletionFailureReason,
  ExecutionIntegrityManager,
  ToolClass,
} from "./execution-integrity.js";

describe("Execution Integrity System", () => {
  let manager: ExecutionIntegrityManager;

  beforeEach(() => {
    manager = new ExecutionIntegrityManager();
  });

  describe("request classification and completion gating", () => {
    it("allows explanation requests without mutations", () => {
      manager.startSession("session-a", "msg-1", "ask");

      const gateResult = manager.runCompletionGate(
        "session-a",
        "msg-1",
        "Explain how this helper works",
        "This helper reads the config, normalizes the path, and returns the parsed value.",
      );

      expect(gateResult.gatePassed).toBe(true);
      expect(gateResult.requestType).toBe("explanation");
      expect(gateResult.evidenceSummary.mutationsFound).toBe(0);
    });

    it("blocks implementation requests with no observable mutations even without a narrative claim", () => {
      manager.startSession("session-b", "msg-1", "code");

      const gateResult = manager.runCompletionGate(
        "session-b",
        "msg-1",
        "Implement the new execution ledger summary",
        "I investigated the files and outlined the approach I would take next.",
      );

      expect(gateResult.gatePassed).toBe(false);
      expect(gateResult.reasonCode).toBe(
        CompletionFailureReason.MUTATION_REQUESTED_BUT_NO_FILES_CHANGED,
      );
      expect(gateResult.missingEvidence).toContain(
        "Implementation was requested but no observable file mutations were recorded",
      );
    });

    it("blocks assistant implementation claims when no mutating tool evidence exists", () => {
      manager.startSession("session-c", "msg-1", "code");

      const gateResult = manager.runCompletionGate(
        "session-c",
        "msg-1",
        "Fix the completion gate",
        "I have successfully fixed the completion gate and updated the runtime.",
      );

      expect(gateResult.gatePassed).toBe(false);
      expect(gateResult.reasonCode).toBe(CompletionFailureReason.NARRATIVE_WITHOUT_MUTATION);
      expect(gateResult.missingEvidence).toContain(
        "Assistant claimed changes but no observable mutating tool execution was recorded",
      );
    });

    it("blocks claimed validation when no validation tool evidence exists", () => {
      manager.startSession("session-d", "msg-1", "code");
      manager.recordToolCall("session-d", "msg-1", {
        toolName: "Write",
        toolClass: ToolClass.MUTATING,
        calledAt: new Date().toISOString(),
        arguments: { file_path: "src/gate.ts" },
        result: {
          success: true,
          metadata: {
            filePath: "src/gate.ts",
            beforeHash: "before",
            afterHash: "after",
            additions: 12,
            deletions: 2,
            diffSummary: "Implemented gate fix",
            observableMutation: true,
          },
        },
        executionDuration: 10,
      });

      const gateResult = manager.runCompletionGate(
        "session-d",
        "msg-1",
        "Fix the gate and run tests",
        "I fixed the gate and all tests are passing now.",
      );

      expect(gateResult.gatePassed).toBe(false);
      expect(gateResult.reasonCode).toBe(CompletionFailureReason.CLAIMED_VALIDATION_NOT_RUN);
      expect(gateResult.missingEvidence).toContain(
        "Validation was requested or claimed but no validation records were captured",
      );
    });

    it("blocks plan mode when a mutating tool ran", () => {
      manager.startSession("session-e", "msg-1", "plan");
      manager.recordToolCall("session-e", "msg-1", {
        toolName: "Edit",
        toolClass: ToolClass.MUTATING,
        calledAt: new Date().toISOString(),
        arguments: { file_path: "src/plan.ts" },
        result: {
          success: true,
          metadata: {
            filePath: "src/plan.ts",
            beforeHash: "before",
            afterHash: "after",
            additions: 1,
            deletions: 0,
            diffSummary: "Plan mode should not mutate",
            observableMutation: true,
          },
        },
        executionDuration: 8,
      });

      const gateResult = manager.runCompletionGate(
        "session-e",
        "msg-1",
        "Plan the implementation only",
        "I outlined the plan and updated the source file.",
      );

      expect(gateResult.gatePassed).toBe(false);
      expect(gateResult.reasonCode).toBe(CompletionFailureReason.MODE_PERMISSION_VIOLATION);
    });
  });

  describe("tool evidence handling", () => {
    it("records observable mutations with metadata", () => {
      manager.startSession("session-f", "msg-1", "code");
      manager.recordToolCall("session-f", "msg-1", {
        toolName: "Edit",
        toolClass: ToolClass.MUTATING,
        calledAt: new Date().toISOString(),
        arguments: { file_path: "src/runtime.ts" },
        result: {
          success: true,
          metadata: {
            filePath: "src/runtime.ts",
            beforeHash: "abc123",
            afterHash: "def456",
            additions: 5,
            deletions: 3,
            diffSummary: "Updated runtime gate",
            observableMutation: true,
          },
        },
        executionDuration: 15,
      });

      const ledger = manager.getLedger("session-f", "msg-1");
      expect(ledger?.mutations).toHaveLength(1);
      expect(ledger?.mutations[0]).toMatchObject({
        toolName: "Edit",
        filePath: "src/runtime.ts",
        additions: 5,
        deletions: 3,
      });
    });

    it("does not record mutations when the tool reports no observable mutation", () => {
      manager.startSession("session-g", "msg-1", "code");
      manager.recordToolCall("session-g", "msg-1", {
        toolName: "Edit",
        toolClass: ToolClass.MUTATING,
        calledAt: new Date().toISOString(),
        arguments: { file_path: "src/runtime.ts" },
        result: {
          success: true,
          metadata: {
            filePath: "src/runtime.ts",
            observableMutation: false,
          },
        },
        executionDuration: 9,
      });

      const ledger = manager.getLedger("session-g", "msg-1");
      expect(ledger?.mutations).toHaveLength(0);

      const gateResult = manager.runCompletionGate(
        "session-g",
        "msg-1",
        "Update the runtime",
        "I updated the runtime successfully.",
      );

      expect(gateResult.gatePassed).toBe(false);
      expect(gateResult.reasonCode).toBe(CompletionFailureReason.NO_OBSERVABLE_MUTATION);
    });

    it("tracks read-only tool paths and allows writes only after a read", () => {
      manager.startSession("session-h", "msg-1", "code");

      expect(manager.canWriteFile("src/config.ts").allowed).toBe(false);

      manager.recordToolCall("session-h", "msg-1", {
        toolName: "Read",
        toolClass: ToolClass.READ_ONLY,
        calledAt: new Date().toISOString(),
        arguments: { file_path: "src/config.ts" },
        result: { success: true, metadata: { filePath: "src/config.ts" } },
        executionDuration: 3,
      });

      const ledger = manager.getLedger("session-h", "msg-1");
      expect(ledger?.readFiles).toContain("src/config.ts");
      expect(manager.canWriteFile("src/config.ts")).toEqual({ allowed: true });
    });

    it("passes code-change requests when both mutation and validation evidence exist", () => {
      manager.startSession("session-i", "msg-1", "debug");
      manager.recordToolCall("session-i", "msg-1", {
        toolName: "Edit",
        toolClass: ToolClass.MUTATING,
        calledAt: new Date().toISOString(),
        arguments: { file_path: "src/execution.ts" },
        result: {
          success: true,
          metadata: {
            filePath: "src/execution.ts",
            beforeHash: "before",
            afterHash: "after",
            additions: 4,
            deletions: 1,
            diffSummary: "Updated completion logic",
            observableMutation: true,
          },
        },
        executionDuration: 11,
      });
      manager.recordToolCall("session-i", "msg-1", {
        toolName: "Bash",
        toolClass: ToolClass.VALIDATING,
        calledAt: new Date().toISOString(),
        arguments: { command: "npm test" },
        result: {
          success: true,
          metadata: {
            target: "npm test",
            output: "3 tests passed",
          },
        },
        executionDuration: 1200,
      });

      const gateResult = manager.runCompletionGate(
        "session-i",
        "msg-1",
        "Fix the runtime and run tests",
        "I fixed the runtime and ran the tests. All tests passed.",
      );

      expect(gateResult.gatePassed).toBe(true);
      expect(gateResult.evidenceSummary.mutationsFound).toBe(1);
      expect(gateResult.evidenceSummary.validationsRun).toBe(1);
    });
  });
});
