import { describe, it, expect, vi } from "vitest";
import {
  substitutePromptVars,
  runAutomationAgent,
  type AgentBridgeConfig,
} from "./automation-agent-bridge.js";

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
    const result = substitutePromptVars(
      "PR ${pr_number} by ${author} on ${branch}",
      { pr_number: 7, author: "alice", branch: "feat/x" },
    );
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
    expect(agentRunner).toHaveBeenCalledWith(
      "Run tests for PR 5",
      "/fake/project",
      30,
    );
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
    expect(forgeRunner).toHaveBeenCalledWith(
      ["/fake/project/src/index.ts"],
      "/fake/project",
    );
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
});
