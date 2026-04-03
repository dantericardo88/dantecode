import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  substitutePromptVars,
  runAutomationAgent,
  type AgentBridgeConfig,
} from "./automation-agent-bridge.js";
import { GitAutomationOrchestrator } from "./automation-orchestrator.js";
import type { AgentBridgeResult } from "./automation-agent-bridge.js";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";

describe("substitutePromptVars", () => {
  it("substitutes known variables in the template", () => {
    const result = substitutePromptVars("Review PR ${pr_number}", { pr_number: 42 });
    expect(result).toBe("Review PR 42");
  });

  it("leaves missing variables as-is", () => {
    const result = substitutePromptVars("PR ${missing}", {});
    expect(result).toBe("PR ${missing}");
  });

  it("substitutes multiple variables", () => {
    const result = substitutePromptVars("PR ${pr_number} by ${author} on ${branch}", {
      pr_number: 7,
      author: "alice",
      branch: "feat/x",
    });
    expect(result).toBe("PR 7 by alice on feat/x");
  });
});

describe("runAutomationAgent", () => {
  it("returns a result with sessionId and success=true when agentRunner succeeds", async () => {
    const agentRunner = vi.fn().mockResolvedValue({
      output: "Agent completed successfully",
      filesChanged: [],
      tokensUsed: 150,
      success: true,
    });

    const config: AgentBridgeConfig = {
      prompt: "Run tests for PR ${pr_number}",
      projectRoot: "/fake/project",
      agentRunner,
    };

    const result = await runAutomationAgent(config, { pr_number: 5 });

    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId.length).toBeGreaterThan(0);
    expect(result.success).toBe(true);
    expect(result.output).toBe("Agent completed successfully");
    expect(result.tokensUsed).toBe(150);
    expect(result.filesChanged).toEqual([]);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeUndefined();

    // Verify the prompt was substituted before passing to runner
    expect(agentRunner).toHaveBeenCalledWith("Run tests for PR 5", "/fake/project", 30);
  });

  it("runs DanteForge verification when verifyOutput=true and files were changed", async () => {
    const agentRunner = vi.fn().mockResolvedValue({
      output: "Agent made changes",
      filesChanged: ["/fake/project/src/index.ts"],
      tokensUsed: 200,
      success: true,
    });

    const forgeRunner = vi.fn().mockResolvedValue({
      aggregateScore: 88,
    });

    const config: AgentBridgeConfig = {
      prompt: "Refactor ${filename}",
      projectRoot: "/fake/project",
      verifyOutput: true,
      agentRunner,
      forgeRunner,
    };

    const result = await runAutomationAgent(config, { filename: "src/index.ts" });

    expect(result.success).toBe(true);
    expect(result.pdseScore).toBe(88);
    expect(forgeRunner).toHaveBeenCalledWith(["/fake/project/src/index.ts"], "/fake/project");
    // No warning since score >= 70
    expect(result.output).not.toContain("WARNING DanteForge");
  });

  it("appends a warning to output when PDSE score is below 70", async () => {
    const agentRunner = vi.fn().mockResolvedValue({
      output: "Agent made some poor changes",
      filesChanged: ["/fake/project/src/bad.ts"],
      tokensUsed: 100,
      success: true,
    });

    const forgeRunner = vi.fn().mockResolvedValue({
      aggregateScore: 55,
    });

    const config: AgentBridgeConfig = {
      prompt: "Do something risky",
      projectRoot: "/fake/project",
      verifyOutput: true,
      agentRunner,
      forgeRunner,
    };

    const result = await runAutomationAgent(config, {});

    expect(result.pdseScore).toBe(55);
    expect(result.output).toContain("WARNING DanteForge");
    expect(result.output).toContain("55/100");
    expect(result.output).toContain("below 70 threshold");
  });

  it("returns success=false and error field when agentRunner throws", async () => {
    const agentRunner = vi.fn().mockRejectedValue(new Error("Agent crashed unexpectedly"));

    const config: AgentBridgeConfig = {
      prompt: "Do something",
      projectRoot: "/fake/project",
      agentRunner,
    };

    const result = await runAutomationAgent(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toBe("Agent crashed unexpectedly");
    expect(result.output).toBe("");
    expect(result.filesChanged).toEqual([]);
    expect(result.tokensUsed).toBe(0);
  });

  it("calls the injected agentRunner with the substituted prompt and projectRoot", async () => {
    const mockRunner = vi.fn().mockResolvedValue({
      output: "agent did real work",
      filesChanged: ["src/foo.ts", "src/bar.ts"],
      tokensUsed: 500,
      success: true,
    });

    const config: AgentBridgeConfig = {
      prompt: "Fix issue in ${filename}",
      projectRoot: "/real/project",
      agentRunner: mockRunner,
    };

    const result = await runAutomationAgent(config, { filename: "src/foo.ts" });

    // The runner must have been called — not the stub
    expect(mockRunner).toHaveBeenCalledOnce();
    // Prompt is substituted before being passed to the runner
    expect(mockRunner).toHaveBeenCalledWith("Fix issue in src/foo.ts", "/real/project", 30);
    // Output and filesChanged come from the runner, not a stub
    expect(result.output).toBe("agent did real work");
    expect(result.filesChanged).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(result.tokensUsed).toBe(500);
    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns success=false when the injected agentRunner throws an error", async () => {
    const failRunner = vi.fn().mockRejectedValue(new Error("LLM unavailable"));

    const config: AgentBridgeConfig = {
      prompt: "do work",
      projectRoot: "/project",
      agentRunner: failRunner,
    };

    const result = await runAutomationAgent(config, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/LLM unavailable/);
    expect(result.output).toBe("");
    expect(result.filesChanged).toEqual([]);
    expect(result.tokensUsed).toBe(0);
  });
});

describe("GitAutomationOrchestrator agentMode integration", () => {
  let tmpDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-bridge-test-"));
  });

  afterEach(() => {
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("orchestrator calls runAutomationAgent when workflow.agentMode is set", async () => {
    const capturedCalls: Array<{ config: AgentBridgeConfig; ctx: Record<string, unknown> }> = [];

    const mockRunAgent = vi
      .fn()
      .mockImplementation(
        (config: AgentBridgeConfig, ctx: Record<string, unknown>): Promise<AgentBridgeResult> => {
          capturedCalls.push({ config, ctx });
          return Promise.resolve({
            sessionId: "test-session-abc",
            success: true,
            output: "Agent completed the task",
            filesChanged: ["src/fixed.ts"],
            tokensUsed: 300,
            durationMs: 1200,
          });
        },
      );

    const orchestrator = new GitAutomationOrchestrator({
      projectRoot: tmpDir!,
      sessionId: "test-session",
      modelId: "test-model",
      waitTimeoutMs: 5000,
      pollIntervalMs: 25,
      runAgent: mockRunAgent,
      // Provide lightweight stubs for gate evaluation
      readStatus: vi
        .fn()
        .mockReturnValue({ staged: [], unstaged: [], untracked: [], conflicted: [] }),
      readFile: vi.fn().mockResolvedValue(""),
      scoreContent: vi.fn().mockReturnValue({
        overall: 95,
        completeness: 95,
        correctness: 95,
        clarity: 95,
        consistency: 95,
        passedGate: true,
        violations: [],
        scoredAt: new Date().toISOString(),
        scoredBy: "test",
      }),
      verifyRepo: vi.fn().mockReturnValue({ passed: true, failedSteps: [] }),
      auditLogger: vi.fn().mockResolvedValue(undefined),
    });

    const execution = await orchestrator.runWorkflow({
      workflowPath: ".github/workflows/fix.yml",
      agentMode: {
        prompt: "Fix the failing tests in ${workflowPath}",
        maxRounds: 5,
        verifyOutput: false,
      },
      trigger: { kind: "manual", sourceId: "user", label: "test trigger" },
    });

    // The agent bridge must have been called — not a shell workflow
    expect(mockRunAgent).toHaveBeenCalledOnce();
    const [calledConfig] = mockRunAgent.mock.calls[0] as [
      AgentBridgeConfig,
      Record<string, unknown>,
    ];
    expect(calledConfig.prompt).toBe("Fix the failing tests in ${workflowPath}");
    expect(calledConfig.maxRounds).toBe(5);
    expect(calledConfig.verifyOutput).toBe(false);

    // Execution should be marked completed (not failed/blocked)
    expect(execution.status).toBe("completed");
    expect(execution.modifiedFiles).toEqual(["src/fixed.ts"]);
    expect(capturedCalls.length).toBe(1);
  });
});
