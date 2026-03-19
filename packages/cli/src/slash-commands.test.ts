import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DanteCodeState, Session } from "@dantecode/config-types";
import { DurableRunStore } from "@dantecode/core";
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
