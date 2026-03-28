import { describe, it, expect, vi } from "vitest";
import { executeChain, resolveInput, resolveOutputRef, handleGateFailure } from "./skill-chain.js";
import type { SkillChain, ChainStepResult, SkillOutputRef } from "./skill-chain.js";
import type { DanteSkill } from "./dante-skill.js";
import type { SkillRunContext } from "./skill-run-context.js";
import type { SkillRunResult } from "./skill-run-result.js";

// Test fixtures
const mockSkill: DanteSkill = {
  name: "test-skill",
  description: "Test skill",
  sourceType: "native",
  sourceRef: "test",
  license: "MIT",
  instructions: "Test instructions",
  provenance: {
    sourceType: "native",
    sourceRef: "test",
    license: "MIT",
    importedAt: new Date().toISOString(),
  },
};

const mockContext: SkillRunContext = {
  skillName: "test-skill",
  mode: "apply",
  projectRoot: "/test",
  policy: {
    allowedTools: [],
    maxFileWrites: 50,
    allowNetwork: false,
    sandboxMode: "host",
  },
};

const mockSuccessResult: SkillRunResult = {
  runId: "sr_test123",
  skillName: "test-skill",
  sourceType: "native",
  mode: "apply",
  state: "verified",
  filesTouched: ["/test/file.ts"],
  commandsRun: ["echo test"],
  verificationOutcome: "pass",
  plainLanguageSummary: "Test completed successfully",
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
};

const mockFailedResult: SkillRunResult = {
  runId: "sr_test456",
  skillName: "test-skill",
  sourceType: "native",
  mode: "apply",
  state: "failed",
  filesTouched: [],
  commandsRun: [],
  verificationOutcome: "fail",
  plainLanguageSummary: "Test failed",
  failureReason: "SKILL-001: Test error",
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString(),
};

describe("resolveOutputRef", () => {
  const stepResults: ChainStepResult[] = [
    {
      stepIndex: 0,
      skillName: "step-0",
      result: {
        ...mockSuccessResult,
        plainLanguageSummary: "First step output",
        filesTouched: ["file1.ts", "file2.ts"],
      },
      gateApproved: true,
      failed: false,
    },
    {
      stepIndex: 1,
      skillName: "step-1",
      result: {
        ...mockSuccessResult,
        plainLanguageSummary: "Second step output",
      },
      gateApproved: true,
      failed: false,
    },
  ];

  it("should resolve initial input reference", () => {
    const ref: SkillOutputRef = { type: "initial", field: "" };
    const result = resolveOutputRef(ref, stepResults, "initial value");
    expect(result).toBe("initial value");
  });

  it("should resolve previous step reference", () => {
    const ref: SkillOutputRef = { type: "previous", field: "plainLanguageSummary" };
    const result = resolveOutputRef(ref, stepResults, "");
    expect(result).toBe("Second step output");
  });

  it("should resolve specific step reference", () => {
    const ref: SkillOutputRef = { type: "step", stepIndex: 0, field: "plainLanguageSummary" };
    const result = resolveOutputRef(ref, stepResults, "");
    expect(result).toBe("First step output");
  });

  it("should resolve nested field paths", () => {
    const ref: SkillOutputRef = { type: "step", stepIndex: 0, field: "filesTouched.0" };
    const result = resolveOutputRef(ref, stepResults, "");
    expect(result).toBe("file1.ts");
  });

  it("should throw error when referencing previous with no prior steps", () => {
    const ref: SkillOutputRef = { type: "previous", field: "output" };
    expect(() => resolveOutputRef(ref, [], "")).toThrow("SKILL-CHAIN-001");
  });

  it("should throw error for invalid step index", () => {
    const ref: SkillOutputRef = { type: "step", stepIndex: 5, field: "output" };
    expect(() => resolveOutputRef(ref, stepResults, "")).toThrow("SKILL-CHAIN-003");
  });

  it("should throw error when stepIndex is missing for step type", () => {
    const ref: SkillOutputRef = { type: "step", field: "output" };
    expect(() => resolveOutputRef(ref, stepResults, "")).toThrow("SKILL-CHAIN-002");
  });
});

describe("resolveInput", () => {
  const stepResults: ChainStepResult[] = [
    {
      stepIndex: 0,
      skillName: "step-0",
      result: {
        ...mockSuccessResult,
        plainLanguageSummary: "Generated output",
      },
      gateApproved: true,
      failed: false,
    },
  ];

  it("should return literal string input as-is", () => {
    const result = resolveInput("literal input", stepResults, "initial");
    expect(result).toBe("literal input");
  });

  it("should substitute $previous.field template", () => {
    const result = resolveInput("Use $previous.plainLanguageSummary here", stepResults, "initial");
    expect(result).toBe("Use Generated output here");
  });

  it("should substitute $initial.field template", () => {
    const result = resolveInput("Start with $initial.field", [], "test-initial");
    expect(result).toBe("Start with test-initial");
  });

  it("should substitute $step.N.field template", () => {
    const result = resolveInput("Get $step.0.plainLanguageSummary value", stepResults, "");
    expect(result).toBe("Get Generated output value");
  });

  it("should handle object reference input", () => {
    const ref: SkillOutputRef = { type: "previous", field: "plainLanguageSummary" };
    const result = resolveInput(ref, stepResults, "");
    expect(result).toBe("Generated output");
  });

  it("should leave unresolvable templates as-is", () => {
    const result = resolveInput("Use $nonexistent.field here", stepResults, "");
    expect(result).toBe("Use $nonexistent.field here");
  });
});

describe("handleGateFailure", () => {
  const stepResults: ChainStepResult[] = [
    {
      stepIndex: 0,
      skillName: "test-step",
      result: mockFailedResult,
      gateApproved: false,
      failed: true,
    },
  ];

  it("should abort when strategy is abort", async () => {
    const result = await handleGateFailure("abort", 0, stepResults);
    expect(result.shouldAbort).toBe(true);
  });

  it("should continue when strategy is continue", async () => {
    const result = await handleGateFailure("continue", 0, stepResults);
    expect(result.shouldAbort).toBe(false);
  });

  it("should prompt user when strategy is prompt", async () => {
    const promptUser = vi.fn().mockResolvedValue("abort");
    const result = await handleGateFailure("prompt", 0, stepResults, promptUser);
    expect(promptUser).toHaveBeenCalled();
    expect(result.shouldAbort).toBe(true);
    expect(result.userChoice).toBe("abort");
  });

  it("should default to abort when strategy is prompt but no promptUser provided", async () => {
    const result = await handleGateFailure("prompt", 0, stepResults);
    expect(result.shouldAbort).toBe(true);
  });

  it("should continue when user chooses continue", async () => {
    const promptUser = vi.fn().mockResolvedValue("continue");
    const result = await handleGateFailure("prompt", 0, stepResults, promptUser);
    expect(result.shouldAbort).toBe(false);
    expect(result.userChoice).toBe("continue");
  });
});

describe("executeChain - basic execution", () => {
  it("should execute a single-step chain successfully", async () => {
    const chain: SkillChain = {
      name: "test-chain",
      steps: [
        {
          skillName: "step-1",
          input: "test input",
          onFailure: "abort",
        },
      ],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(1);
    expect(result.stepResults[0]!.skillName).toBe("step-1");
    expect(skillLoader).toHaveBeenCalledWith("step-1");
  });

  it("should execute multi-step chain sequentially", async () => {
    const chain: SkillChain = {
      name: "multi-step",
      steps: [
        { skillName: "step-1", input: "input-1", onFailure: "abort" },
        { skillName: "step-2", input: "input-2", onFailure: "abort" },
        { skillName: "step-3", input: "input-3", onFailure: "abort" },
      ],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(3);
    expect(skillLoader).toHaveBeenCalledTimes(3);
  });

  it("should fail when skill is not found", async () => {
    const chain: SkillChain = {
      name: "missing-skill",
      steps: [{ skillName: "nonexistent", input: "test", onFailure: "abort" }],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(null);

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
    });

    expect(result.success).toBe(false);
    expect(result.failedAtStep).toBe(0);
    expect(result.failureReason).toContain("SKILL-CHAIN-008");
  });

  it("should handle skill execution exceptions", async () => {
    const chain: SkillChain = {
      name: "error-chain",
      steps: [{ skillName: "error-skill", input: "test", onFailure: "abort" }],
      gating: "none",
    };

    const skillLoader = vi.fn().mockRejectedValue(new Error("Loader error"));

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
    });

    expect(result.success).toBe(false);
    expect(result.failedAtStep).toBe(0);
    expect(result.failureReason).toContain("SKILL-CHAIN-009");
  });
});

describe("executeChain - input substitution", () => {
  it("should substitute $previous.output in step input", async () => {
    const chain: SkillChain = {
      name: "substitution-chain",
      steps: [
        { skillName: "step-1", input: "first step", onFailure: "abort" },
        { skillName: "step-2", input: "$previous.plainLanguageSummary", onFailure: "abort" },
      ],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);
  });

  it("should substitute $initial in step input", async () => {
    const chain: SkillChain = {
      name: "initial-chain",
      steps: [{ skillName: "step-1", input: "Start with $initial.field", onFailure: "abort" }],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);

    const result = await executeChain({
      chain,
      initialInput: "test-initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
    expect(result.stepResults.length).toBe(1);
  });

  it("should substitute $step.N.field in step input", async () => {
    const chain: SkillChain = {
      name: "step-ref-chain",
      steps: [
        { skillName: "step-1", input: "first", onFailure: "abort" },
        { skillName: "step-2", input: "second", onFailure: "abort" },
        { skillName: "step-3", input: "Use $step.0.plainLanguageSummary", onFailure: "abort" },
      ],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(3);
  });

  it("should handle multiple substitutions in one input", async () => {
    const chain: SkillChain = {
      name: "multi-sub-chain",
      steps: [
        { skillName: "step-1", input: "first", onFailure: "abort" },
        {
          skillName: "step-2",
          input: "Combine $previous.skillName and $initial.field",
          onFailure: "abort",
        },
      ],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);

    const result = await executeChain({
      chain,
      initialInput: "initial-value",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
  });

  it("should handle object reference input", async () => {
    const chain: SkillChain = {
      name: "object-ref-chain",
      steps: [
        { skillName: "step-1", input: "first", onFailure: "abort" },
        {
          skillName: "step-2",
          input: { type: "previous", field: "plainLanguageSummary" },
          onFailure: "abort",
        },
      ],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
    expect(result.stepResults).toHaveLength(2);
  });
});

describe("executeChain - PDSE gating", () => {
  it("should pass all steps when gating is none", async () => {
    const chain: SkillChain = {
      name: "no-gating",
      steps: [
        { skillName: "step-1", input: "test", onFailure: "abort" },
        { skillName: "step-2", input: "test", onFailure: "abort" },
      ],
      gating: "none",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
    expect(result.stepResults.every((r) => r.gateApproved === true)).toBe(true);
  });

  it("should use PDSE gating when enabled", async () => {
    const chain: SkillChain = {
      name: "pdse-chain",
      steps: [{ skillName: "step-1", input: "test", onFailure: "abort" }],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi.fn().mockResolvedValue({ approved: true, score: 85 });

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
    });

    expect(result.success).toBe(true);
    expect(forgeGate).toHaveBeenCalled();
    expect(result.stepResults[0]!.pdseScore).toBe(85);
    expect(result.stepResults[0]!.gateApproved).toBe(true);
  });

  it("should fail step when PDSE gate rejects", async () => {
    const chain: SkillChain = {
      name: "pdse-fail",
      steps: [{ skillName: "step-1", input: "test", onFailure: "abort" }],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi.fn().mockResolvedValue({ approved: false, score: 45 });

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
    });

    expect(result.success).toBe(false);
    expect(result.failedAtStep).toBe(0);
    expect(result.stepResults[0]!.gateApproved).toBe(false);
  });

  it("should use step-specific threshold when provided", async () => {
    const chain: SkillChain = {
      name: "step-threshold",
      steps: [{ skillName: "step-1", input: "test", onFailure: "abort", pdseThreshold: 90 }],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi.fn().mockResolvedValue({ approved: true, score: 92 });

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
    });

    expect(result.success).toBe(true);
    expect(forgeGate).toHaveBeenCalledWith(expect.anything(), 90);
  });

  it("should use default threshold when not specified", async () => {
    const chain: SkillChain = {
      name: "default-threshold",
      steps: [{ skillName: "step-1", input: "test", onFailure: "abort" }],
      gating: "pdse",
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi.fn().mockResolvedValue({ approved: true, score: 75 });

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
    });

    expect(result.success).toBe(true);
    expect(forgeGate).toHaveBeenCalledWith(expect.anything(), 70); // default
  });

  it("should approve applied state with default gate", async () => {
    const chain: SkillChain = {
      name: "auto-approve",
      steps: [{ skillName: "step-1", input: "test", onFailure: "abort" }],
      gating: "pdse",
      pdseThreshold: 70,
    };

    // Skill with scripts to trigger execution
    const skillWithScripts: DanteSkill = {
      ...mockSkill,
      scripts: "/test/scripts",
    };

    const skillLoader = vi.fn().mockResolvedValue(skillWithScripts);
    // Return ScriptResult format with successful execution - will result in "applied" state
    const scriptRunner = vi.fn().mockResolvedValue({
      commands: ["echo test"],
      fileReceipts: [],
      allSucceeded: true,
    });

    // Using default gate (no custom forgeGate)
    // Applied state gets score 80, which is above threshold 70
    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(true);
    expect(result.stepResults[0]!.gateApproved).toBe(true);
    expect(result.stepResults[0]!.pdseScore).toBe(80); // "applied" state score
  });

  it("should reject failed state automatically", async () => {
    const chain: SkillChain = {
      name: "auto-reject",
      steps: [{ skillName: "step-1", input: "test", onFailure: "abort" }],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockRejectedValue(new Error("Execution failed"));

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
    });

    expect(result.success).toBe(false);
  });
});

describe("executeChain - failure handling", () => {
  it("should abort chain when step fails with abort strategy", async () => {
    const chain: SkillChain = {
      name: "abort-chain",
      steps: [
        { skillName: "step-1", input: "test", onFailure: "abort" },
        { skillName: "step-2", input: "test", onFailure: "abort" },
      ],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi
      .fn()
      .mockResolvedValueOnce({ approved: false, score: 45 })
      .mockResolvedValueOnce({ approved: true, score: 80 });

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
    });

    expect(result.success).toBe(false);
    expect(result.failedAtStep).toBe(0);
    expect(result.stepResults).toHaveLength(1); // Second step never executed
  });

  it("should continue chain when step fails with continue strategy", async () => {
    const chain: SkillChain = {
      name: "continue-chain",
      steps: [
        { skillName: "step-1", input: "test", onFailure: "continue" },
        { skillName: "step-2", input: "test", onFailure: "abort" },
      ],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi
      .fn()
      .mockResolvedValueOnce({ approved: false, score: 45 })
      .mockResolvedValueOnce({ approved: true, score: 80 });

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
    });

    expect(result.stepResults).toHaveLength(2); // Both steps executed
    expect(result.stepResults[0]!.failed).toBe(true);
    expect(result.stepResults[1]!.failed).toBe(false);
    expect(result.success).toBe(false); // Overall chain failed due to step 0
  });

  it("should prompt user on failure with prompt strategy", async () => {
    const chain: SkillChain = {
      name: "prompt-chain",
      steps: [
        { skillName: "step-1", input: "test", onFailure: "prompt" },
        { skillName: "step-2", input: "test", onFailure: "abort" },
      ],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi
      .fn()
      .mockResolvedValueOnce({ approved: false, score: 45 })
      .mockResolvedValueOnce({ approved: true, score: 80 });
    const promptUser = vi.fn().mockResolvedValue("continue");

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
      promptUser,
    });

    expect(promptUser).toHaveBeenCalled();
    expect(result.stepResults).toHaveLength(2); // User chose continue
  });

  it("should abort when user chooses abort on prompt", async () => {
    const chain: SkillChain = {
      name: "prompt-abort",
      steps: [
        { skillName: "step-1", input: "test", onFailure: "prompt" },
        { skillName: "step-2", input: "test", onFailure: "abort" },
      ],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi.fn().mockResolvedValueOnce({ approved: false, score: 45 });
    const promptUser = vi.fn().mockResolvedValue("abort");

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
      promptUser,
    });

    expect(promptUser).toHaveBeenCalled();
    expect(result.stepResults).toHaveLength(1); // Aborted after first step
    expect(result.success).toBe(false);
  });

  it("should default to abort when prompt strategy but no promptUser", async () => {
    const chain: SkillChain = {
      name: "prompt-no-handler",
      steps: [
        { skillName: "step-1", input: "test", onFailure: "prompt" },
        { skillName: "step-2", input: "test", onFailure: "abort" },
      ],
      gating: "pdse",
      pdseThreshold: 70,
    };

    const skillLoader = vi.fn().mockResolvedValue(mockSkill);
    const scriptRunner = vi.fn().mockResolvedValue(["echo test"]);
    const forgeGate = vi.fn().mockResolvedValueOnce({ approved: false, score: 45 });

    const result = await executeChain({
      chain,
      initialInput: "initial",
      context: mockContext,
      skillLoader,
      scriptRunner,
      forgeGate,
      // No promptUser provided
    });

    expect(result.stepResults).toHaveLength(1);
    expect(result.success).toBe(false);
  });
});
