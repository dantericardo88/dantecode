import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

// ─── Imports — all Zod schemas under test ────────────────────────────────────

import {
  ApplyReceiptSchema,
  CheckpointSchema,
  CheckpointWorkspaceContextSchema,
  DurableExecutionRunConfigSchema,
} from "./checkpoint-types.js";

import {
  FearSetTriggerChannelSchema,
  FearSetTriggerSchema,
  FearSetColumnNameSchema,
  FearSetRobustnessScoreSchema,
} from "./fearset-types.js";

import {
  ExecutionRequestSchema,
  SandboxAuditRefSchema,
} from "./sandbox-types.js";

import {
  RuntimeTaskPacketSchema,
} from "./task-packets.js";

import {
  SkillSchema,
  UpdateOperationSchema,
  SkillbookGateDecisionSchema,
} from "./skillbook-types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

// ─── ApplyReceiptSchema ───────────────────────────────────────────────────────

describe("ApplyReceiptSchema", () => {
  it("parses a valid apply receipt", () => {
    const data = {
      stepId: "step-1",
      state: "success",
      affectedFiles: ["src/foo.ts"],
      appliedAt: NOW,
    };
    expect(() => ApplyReceiptSchema.parse(data)).not.toThrow();
  });

  it("rejects unknown state value", () => {
    const data = { stepId: "s", state: "unknown-state", affectedFiles: [] };
    const result = ApplyReceiptSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it("defaults affectedFiles to []", () => {
    const result = ApplyReceiptSchema.parse({ stepId: "s", state: "skipped" });
    expect(result.affectedFiles).toEqual([]);
  });

  it("rejects missing stepId", () => {
    const result = ApplyReceiptSchema.safeParse({ state: "success" });
    expect(result.success).toBe(false);
  });
});

// ─── DurableExecutionRunConfigSchema ─────────────────────────────────────────

describe("DurableExecutionRunConfigSchema", () => {
  it("parses valid config", () => {
    expect(() => DurableExecutionRunConfigSchema.parse({ checkpointEveryN: 5, maxRetries: 3 })).not.toThrow();
  });

  it("rejects checkpointEveryN < 1", () => {
    expect(DurableExecutionRunConfigSchema.safeParse({ checkpointEveryN: 0, maxRetries: 1 }).success).toBe(false);
  });

  it("rejects maxRetries < 0", () => {
    expect(DurableExecutionRunConfigSchema.safeParse({ checkpointEveryN: 1, maxRetries: -1 }).success).toBe(false);
  });
});

// ─── CheckpointWorkspaceContextSchema ────────────────────────────────────────

describe("CheckpointWorkspaceContextSchema", () => {
  it("parses valid workspace context", () => {
    const data = {
      projectRoot: "/tmp/project",
      workspaceRoot: "/tmp",
      workspaceIsRepoRoot: true,
      installContextKind: "repo_checkout",
    };
    expect(() => CheckpointWorkspaceContextSchema.parse(data)).not.toThrow();
  });

  it("rejects unknown installContextKind", () => {
    const data = {
      projectRoot: "/tmp",
      workspaceRoot: "/tmp",
      workspaceIsRepoRoot: false,
      installContextKind: "unknown_kind",
    };
    expect(CheckpointWorkspaceContextSchema.safeParse(data).success).toBe(false);
  });
});

// ─── CheckpointSchema ────────────────────────────────────────────────────────

describe("CheckpointSchema", () => {
  function validCheckpoint() {
    return {
      id: randomUUID(),
      task: {
        id: randomUUID(),
        kind: "research",
        objective: "Research the TypeScript ecosystem",
        context: {},
        createdAt: NOW,
      },
      progress: "2/5 steps",
      retries: 0,
      state: {},
      artifacts: [],
      timestamp: NOW,
    };
  }

  it("parses a valid checkpoint", () => {
    expect(() => CheckpointSchema.parse(validCheckpoint())).not.toThrow();
  });

  it("rejects missing id", () => {
    const data = validCheckpoint();
    // @ts-expect-error intentional
    delete data.id;
    expect(CheckpointSchema.safeParse(data).success).toBe(false);
  });

  it("rejects non-uuid id", () => {
    const data = { ...validCheckpoint(), id: "not-a-uuid" };
    expect(CheckpointSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing progress field", () => {
    const data = validCheckpoint();
    // @ts-expect-error intentional
    delete data.progress;
    expect(CheckpointSchema.safeParse(data).success).toBe(false);
  });

  it("defaults retries to 0", () => {
    const data = validCheckpoint();
    // @ts-expect-error intentional
    delete data.retries;
    const result = CheckpointSchema.parse(data);
    expect(result.retries).toBe(0);
  });

  it("defaults artifacts to []", () => {
    const data = validCheckpoint();
    // @ts-expect-error intentional
    delete data.artifacts;
    const result = CheckpointSchema.parse(data);
    expect(result.artifacts).toEqual([]);
  });
});

// ─── FearSet schemas ──────────────────────────────────────────────────────────

describe("FearSetTriggerChannelSchema", () => {
  it("accepts all valid channels", () => {
    const channels = ["explicit-user", "long-horizon", "destructive", "weak-robustness", "high-risk-council", "repeated-failure", "policy"] as const;
    for (const ch of channels) {
      expect(() => FearSetTriggerChannelSchema.parse(ch)).not.toThrow();
    }
  });

  it("rejects unknown channel", () => {
    expect(FearSetTriggerChannelSchema.safeParse("unknown-channel").success).toBe(false);
  });
});

describe("FearSetTriggerSchema", () => {
  it("parses a minimal trigger", () => {
    expect(() => FearSetTriggerSchema.parse({ channel: "explicit-user" })).not.toThrow();
  });

  it("defaults at to ISO string", () => {
    const result = FearSetTriggerSchema.parse({ channel: "policy" });
    expect(typeof result.at).toBe("string");
    expect(() => new Date(result.at)).not.toThrow();
  });
});

describe("FearSetColumnNameSchema", () => {
  it("accepts all column names", () => {
    for (const col of ["define", "prevent", "repair", "benefits", "inaction"] as const) {
      expect(() => FearSetColumnNameSchema.parse(col)).not.toThrow();
    }
  });

  it("rejects unknown column name", () => {
    expect(FearSetColumnNameSchema.safeParse("attack").success).toBe(false);
  });
});

describe("FearSetRobustnessScoreSchema", () => {
  it("parses a valid robustness score", () => {
    const data = {
      overall: 0.8,
      hasSimulationEvidence: true,
      gateDecision: "pass",
      justification: "Strong mitigation plans",
    };
    expect(() => FearSetRobustnessScoreSchema.parse(data)).not.toThrow();
  });

  it("rejects overall < 0", () => {
    expect(FearSetRobustnessScoreSchema.safeParse({ overall: -0.1, gateDecision: "pass", justification: "x" }).success).toBe(false);
  });

  it("rejects overall > 1", () => {
    expect(FearSetRobustnessScoreSchema.safeParse({ overall: 1.1, gateDecision: "pass", justification: "x" }).success).toBe(false);
  });

  it("rejects unknown gateDecision", () => {
    expect(FearSetRobustnessScoreSchema.safeParse({ overall: 0.5, gateDecision: "unknown", justification: "x" }).success).toBe(false);
  });
});

// ─── Sandbox schemas ──────────────────────────────────────────────────────────

describe("ExecutionRequestSchema", () => {
  function validRequest() {
    return {
      id: randomUUID(),
      command: "echo hello",
      args: [],
      env: {},
      taskType: "bash",
      actor: "agent",
      requestedMode: "auto",
      timeoutMs: 30_000,
    };
  }

  it("parses a valid execution request", () => {
    expect(() => ExecutionRequestSchema.parse(validRequest())).not.toThrow();
  });

  it("rejects negative timeoutMs", () => {
    expect(ExecutionRequestSchema.safeParse({ ...validRequest(), timeoutMs: -1 }).success).toBe(false);
  });

  it("rejects unknown requestedMode", () => {
    expect(ExecutionRequestSchema.safeParse({ ...validRequest(), requestedMode: "magic" }).success).toBe(false);
  });

  it("defaults taskType to 'bash'", () => {
    const data = validRequest();
    // @ts-expect-error intentional
    delete data.taskType;
    const result = ExecutionRequestSchema.parse(data);
    expect(result.taskType).toBe("bash");
  });
});

describe("SandboxAuditRefSchema", () => {
  it("parses minimal audit ref (all optional fields omitted)", () => {
    const result = SandboxAuditRefSchema.parse({});
    expect(result.violationCount).toBe(0);
    expect(result.hostEscapeCount).toBe(0);
    expect(result.auditRecordIds).toEqual([]);
  });

  it("rejects negative violationCount", () => {
    expect(SandboxAuditRefSchema.safeParse({ violationCount: -1 }).success).toBe(false);
  });

  it("rejects non-uuid in auditRecordIds", () => {
    expect(SandboxAuditRefSchema.safeParse({ auditRecordIds: ["not-a-uuid"] }).success).toBe(false);
  });
});

// ─── RuntimeTaskPacketSchema ──────────────────────────────────────────────────

describe("RuntimeTaskPacketSchema", () => {
  it("parses a valid task packet", () => {
    const data = {
      id: randomUUID(),
      kind: "research",
      objective: "Research the market",
      context: {},
      createdAt: NOW,
    };
    expect(() => RuntimeTaskPacketSchema.parse(data)).not.toThrow();
  });

  it("rejects unknown kind", () => {
    const data = { id: randomUUID(), kind: "unknown-kind", objective: "X" };
    expect(RuntimeTaskPacketSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing objective", () => {
    const data = { id: randomUUID(), kind: "research", context: {} };
    expect(RuntimeTaskPacketSchema.safeParse(data).success).toBe(false);
  });

  it("defaults context to {}", () => {
    const result = RuntimeTaskPacketSchema.parse({ id: randomUUID(), kind: "synthesis", objective: "Synthesize results" });
    expect(result.context).toEqual({});
  });

  it("rejects invalid URL in inputs.url", () => {
    const data = { id: randomUUID(), kind: "fetch-extract", objective: "Fetch page", inputs: { url: "not-a-url" } };
    expect(RuntimeTaskPacketSchema.safeParse(data).success).toBe(false);
  });
});

// ─── SkillSchema ──────────────────────────────────────────────────────────────

describe("SkillSchema", () => {
  it("parses a valid skill", () => {
    const data = {
      id: "skill-001",
      title: "Always check types",
      content: "Before running, verify type safety",
      section: "TypeScript",
      createdAt: NOW,
      updatedAt: NOW,
    };
    expect(() => SkillSchema.parse(data)).not.toThrow();
  });

  it("rejects trustScore > 1", () => {
    const data = { id: "s", title: "t", content: "c", section: "s", createdAt: NOW, updatedAt: NOW, trustScore: 1.5 };
    expect(SkillSchema.safeParse(data).success).toBe(false);
  });

  it("rejects trustScore < 0", () => {
    const data = { id: "s", title: "t", content: "c", section: "s", createdAt: NOW, updatedAt: NOW, trustScore: -0.1 };
    expect(SkillSchema.safeParse(data).success).toBe(false);
  });

  it("rejects missing id", () => {
    const data = { title: "t", content: "c", section: "s", createdAt: NOW, updatedAt: NOW };
    expect(SkillSchema.safeParse(data).success).toBe(false);
  });
});

describe("UpdateOperationSchema", () => {
  it("parses valid add operation", () => {
    expect(() => UpdateOperationSchema.parse({ action: "add", rationale: "new skill" })).not.toThrow();
  });

  it("rejects unknown action", () => {
    expect(UpdateOperationSchema.safeParse({ action: "zap", rationale: "x" }).success).toBe(false);
  });

  it("rejects missing rationale", () => {
    expect(UpdateOperationSchema.safeParse({ action: "add" }).success).toBe(false);
  });
});

describe("SkillbookGateDecisionSchema", () => {
  it("accepts all valid values", () => {
    for (const v of ["pass", "fail", "review-required"] as const) {
      expect(() => SkillbookGateDecisionSchema.parse(v)).not.toThrow();
    }
  });

  it("rejects unknown value", () => {
    expect(SkillbookGateDecisionSchema.safeParse("maybe").success).toBe(false);
  });
});
