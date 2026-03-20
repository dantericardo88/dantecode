import { describe, it, expect } from "vitest";
import { 
  RuntimeTaskPacketSchema, 
  RuntimeEventSchema, 
  CheckpointSchema, 
  RuntimeVerificationReportSchema 
} from "./index.js";
import { randomUUID } from "node:crypto";

describe("Runtime Spine Contracts", () => {
  it("should validate a valid research task packet", () => {
    const packet = {
      id: randomUUID(),
      kind: "research",
      objective: "Research DanteCode architecture",
      inputs: {
        query: "DanteCode architecture overview"
      }
    };
    
    const result = RuntimeTaskPacketSchema.safeParse(packet);
    expect(result.success).toBe(true);
  });

  it("should validate a valid runtime event", () => {
    const event = {
      kind: "research.search.completed",
      taskId: randomUUID(),
      payload: {
        resultsCount: 10
      }
    };
    
    const result = RuntimeEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it("should validate a checkpoint with nested state", () => {
    const checkpoint = {
      id: randomUUID(),
      task: {
        id: randomUUID(),
        kind: "subagent-task",
        objective: "Fix bug in core"
      },
      progress: "completed 1 of 2 steps",
      state: {
        currentFile: "src/index.ts"
      }
    };
    
    const result = CheckpointSchema.safeParse(checkpoint);
    expect(result.success).toBe(true);
  });

  it("should validate a verification report with evidence", () => {
    const report = {
      taskId: randomUUID(),
      passed: true,
      overallScore: 0.95,
      gates: [
        { name: "faithfulness", status: "pass", score: 0.98 }
      ],
      evidenceCount: 1,
      sources: [
        { url: "https://example.com/doc", title: "Reference Doc" }
      ]
    };
    
    const result = RuntimeVerificationReportSchema.safeParse(report);
    expect(result.success).toBe(true);
  });
});
