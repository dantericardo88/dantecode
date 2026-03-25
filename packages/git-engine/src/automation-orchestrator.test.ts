import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import { readAuditEvents } from "@dantecode/core";
import { GitAutomationStore } from "./automation-store.js";
import { GitAutomationOrchestrator } from "./automation-orchestrator.js";
import type { AgentBridgeConfig, AgentBridgeResult } from "./automation-agent-bridge.js";

describe("GitAutomationOrchestrator", () => {
  let tmpDir: string | undefined;

  afterEach(() => {
    if (tmpDir) {
      // Best-effort cleanup — on Windows, file handles may still be open.
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it("runs workflows through a background task, checkpoints progress, and persists audit state", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-automation-orchestrator-"));

    const orchestrator = new GitAutomationOrchestrator({
      projectRoot: tmpDir,
      sessionId: "session-1",
      modelId: "test-model",
      maxConcurrent: 2,
      runWorkflow: async () => ({
        id: "wf-1",
        success: true,
        workflowName: "CI",
        jobName: "build",
        jobs: [],
        steps: [],
        totalDurationMs: 12,
      }),
      readStatus: vi
        .fn()
        .mockReturnValueOnce({
          staged: [],
          unstaged: [],
          untracked: [],
          conflicted: [],
        })
        .mockReturnValueOnce({
          staged: [],
          unstaged: [{ index: " ", workTree: "M", path: "src/generated.ts" }],
          untracked: [],
          conflicted: [],
        }),
      readFile: async () => "export const generated = true;\n",
      scoreContent: () => ({
        overall: 92,
        completeness: 92,
        correctness: 92,
        clarity: 92,
        consistency: 92,
        passedGate: true,
        violations: [],
        scoredAt: "2026-03-20T00:00:00.000Z",
        scoredBy: "test",
      }),
      verifyRepo: () => ({
        passed: true,
        failedSteps: [],
        stepResults: [],
      }),
    });

    const queued = await orchestrator.runWorkflowInBackground({
      workflowPath: ".github/workflows/ci.yml",
      eventPayload: { eventName: "push" },
      trigger: {
        kind: "schedule",
        sourceId: "nightly",
        label: "Nightly CI",
      },
    });

    const execution = await orchestrator.waitForExecution(queued.executionId);

    expect(execution.status).toBe("completed");
    expect(execution.kind).toBe("workflow");
    expect(execution.backgroundTaskId).toBeTruthy();
    expect(execution.gateStatus).toBe("passed");
    expect(execution.modifiedFiles).toEqual(["src/generated.ts"]);
    expect(execution.pdseScore).toBe(0.92);
    expect(execution.checkpointSessionId).toBeTruthy();

    const store = new GitAutomationStore(tmpDir);
    const executions = await store.listAutomationExecutions();
    expect(executions).toHaveLength(1);
    expect(executions[0]?.id).toBe(queued.executionId);

    const checkpointPath = path.join(
      tmpDir,
      ".danteforge",
      "checkpoints",
      execution.checkpointSessionId!,
      "base_state.json",
    );
    expect(fs.existsSync(checkpointPath)).toBe(true);

    const events = await readAuditEvents(tmpDir);
    expect(events.some((event) => event.type === "git_automation_run")).toBe(true);
    expect(events.some((event) => event.type === "git_automation_gate_pass")).toBe(true);
  });

  it("blocks automated pull requests when verification gates fail", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-automation-blocked-"));
    const createAutoPR = vi.fn();

    const orchestrator = new GitAutomationOrchestrator({
      projectRoot: tmpDir,
      sessionId: "session-2",
      modelId: "test-model",
      createAutoPR,
      readStatus: vi.fn().mockReturnValue({
        staged: [],
        unstaged: [{ index: " ", workTree: "M", path: ".changeset/auto.md" }],
        untracked: [],
        conflicted: [],
      }),
      readFile: async () => '---\n"pkg": patch\n---\n\nrelease\n',
      scoreContent: () => ({
        overall: 40,
        completeness: 40,
        correctness: 40,
        clarity: 40,
        consistency: 40,
        passedGate: false,
        violations: [],
        scoredAt: "2026-03-20T00:00:00.000Z",
        scoredBy: "test",
      }),
      verifyRepo: () => ({
        passed: false,
        failedSteps: ["test"],
        stepResults: [
          {
            name: "test",
            command: "npm test",
            passed: false,
            output: "tests failed",
            durationMs: 14,
          },
        ],
      }),
    });

    const result = await orchestrator.createPullRequest({
      title: "Blocked automation PR",
      body: "body",
      changesetFiles: [".changeset/auto.md"],
      trigger: {
        kind: "manual",
        label: "Manual run",
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.gateStatus).toBe("failed");
    expect(createAutoPR).not.toHaveBeenCalled();

    const events = await readAuditEvents(tmpDir);
    expect(events.some((event) => event.type === "git_automation_gate_fail")).toBe(true);
  });

  it("supports eight concurrent workflow executions without losing persisted state", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-automation-scale-"));
    let started = 0;

    const orchestrator = new GitAutomationOrchestrator({
      projectRoot: tmpDir,
      sessionId: "session-scale",
      modelId: "test-model",
      maxConcurrent: 8,
      runWorkflow: async ({ workflowPath }) => {
        started += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          id: workflowPath,
          success: true,
          workflowName: workflowPath,
          jobName: "job",
          jobs: [],
          steps: [],
          totalDurationMs: 5,
        };
      },
      readStatus: vi.fn().mockReturnValue({
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
      }),
      verifyRepo: () => ({
        passed: true,
        failedSteps: [],
        stepResults: [],
      }),
    });

    const queued = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        orchestrator.runWorkflowInBackground({
          workflowPath: `workflow-${index + 1}.yml`,
        }),
      ),
    );

    const finished = await Promise.all(
      queued.map((entry) => orchestrator.waitForExecution(entry.executionId)),
    );

    expect(started).toBeGreaterThanOrEqual(8);
    expect(finished.every((entry) => entry.status === "completed")).toBe(true);

    const persisted = await new GitAutomationStore(tmpDir).listAutomationExecutions();
    expect(persisted).toHaveLength(8);
  });

  it("calls runAgent when agentMode is set on the request", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-automation-agent-mode-"));

    const mockRunAgent = vi
      .fn<(config: AgentBridgeConfig, ctx: Record<string, unknown>) => Promise<AgentBridgeResult>>()
      .mockResolvedValue({
        sessionId: "test-session",
        success: true,
        output: "Agent completed the task",
        tokensUsed: 100,
        durationMs: 500,
        filesChanged: ["src/foo.ts"],
        pdseScore: 88,
      });

    const orchestrator = new GitAutomationOrchestrator({
      projectRoot: tmpDir,
      sessionId: "session-agent",
      modelId: "test-model",
      maxConcurrent: 2,
      runAgent: mockRunAgent,
      readStatus: vi.fn().mockReturnValue({
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
      }),
      verifyRepo: () => ({
        passed: true,
        failedSteps: [],
        stepResults: [],
      }),
    });

    const record = await orchestrator.runWorkflow({
      workflowPath: "unused.yml",
      agentMode: { prompt: "Fix all tests in ${projectRoot}", verifyOutput: true },
      eventPayload: { pr_number: 42 },
      trigger: { kind: "webhook", sourceId: "wh-1", label: "github:pr" },
    });

    expect(mockRunAgent).toHaveBeenCalledOnce();
    expect(mockRunAgent.mock.calls[0]![0].prompt).toBe("Fix all tests in ${projectRoot}");
    expect(record.status).toBe("completed");
    expect(record.pdseScore).toBeCloseTo(88);
    expect(record.gateStatus).toBe("passed");
  });

  it("sets gateStatus=failed when agent bridge returns pdseScore < 70", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-automation-agent-gate-fail-"));

    const mockRunAgent = vi
      .fn<(config: AgentBridgeConfig, ctx: Record<string, unknown>) => Promise<AgentBridgeResult>>()
      .mockResolvedValue({
        sessionId: "test-session",
        success: true,
        output: "Done but quality low",
        tokensUsed: 50,
        durationMs: 200,
        filesChanged: ["src/bad.ts"],
        pdseScore: 55,
      });

    const orchestrator = new GitAutomationOrchestrator({
      projectRoot: tmpDir,
      sessionId: "session-agent-gate",
      modelId: "test-model",
      maxConcurrent: 2,
      runAgent: mockRunAgent,
      readStatus: vi.fn().mockReturnValue({
        staged: [],
        unstaged: [],
        untracked: [],
        conflicted: [],
      }),
      verifyRepo: () => ({
        passed: true,
        failedSteps: [],
        stepResults: [],
      }),
    });

    const record = await orchestrator.runWorkflow({
      workflowPath: "",
      agentMode: { prompt: "Refactor", verifyOutput: true },
    });

    expect(record.status).toBe("completed");
    expect(record.gateStatus).toBe("failed");
  });
});
