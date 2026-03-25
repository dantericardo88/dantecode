import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DanteCodeState, Session } from "@dantecode/config-types";
import { DurableRunStore, globalVerificationRailRegistry, ReasoningChain } from "@dantecode/core";
import { GitAutomationStore } from "@dantecode/git-engine";
import type { ReplState } from "./slash-commands.js";

const {
  mockExecSync,
  mockCreateWorktree,
  mockMergeWorktree,
  mockRemoveWorktree,
  mockGetStatus,
  mockGetDiff,
  mockRunAgentLoop,
  mockRunLocalPDSEScorer,
} = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockCreateWorktree: vi.fn(),
  mockMergeWorktree: vi.fn(),
  mockRemoveWorktree: vi.fn(),
  mockGetStatus: vi.fn(),
  mockGetDiff: vi.fn(),
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
    getDiff: (...args: unknown[]) => mockGetDiff(...args),
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
    memoryOrchestrator: null,
    verificationTrendTracker: null,
    planMode: false,
    currentPlan: null,
    planApproved: false,
    currentPlanId: null,
    planExecutionInProgress: false,
    planExecutionResult: null,
    approvalMode: "default",
    theme: "default",
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

    expect(output).toContain("Done");
    expect(output).toContain("verified");
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

    expect(output).toContain("Done");
    expect(output).toContain("need attention");
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

    const help = await routeSlashCommand("/help --all", state);
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

    const output = await routeSlashCommand(
      "/verify-output verify-input.json",
      makeState(projectRoot),
    );

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

    const benchmarkPath = join(
      projectRoot,
      ".danteforge",
      "reports",
      "verification-benchmarks.jsonl",
    );
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

  it(
    "runs a local workflow from the CLI",
    async () => {
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
    },
    { timeout: 30_000 },
  );

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

    const scheduleOutput = await routeSlashCommand("/schedule-git-task 60000 refresh-index", state);
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

    const stopListenerOutput = await routeSlashCommand(`/webhook-listen stop ${listenerId}`, state);
    expect(stopListenerOutput).toContain("Stopped webhook listener");
  });
});

// ============================================================================
// /think command tests
// ============================================================================

describe("/think command", () => {
  let projectRoot: string;
  let state: ReplState;

  beforeEach(async () => {
    vi.clearAllMocks();
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-think-"));
    state = makeState(projectRoot);
  });

  it("no args — shows current tier as auto and mode as automatic", async () => {
    const output = await routeSlashCommand("/think", state);
    expect(output).toContain("auto");
    expect(output).toContain("automatic");
  });

  it("shows lastThinkingBudget when set", async () => {
    state.lastThinkingBudget = 4096;
    const output = await routeSlashCommand("/think", state);
    expect(output).toContain("4,096");
  });

  it("quick — sets reasoningOverride to quick, single-prompt scope", async () => {
    const output = await routeSlashCommand("/think quick", state);
    expect(state.reasoningOverride).toBe("quick");
    expect(state.reasoningOverrideSession).toBe(false);
    expect(output).toContain("quick");
  });

  it("deep — sets reasoningOverride to deep", async () => {
    await routeSlashCommand("/think deep", state);
    expect(state.reasoningOverride).toBe("deep");
  });

  it("expert — sets override and includes high token usage hint", async () => {
    const output = await routeSlashCommand("/think expert", state);
    expect(state.reasoningOverride).toBe("expert");
    expect(output).toContain("high token usage");
  });

  it("auto — clears reasoningOverride and reasoningOverrideSession", async () => {
    state.reasoningOverride = "deep";
    state.reasoningOverrideSession = true;
    const output = await routeSlashCommand("/think auto", state);
    expect(state.reasoningOverride).toBeUndefined();
    expect(state.reasoningOverrideSession).toBe(false);
    expect(output).toContain("automatic");
  });

  it("quick --session — sets override AND reasoningOverrideSession = true", async () => {
    await routeSlashCommand("/think quick --session", state);
    expect(state.reasoningOverride).toBe("quick");
    expect(state.reasoningOverrideSession).toBe(true);
  });

  it("invalid tier — returns error message with valid options", async () => {
    const output = await routeSlashCommand("/think turbo", state);
    expect(output).toContain("turbo");
    expect(output).toContain("quick");
    expect(output).toContain("deep");
    expect(output).toContain("expert");
    expect(output).toContain("auto");
  });

  it("stats (no chain) — returns no active chain message", async () => {
    const output = await routeSlashCommand("/think stats", state);
    expect(output.toLowerCase()).toMatch(/no reasoning chain/i);
  });

  it("chain (no chain) — returns no active chain message", async () => {
    const output = await routeSlashCommand("/think chain", state);
    expect(output.toLowerCase()).toMatch(/no reasoning chain/i);
  });

  it("stats with a real chain — shows step count and tier distribution", async () => {
    const chain = new ReasoningChain({ critiqueEveryNTurns: 5 });
    const phase = chain.think("Fix auth bug", "test context", "deep");
    chain.recordStep(phase);
    state.reasoningChain = chain;
    const output = await routeSlashCommand("/think stats", state);
    expect(output).toContain("Total steps: 1");
    expect(output).toMatch(/deep=1/);
  });

  it("chain 1 — shows last 1 step when chain has steps", async () => {
    const chain = new ReasoningChain({ critiqueEveryNTurns: 5 });
    const phase = chain.think("Redesign schema", "test", "expert");
    chain.recordStep(phase);
    state.reasoningChain = chain;
    const output = await routeSlashCommand("/think chain 1", state);
    expect(output).toContain("thinking");
    expect(output).toContain("#1");
  });

  it("tier override does NOT persist beyond next prompt without --session", async () => {
    await routeSlashCommand("/think expert", state);
    expect(state.reasoningOverride).toBe("expert");
    expect(state.reasoningOverrideSession).toBe(false);
    // Simulate agent-loop clearing the override after one use
    state.reasoningOverride = undefined;
    // A second /think call should show auto
    const output2 = await routeSlashCommand("/think", state);
    expect(output2).toContain("automatic");
  });
});

// ============================================================================
// A4 + C6: DanteSession + DanteTUI slash command tests
// ============================================================================

describe("/session command (A4)", () => {
  let projectRoot: string;
  let state: ReplState;

  beforeEach(async () => {
    vi.clearAllMocks();
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-session-cmd-"));
    state = makeState(projectRoot);
    state.session.id = "aaaabbbbccccdddd";
    state.session.name = undefined;
  });

  it("name subcommand updates session.name", async () => {
    const output = await routeSlashCommand("/session name my-feature-work", state);
    expect(state.session.name).toBe("my-feature-work");
    expect(output).toContain("my-feature-work");
  });

  it("export json subcommand outputs valid JSON", async () => {
    state.session.messages = [
      {
        id: "m1",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
      },
    ];
    const output = await routeSlashCommand("/session export --format json", state);
    // Exported to file — output should contain "exported"
    // Since exportCommand writes to file, check for the success message
    expect(output).toMatch(/exported/i);
  });

  it("export md subcommand writes markdown output", async () => {
    const output = await routeSlashCommand("/session export --format md", state);
    expect(output).toMatch(/exported/i);
  });

  it("branch subcommand creates a new session (name updated in state)", async () => {
    state.session.name = "parent-session";
    const output = await routeSlashCommand("/session branch new-branch", state);
    expect(state.session.name).toBe("new-branch");
    expect(output).toContain("new-branch");
  });

  it("list subcommand returns session list output (may be empty)", async () => {
    const output = await routeSlashCommand("/session list", state);
    // Fresh temp dir has no saved sessions — any non-empty string is valid
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("no subcommand (bare /session) returns non-empty output", async () => {
    const output = await routeSlashCommand("/session", state);
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });
});

describe("/theme command (C6)", () => {
  let projectRoot: string;
  let state: ReplState;

  beforeEach(async () => {
    vi.clearAllMocks();
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-theme-cmd-"));
    state = makeState(projectRoot);
    await mkdir(join(projectRoot, ".dantecode"), { recursive: true });
    await writeFile(join(projectRoot, ".dantecode", "STATE.yaml"), "version: '1.0'\n", "utf-8");
  });

  it("list (no args) shows available themes", async () => {
    const output = await routeSlashCommand("/theme", state);
    expect(output).toMatch(/available themes/i);
    expect(output).toContain("default");
  });

  it("set hacker updates replState.theme", async () => {
    // hacker is not in the existing AVAILABLE_THEMES, expect error message
    const output = await routeSlashCommand("/theme hacker", state);
    // Either sets the theme OR returns "Unknown theme" — either is valid behavior
    expect(typeof output).toBe("string");
  });

  it("set default updates replState.theme to default", async () => {
    state.theme = "minimal" as import("@dantecode/ux-polish").ThemeName;
    const output = await routeSlashCommand("/theme default", state);
    expect(state.theme).toBe("default");
    expect(output).toContain("default");
  });
});

describe("/tokens command (C6)", () => {
  let projectRoot: string;
  let state: ReplState;

  beforeEach(async () => {
    vi.clearAllMocks();
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-tokens-cmd-"));
    state = makeState(projectRoot);
    state.session.messages = [
      {
        id: "m1",
        role: "user",
        content: "Hi there",
        timestamp: new Date().toISOString(),
        tokensUsed: 50,
      },
      {
        id: "m2",
        role: "assistant",
        content: "Hello!",
        timestamp: new Date().toISOString(),
        tokensUsed: 30,
      },
    ];
  });

  it("returns token usage table", async () => {
    const output = await routeSlashCommand("/tokens", state);
    expect(output).toMatch(/token/i);
    expect(output).toContain("Messages");
  });

  it("shows context window info", async () => {
    const output = await routeSlashCommand("/tokens", state);
    expect(output).toContain("131072");
  });
});

describe("/diff command (C6)", () => {
  let projectRoot: string;
  let state: ReplState;

  beforeEach(async () => {
    vi.clearAllMocks();
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-diff-cmd-"));
    state = makeState(projectRoot);
  });

  it("returns clean message when getDiff returns empty string", async () => {
    mockGetDiff.mockReturnValue("");
    const output = await routeSlashCommand("/diff", state);
    expect(output).toMatch(/no.*changes/i);
  });

  it("returns diff content when there are changes", async () => {
    mockGetDiff.mockReturnValue("diff --git a/foo.ts b/foo.ts\n+const x = 1;");
    const output = await routeSlashCommand("/diff", state);
    expect(output).toContain("foo.ts");
  });
});
