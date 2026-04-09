// ============================================================================
// Execution Truth Persistence Tests (M8/M9)
// Verifies that the full evidence bundle is written with all 6 files.
// ============================================================================

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { persistExecutionEvidenceBundle, type ExecutionTruthPayload } from "./execution-truth.js";
import type { ExecutionLedger } from "./execution-integrity.js";

describe("M8: Evidence Persistence Completion", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `dante-test-${randomUUID()}`);
    mkdirSync(tmpRoot, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpRoot, { recursive: true, force: true });
    } catch { /* ignore cleanup errors */ }
  });

  function makeLedger(): ExecutionLedger {
    return {
      sessionId: "test-session",
      messageId: "msg-1",
      mode: "code",
      toolCalls: [
        {
          toolName: "Read",
          toolClass: "read_only" as any,
          calledAt: new Date().toISOString(),
          arguments: { file_path: "src/index.ts" },
          result: { success: true, metadata: { filePath: "src/index.ts" } },
          executionDuration: 5,
        },
        {
          toolName: "Edit",
          toolClass: "mutating" as any,
          calledAt: new Date().toISOString(),
          arguments: { file_path: "src/index.ts" },
          result: {
            success: true,
            metadata: {
              filePath: "src/index.ts",
              beforeHash: "abc",
              afterHash: "def",
              observableMutation: true,
            },
          },
          executionDuration: 10,
        },
      ],
      mutations: [
        {
          toolName: "Edit",
          filePath: "src/index.ts",
          beforeHash: "abc",
          afterHash: "def",
          additions: 3,
          deletions: 1,
          diffSummary: "Updated export",
          appliedAt: new Date().toISOString(),
        },
      ],
      validations: [
        {
          validationType: "test",
          toolName: "Bash",
          target: "npm test",
          passed: true,
          errorCount: 0,
          warningCount: 0,
          executedAt: new Date().toISOString(),
        },
      ],
      claimedArtifacts: [],
      readFiles: ["src/index.ts"],
      fileLocks: {},
      completionStatus: {
        canComplete: true,
        missingEvidence: [],
        summary: "Approved",
      },
    };
  }

  function makePayload(): ExecutionTruthPayload {
    return {
      mode: "code",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      changedFiles: ["src/index.ts"],
      mutationCount: 1,
      validationCount: 1,
      gateStatus: "passed",
      lastVerifiedAt: new Date().toISOString(),
      roundCount: 3,
      totalToolCalls: 2,
      requestType: "code_change",
      promptPreview: "Fix the export in index.ts",
      sessionId: "test-session",
      timestamp: new Date().toISOString(),
    };
  }

  it("writes all 6 evidence files", async () => {
    const ledger = makeLedger();
    const payload = makePayload();

    await persistExecutionEvidenceBundle(tmpRoot, ledger, payload);

    const sessionDir = join(tmpRoot, ".dantecode", "execution-integrity", "test-session");
    expect(existsSync(join(sessionDir, "summary.json"))).toBe(true);
    expect(existsSync(join(sessionDir, "mutations.json"))).toBe(true);
    expect(existsSync(join(sessionDir, "validations.json"))).toBe(true);
    expect(existsSync(join(sessionDir, "tool-calls.json"))).toBe(true);
    expect(existsSync(join(sessionDir, "gate-results.json"))).toBe(true);
    expect(existsSync(join(sessionDir, "read-files.json"))).toBe(true);
  });

  it("tool-calls.json contains expected tool names", async () => {
    const ledger = makeLedger();
    const payload = makePayload();

    await persistExecutionEvidenceBundle(tmpRoot, ledger, payload);

    const sessionDir = join(tmpRoot, ".dantecode", "execution-integrity", "test-session");
    const toolCalls = JSON.parse(readFileSync(join(sessionDir, "tool-calls.json"), "utf-8"));
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].toolName).toBe("Read");
    expect(toolCalls[1].toolName).toBe("Edit");
  });

  it("validations.json contains test results", async () => {
    const ledger = makeLedger();
    const payload = makePayload();

    await persistExecutionEvidenceBundle(tmpRoot, ledger, payload);

    const sessionDir = join(tmpRoot, ".dantecode", "execution-integrity", "test-session");
    const validations = JSON.parse(readFileSync(join(sessionDir, "validations.json"), "utf-8"));
    expect(validations).toHaveLength(1);
    expect(validations[0].validationType).toBe("test");
    expect(validations[0].passed).toBe(true);
  });

  it("read-files.json contains read file entries", async () => {
    const ledger = makeLedger();
    const payload = makePayload();

    await persistExecutionEvidenceBundle(tmpRoot, ledger, payload);

    const sessionDir = join(tmpRoot, ".dantecode", "execution-integrity", "test-session");
    const readFiles = JSON.parse(readFileSync(join(sessionDir, "read-files.json"), "utf-8"));
    expect(readFiles).toHaveLength(1);
    expect(readFiles[0].filePath).toBe("src/index.ts");
  });

  it("summary.json includes M8 extended fields", async () => {
    const ledger = makeLedger();
    const payload = makePayload();

    await persistExecutionEvidenceBundle(tmpRoot, ledger, payload);

    const sessionDir = join(tmpRoot, ".dantecode", "execution-integrity", "test-session");
    const summary = JSON.parse(readFileSync(join(sessionDir, "summary.json"), "utf-8"));
    expect(summary.roundCount).toBe(3);
    expect(summary.totalToolCalls).toBe(2);
    expect(summary.requestType).toBe("code_change");
    expect(summary.promptPreview).toBe("Fix the export in index.ts");
    expect(summary.sessionId).toBe("test-session");
  });

  it("truncates large args in tool-calls.json", async () => {
    const ledger = makeLedger();
    ledger.toolCalls[1]!.arguments = {
      file_path: "src/index.ts",
      content: "x".repeat(500), // Large content
    };
    const payload = makePayload();

    await persistExecutionEvidenceBundle(tmpRoot, ledger, payload);

    const sessionDir = join(tmpRoot, ".dantecode", "execution-integrity", "test-session");
    const toolCalls = JSON.parse(readFileSync(join(sessionDir, "tool-calls.json"), "utf-8"));
    const editCall = toolCalls.find((tc: any) => tc.toolName === "Edit");
    expect(editCall.arguments.content.length).toBeLessThanOrEqual(203); // 200 + "..."
  });
});
