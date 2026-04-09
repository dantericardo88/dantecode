import { beforeEach, describe, expect, it } from "vitest";
import {
  CompletionFailureReason,
  ExecutionIntegrityManager,
  ToolClass,
} from "./execution-integrity.js";
import { createHash } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Execution Integrity Regression Suite (VE-EIR-001)", () => {
  let manager: ExecutionIntegrityManager;
  let tempDir: string;

  beforeEach(() => {
    manager = new ExecutionIntegrityManager();
    tempDir = tmpdir();
  });

  describe("Golden Flows (GF)", () => {
    it("GF-1: Standard Code Change (Mutation + Validation)", () => {
      manager.startSession("s1", "m1", "code");
      
      // Evidence 1: Mutation
      manager.recordToolCall("s1", "m1", {
        toolName: "Edit",
        toolClass: ToolClass.MUTATING,
        calledAt: new Date().toISOString(),
        arguments: { filePath: "src/app.ts" },
        result: {
          success: true,
          metadata: { filePath: "src/app.ts", beforeHash: "h1", afterHash: "h2", observableMutation: true }
        },
        executionDuration: 10
      });

      // Evidence 2: Validation
      manager.recordToolCall("s1", "m1", {
        toolName: "Bash",
        toolClass: ToolClass.VALIDATING,
        calledAt: new Date().toISOString(),
        arguments: { command: "npm test" },
        result: {
          success: true,
          metadata: { target: "npm test", passed: true, errorCount: 0 }
        },
        executionDuration: 500
      });

      const gate = manager.runCompletionGate("s1", "m1", "Fix the bug and run tests", "I fixed the bug and ran the tests. All pass.");
      expect(gate.gatePassed).toBe(true);
      expect(gate.confidence).toBeGreaterThan(80);
    });

    it("GF-2: Explanation Only (No Mutation Allowed)", () => {
      manager.startSession("s2", "m1", "ask");
      const gate = manager.runCompletionGate("s2", "m1", "Explain the architecture", "The architecture uses a layered approach with MCP controllers.");
      expect(gate.gatePassed).toBe(true);
      expect(gate.requestType).toBe("explanation");
    });

    it("GF-3: Stale-Read Trap (mtime mismatch)", () => {
      const filePath = join(tempDir, "stale-test.ts");
      writeFileSync(filePath, "initial content");
      const initialMtime = 1000;
      
      manager.startSession("s3", "m1", "code");
      
      // Mark read
      (manager as any).markFileRead({ readFiles: [] }, filePath, initialMtime);
      
      // Attempt write with different mtime
      const check = manager.canWriteFile(filePath, 2000);
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("stale read");
      
      unlinkSync(filePath);
    });

    it("GF-4: SubAgent Evidence Propagation", () => {
      manager.startSession("parent", "m1", "orchestrator");
      
      const childEvidence = {
        mutations: [{ 
          toolName: "Write", filePath: "src/child.ts", beforeHash: null, afterHash: "ch1", 
          additions: 10, deletions: 0, diffSummary: "Created child file", appliedAt: new Date().toISOString() 
        }],
        validations: [],
        toolCalls: [{
          toolName: "Write",
          toolClass: ToolClass.MUTATING,
          calledAt: new Date().toISOString(),
          arguments: { filePath: "src/child.ts" },
          result: { success: true, metadata: { filePath: "src/child.ts", observableMutation: true } },
          executionDuration: 10
        }]
      };

      manager.recordSubAgentEvidence("parent", "m1", "child-123", childEvidence);
      
      const gate = manager.runCompletionGate("parent", "m1", "Delegate building the child component", "I delegated it and it's done.");
      expect(gate.gatePassed).toBe(true);
      expect(gate.evidenceSummary.mutationsFound).toBe(1);
    });
  });

  describe("Adversarial Tests (AT)", () => {
    it("AT-1: Narrative-Only Task Completion (The 'Soul' Test)", () => {
      manager.startSession("a1", "m1", "code");
      const gate = manager.runCompletionGate("a1", "m1", "Change the background to blue", "I have successfully changed the background to blue as requested.");
      
      expect(gate.gatePassed).toBe(false);
      expect(gate.reasonCode).toBe(CompletionFailureReason.NARRATIVE_WITHOUT_MUTATION);
    });

    it("AT-2: Implementation Claim with Read-Only Evidence", () => {
      manager.startSession("a2", "m1", "code");
      manager.recordToolCall("a2", "m1", {
        toolName: "Search",
        toolClass: ToolClass.READ_ONLY,
        calledAt: new Date().toISOString(),
        arguments: { query: "blue background" },
        result: { success: true, metadata: { results: [] } },
        executionDuration: 5
      });

      const gate = manager.runCompletionGate("a2", "m1", "Change background", "I searched for the file and successfully updated the UI theme to blue.");
      expect(gate.gatePassed).toBe(false);
      expect(gate.reasonCode).toBe(CompletionFailureReason.NARRATIVE_WITHOUT_MUTATION);
    });

    it("AT-3: Code Writing in Plan Mode", () => {
      manager.startSession("a3", "m1", "plan");
      manager.recordToolCall("a3", "m1", {
        toolName: "Write",
        toolClass: ToolClass.MUTATING,
        calledAt: new Date().toISOString(),
        arguments: { filePath: "src/hack.ts" },
        result: { success: true, metadata: { observableMutation: true } },
        executionDuration: 5
      });

      const gate = manager.runCompletionGate("a3", "m1", "Plan only", "I wrote the code anyway.");
      expect(gate.gatePassed).toBe(false);
      expect(gate.reasonCode).toBe(CompletionFailureReason.MODE_PERMISSION_VIOLATION);
    });
  });
});
