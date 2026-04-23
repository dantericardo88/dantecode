import { describe, expect, it } from "vitest";

import {
  classifyRequest,
  evaluateCompletionGate,
  type ExecutionLedgerLike,
} from "./completion-gate.js";

function makeLedger(overrides?: Partial<ExecutionLedgerLike>): ExecutionLedgerLike {
  return {
    toolCallRecords: [],
    mutationRecords: [],
    validationRecords: [],
    ...overrides,
  };
}

describe("completion-gate", () => {
  describe("classifyRequest", () => {
    it("classifies explanation prompts as non-mutating", () => {
      expect(classifyRequest("explain how the parser works")).toBe("non_mutating");
    });

    it("keeps implementation-style prompts mutating", () => {
      expect(classifyRequest("update the code to use TypeScript")).toBe("mutating");
    });

    it("detects validation-only prompts", () => {
      expect(classifyRequest("verify the parser without changes")).toBe("validation_only");
    });

    it("detects orchestration prompts", () => {
      expect(classifyRequest("plan and coordinate several steps for this workflow")).toBe(
        "orchestration",
      );
    });
  });

  describe("evaluateCompletionGate", () => {
    it("passes non-mutating requests without execution evidence", () => {
      expect(evaluateCompletionGate(makeLedger(), "non_mutating").ok).toBe(true);
    });

    it("fails mutating requests without mutation records", () => {
      expect(evaluateCompletionGate(makeLedger(), "mutating")).toMatchObject({
        ok: false,
        reasonCode: "mutation-requested-but-no-files-changed",
      });
    });

    it("passes mutating requests with a mutation record", () => {
      expect(
        evaluateCompletionGate(
          makeLedger({
            mutationRecords: [
              {
                id: "mutation-1",
                toolCallId: "tool-1",
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
          }),
          "mutating",
        ).ok,
      ).toBe(true);
    });

    it("fails validation-only requests without validation records", () => {
      expect(evaluateCompletionGate(makeLedger(), "validation_only")).toMatchObject({
        ok: false,
        reasonCode: "claimed-validation-not-run",
      });
    });

    it("passes validation-only requests with a validation record", () => {
      expect(
        evaluateCompletionGate(
          makeLedger({
            validationRecords: [
              {
                id: "validation-1",
                type: "test",
                command: "npm test",
                exitCode: 0,
                output: "ok",
                passed: true,
                timestamp: "2026-04-16T00:00:00.000Z",
              },
            ],
          }),
          "validation_only",
        ).ok,
      ).toBe(true);
    });

    it("fails orchestration requests without any evidence", () => {
      expect(evaluateCompletionGate(makeLedger(), "orchestration")).toMatchObject({
        ok: false,
        reasonCode: "orchestration-without-evidence",
      });
    });

    it("passes orchestration requests with validation evidence", () => {
      expect(
        evaluateCompletionGate(
          makeLedger({
            validationRecords: [
              {
                id: "validation-1",
                type: "build",
                command: "npm run build",
                exitCode: 0,
                output: "built",
                passed: true,
                timestamp: "2026-04-16T00:00:00.000Z",
              },
            ],
          }),
          "orchestration",
        ).ok,
      ).toBe(true);
    });
  });
});
