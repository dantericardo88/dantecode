import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DanteCodeState, Session } from "@dantecode/config-types";
import { DurableRunStore, globalVerificationRailRegistry } from "@dantecode/core";
import { GitAutomationStore } from "@dantecode/git-engine";
import type { ReplState } from "./slash-commands.js";

const {
  mockExecSync,
  mockCreateWorktree,
  mockMergeWorktree,
  mockRemoveWorktree,
  mockGetStatus,
  mockRunAgentLoop,
  mockRunLocalPDSEScorer,
} = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockCreateWorktree: vi.fn(),
  mockMergeWorktree: vi.fn(),
  mockRemoveWorktree: vi.fn(),
  mockGetStatus: vi.fn(),
  mockRunAgentLoop: vi.fn(),
  mockRunLocalPDSEScorer: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: (...args: unknown[]) => mockExecSync(...args),
  };
});

vi.mock("@dantecode/git-engine", async () => {
  const actual = await vi.importActual<object>("@dantecode/git-engine");
  return {
    ...actual,
    createWorktree: (...args: unknown[]) => mockCreateWorktree(...args),
    mergeWorktree: (...args: unknown[]) => mockMergeWorktree(...args),
    removeWorktree: (...args: unknown[]) => mockRemoveWorktree(...args),
    getStatus: (...args: unknown[]) => mockGetStatus(...args),
  };
});

vi.mock("./agent-loop.js", () => ({
  runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
}));

vi.mock("@dantecode/danteforge", async () => {
  const actual = await vi.importActual<object>("@dantecode/danteforge");
  return {
    ...actual,
    runLocalPDSEScorer: (...args: unknown[]) => mockRunLocalPDSEScorer(...args),
  };
});

import { routeSlashCommand } from "./slash-commands.js";

function makeRuntimeSession(projectRoot: string): Session {
  return {
    id: "session-1",
    projectRoot,
    messages: [],
    activeFiles: [],
    readOnlyFiles: [],
    model: {
      provider: "grok",
      modelId: "grok-3",
      maxTokens: 4096,
      temperature: 0.1,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    agentStack: [],
    todoList: [],
  };
}

function makeState(projectRoot: string): ReplState {
  return {
    session: makeRuntimeSession(projectRoot),
    state: {
      model: {
        default: {
          provider: "grok",
          modelId: "grok-3",
          maxTokens: 4096,
          temperature: 0.1,
          contextWindow: 131072,
          supportsVision: false,
          supportsToolCalls: true,
        },
        fallback: [],
        taskOverrides: {},
      },
      pdse: {
        threshold: 85,
        hardViolationsAllowed: 0,
        maxRegenerationAttempts: 2,
        weights: {
          completeness: 0.25,
          correctness: 0.35,
          clarity: 0.2,
          consistency: 0.2,
        },
      },
      autoforge: {
        enabled: true,
        maxIterations: 5,
        gstackCommands: [],
        lessonInjectionEnabled: true,
        abortOnSecurityViolation: true,
      },
    } as unknown as DanteCodeState,
    projectRoot,
    verbose: false,
    enableGit: true,
    enableSandbox: false,
    silent: true,
    lastEditFile: null,
    lastEditContent: null,
    recentToolCalls: [],
    pendingAgentPrompt: null,
    pendingResumeRunId: null,
    pendingExpectedWorkflow: null,
    activeAbortController: null,
    sandboxBridge: null,
    activeSkill: null,
    waveState: null,
    gaslight: null,
  };
}

describe("/party --autoforge", () => {
  let projectRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-party-"));

    mockExecSync.mockImplementation((command: string) => {
      if (command === "git rev-parse --abbrev-ref HEAD") {
        return "main\n";
      }

      if (command === "npm run typecheck" || command === "npm run lint" || command === "npm test") {
        return "";
      }

      return "";
    });

    mockRunLocalPDSEScorer.mockReturnValue({
      overall: 96,
      passedGate: true,
      completeness: 96,
      correctness: 96,
      clarity: 96,
      consistency: 96,
      violations: [],
      scoredAt: new Date().toISOString(),
      scoredBy: "test",
    });

    mockRunAgentLoop.mockImplementation(async (prompt: string, session: Session) => ({
      ...session,
      messages: [
        ...session.messages,
        {
          id: "assistant-1",
          role: "assistant",
          content: `Completed lane prompt: ${prompt.split("\n")[0]}`,
          timestamp: new Date().toISOString(),
        },
      ],
    }));

    mockCreateWorktree.mockImplementation(
      ({ sessionId, branch }: { sessionId: string; branch: string }) => ({
        directory: join(projectRoot, ".dantecode", "worktrees", sessionId),
        branch,
      }),
    );

    mockMergeWorktree.mockReturnValue({
      merged: true,
      worktreeBranch: "lane-branch",
      targetBranch: "main",
      mergeCommitHash: "abc123",
    });
    mockRemoveWorktree.mockReturnValue(undefined);
  });

  it("merges scoped lane output after PDSE and repo-root GStack pass", async () => {
    mockGetStatus.mockImplementation((directory: string) => {
      if (directory.includes("orchestrator")) {
        const filePath = "packages/cli/src/tools.ts";
        return {
          staged: [{ path: filePath }],
          unstaged: [],
          untracked: [],
        };
      }

      return {
        staged: [],
        unstaged: [],
        untracked: [],
      };
    });

    const orchestratorFile = join(
      projectRoot,
      ".dantecode",
      "worktrees",
      "session-1-orchestrator",
      "packages",
      "cli",
      "src",
      "tools.ts",
    );
    await mkdir(dirname(orchestratorFile), { recursive: true });
    await writeFile(orchestratorFile, "export const ok = true;\n", "utf-8");

    const output = await routeSlashCommand(
      "/party --autoforge --files packages/cli/src improve reliability",
      makeState(projectRoot),
    );

    expect(output).toContain("Party Autoforge Complete: PASSED");
    expect(output).toContain("Merged lanes: orchestrator");
    expect(mockMergeWorktree).toHaveBeenCalledTimes(1);
    expect(mockRunAgentLoop).toHaveBeenCalled();
  });

  it("blocks merges when a lane writes outside the allowed scope", async () => {
    mockGetStatus.mockImplementation((directory: string) => {
      if (directory.includes("orchestrator")) {
        return {
          staged: [{ path: "packages/core/src/background-agent.ts" }],
          unstaged: [],
          untracked: [],
        };
      }

      return {
        staged: [],
        unstaged: [],
        untracked: [],
      };
    });

    const outOfScopeFile = join(
      projectRoot,
      ".dantecode",
      "worktrees",
      "session-1-orchestrator",
      "packages",
      "core",
      "src",
      "background-agent.ts",
    );
    await mkdir(dirname(outOfScopeFile), { recursive: true });
    await writeFile(outOfScopeFile, "export const blocked = true;\n", "utf-8");

    const output = await routeSlashCommand(
      "/party --autoforge --files packages/cli/src improve reliability",
      makeState(projectRoot),
    );

    expect(output).toContain("Party Autoforge Complete: PARTIAL");
    expect(output).toContain("scope violation");
    expect(mockMergeWorktree).not.toHaveBeenCalled();
  });

  it("surfaces markdown-backed workflow commands in help and activates them truthfully", async () => {
    await mkdir(join(projectRoot, "commands"), { recursive: true });
    await writeFile(
      join(projectRoot, "commands", "inferno.md"),
      "---\nname: inferno\ndescription: Maximum workflow\n---\n\n# Inferno\nDo the biggest workflow.\n",
      "utf-8",
    );

    const state = makeState(projectRoot);

    const help = await routeSlashCommand("/help", state);
    expect(help).toContain("/inferno");
    expect(help.toLowerCase()).toContain("markdown");

    const output = await routeSlashCommand("/inferno close the resume gap", state);
    expect(output.toLowerCase()).toContain("markdown-backed");
    expect(state.pendingAgentPrompt).toContain("/inferno");
    expect(state.pendingExpectedWorkflow).toBe("inferno");
  });

  it("queues the latest paused durable run through /resume", async () => {
    const state = makeState(projectRoot);
    const store = new DurableRunStore(projectRoot);
    const run = await store.initializeRun({
      runId: "run-resume",
      session: state.session,
      prompt: "Fix the timeout flow",
      workflow: "agent-loop",
    });

    await store.pauseRun(run.id, {
      reason: "model_timeout",
      session: state.session,
      touchedFiles: ["src/app.ts"],
      lastConfirmedStep: "Edited src/app.ts",
      nextAction: "Run typecheck",
      message: "Paused after timeout.",
    });

    const output = await routeSlashCommand("/resume", state);

    expect(output).toContain("run-resume");
    expect(state.pendingAgentPrompt).toBe("continue");
    expect(state.pendingResumeRunId).toBe("run-resume");
  });
});

describe("verification slash commands", () => {
  let projectRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    globalVerificationRailRegistry.clear();
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-verification-cli-"));
  });

  it("runs /verify-output from JSON input and records telemetry", async () => {
    await writeFile(
      join(projectRoot, "verify-input.json"),
      JSON.stringify(
        {
          task: "Provide deploy and rollback guidance",
          output: "Deploy steps:\n1. Build\n2. Deploy\nRollback if checks fail.",
          criteria: {
            requiredKeywords: ["deploy", "rollback"],
            minLength: 40,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );

    const output = await routeSlashCommand("/verify-output verify-input.json", makeState(projectRoot));

    expect(output).toContain("Verification Output");
    expect(output).toContain("PASSED");

    const historyPath = join(projectRoot, ".danteforge", "reports", "verification-history.jsonl");
    const historyRaw = await readFile(historyPath, "utf-8");
    expect(historyRaw).toContain("verify_output");

    const auditPath = join(projectRoot, ".dantecode", "audit.jsonl");
    const auditRaw = await readFile(auditPath, "utf-8");
    expect(auditRaw).toContain("verification_run");
    expect(auditRaw).toContain("pdse_gate_pass");
  });

  it("runs /qa-suite and exposes persisted history through /verification-history", async () => {
    await writeFile(
      join(projectRoot, "qa-suite.json"),
      JSON.stringify(
        {
          planId: "plan-42",
          outputs: [
            {
              id: "deploy",
              task: "Explain the deploy flow",
              output: "Deploy steps:\n1. Build\n2. Deploy\nRollback if checks fail.",
              criteria: {
                requiredKeywords: ["deploy", "rollback"],
                minLength: 40,
              },
            },
            {
              id: "incident",
              task: "Explain the incident flow",
              output: "TODO",
              criteria: {
                requiredKeywords: ["incident"],
                minLength: 30,
              },
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const state = makeState(projectRoot);
    const suiteOutput = await routeSlashCommand("/qa-suite qa-suite.json", state);
    const historyOutput = await routeSlashCommand("/verification-history 5 --kind qa_suite", state);

    expect(suiteOutput).toContain("QA Suite");
    expect(suiteOutput).toContain("plan-42");
    expect(historyOutput).toContain("qa_suite");
    expect(historyOutput).toContain("plan-42");

    const benchmarkPath = join(projectRoot, ".danteforge", "reports", "verification-benchmarks.jsonl");
    const benchmarkRaw = await readFile(benchmarkPath, "utf-8");
    expect(benchmarkRaw).toContain("plan-42");
  });

  it("registers rails and runs critic debate from JSON input", async () => {
    await writeFile(
      join(projectRoot, "rail.json"),
      JSON.stringify(
        {
          id: "steps-required",
          name: "Steps required",
          requiredSubstrings: ["Steps"],
        },
        null,
        2,
      ),
      "utf-8",
    );

    await writeFile(
      join(projectRoot, "debate.json"),
      JSON.stringify(
        {
          subagents: [
            { agentId: "critic-1", verdict: "fail", confidence: 0.9, findings: ["Missing proof"] },
            { agentId: "critic-2", verdict: "warn", confidence: 0.6 },
            { agentId: "critic-3", verdict: "pass", confidence: 0.4 },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const state = makeState(projectRoot);
    const railOutput = await routeSlashCommand("/add-verification-rail rail.json", state);
    const debateOutput = await routeSlashCommand("/critic-debate debate.json", state);

    expect(railOutput).toContain("Verification Rail");
    expect(railOutput).toContain("REGISTERED");
    expect(debateOutput).toContain("Critic Debate");
    expect(debateOutput).toContain("FAIL");
  });
});

describe("git automation slash commands", () => {
  let projectRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-git-automation-cli-"));
    mockRunLocalPDSEScorer.mockReturnValue({
      overall: 96,
      passedGate: true,
      completeness: 96,
      correctness: 96,
      clarity: 96,
      consistency: 96,
      violations: [],
      scoredAt: new Date().toISOString(),
      scoredBy: "test",
    });
  });

  it("starts, lists, and stops a git watcher", async () => {
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src", "app.ts"), "export const value = 1;\n", "utf-8");
    const state = makeState(projectRoot);

    const startOutput = await routeSlashCommand("/git-watch file-change src", state);
    const watchId = startOutput.match(/ID:\s+([a-z0-9-]+)/i)?.[1];
    const listOutput = await routeSlashCommand("/git-watch list", state);

    expect(startOutput).toContain("Git Watcher Started");
    expect(watchId).toBeDefined();
    expect(listOutput).toContain("file-change");

    const stopOutput = await routeSlashCommand(`/git-watch stop ${watchId}`, state);
    expect(stopOutput).toContain("Stopped Git watcher");
  });

  it("runs a local workflow from the CLI", async () => {
    await writeFile(
      join(projectRoot, "workflow.yml"),
      [
        "name: CLI Workflow",
        "jobs:",
        "  build:",
        "    steps:",
        "      - name: Echo",
        "        run: node -e \"console.log('workflow-ok')\"",
        "",
      ].join("\n"),
      "utf-8",
    );

    const output = await routeSlashCommand("/run-workflow workflow.yml", makeState(projectRoot));

    expect(output).toContain("Workflow Run");
    expect(output).toContain("PASSED");
    expect(output).toContain("CLI Workflow");
  });

  it("queues durable workflow automation runs in the background", async () => {
    await writeFile(
      join(projectRoot, "workflow.yml"),
      [
        "name: CLI Workflow",
        "jobs:",
        "  build:",
        "    steps:",
        "      - name: Echo",
        "        run: node -e \"console.log('workflow-ok')\"",
        "",
      ].join("\n"),
      "utf-8",
    );

    const output = await routeSlashCommand(
      "/run-workflow workflow.yml --background",
      makeState(projectRoot),
    );

    expect(output).toContain("Workflow Queued");

    await new Promise((resolve) => setTimeout(resolve, 50));
    const executions = await new GitAutomationStore(projectRoot).listAutomationExecutions();
    expect(executions.length).toBeGreaterThanOrEqual(1);
    expect(executions[0]?.kind).toBe("workflow");
  });

  it("blocks /auto-pr when automation gates fail before invoking gh", async () => {
    mockRunLocalPDSEScorer.mockReturnValue({
      overall: 40,
      passedGate: false,
      completeness: 40,
      correctness: 40,
      clarity: 40,
      consistency: 40,
      violations: [],
      scoredAt: new Date().toISOString(),
      scoredBy: "test",
    });

    const output = await routeSlashCommand(
      "/auto-pr Release prep --changeset patch:pkg-a",
      makeState(projectRoot),
    );

    expect(output).toContain("PR creation blocked");
  });

  it("starts and stops scheduled tasks and webhook listeners", async () => {
    const state = makeState(projectRoot);

    const scheduleOutput = await routeSlashCommand(
      "/schedule-git-task 60000 refresh-index",
      state,
    );
    const taskId = scheduleOutput.match(/ID:\s+([a-z0-9-]+)/i)?.[1];
    const scheduleList = await routeSlashCommand("/schedule-git-task list", state);

    expect(scheduleOutput).toContain("Scheduled Git Task Started");
    expect(taskId).toBeDefined();
    expect(scheduleList).toContain("refresh-index");

    const stopTaskOutput = await routeSlashCommand(`/schedule-git-task stop ${taskId}`, state);
    expect(stopTaskOutput).toContain("Stopped scheduled task");

    const webhookOutput = await routeSlashCommand(
      "/webhook-listen github --port 0 --path /hooks",
      state,
    );
    const listenerId = webhookOutput.match(/ID:\s+([a-z0-9-]+)/i)?.[1];
    const webhookList = await routeSlashCommand("/webhook-listen list", state);

    expect(webhookOutput).toContain("Webhook Listener Started");
    expect(listenerId).toBeDefined();
    expect(webhookList).toContain("github");

    const stopListenerOutput = await routeSlashCommand(
      `/webhook-listen stop ${listenerId}`,
      state,
    );
    expect(stopListenerOutput).toContain("Stopped webhook listener");
  });
});
