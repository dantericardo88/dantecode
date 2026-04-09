import { describe, expect, it, vi } from "vitest";
import type { Session, DanteCodeState } from "@dantecode/config-types";
import type { AgentLoopConfig } from "./agent-loop.js";

const { mockLoadPersistentRulesPrompt } = vi.hoisted(() => ({
  mockLoadPersistentRulesPrompt: vi.fn(),
}));

vi.mock("@dantecode/core", () => ({
  SessionStore: class {
    async getRecentSummaries() {
      return [];
    }
  },
  CLAUDE_WORKFLOW_MODE: "Claude workflow mode",
  buildWavePrompt: vi.fn(() => "Wave prompt"),
  buildWorkflowInvocationPrompt: vi.fn(() => "Workflow prompt"),
  loadPersistentRulesPrompt: mockLoadPersistentRulesPrompt,
}));

import { buildSystemPrompt } from "./context-manager.js";

vi.mock("./tools.js", () => ({
  getToolDefinitions: () => [
    { name: "Read", description: "Read a file from disk." },
    { name: "Write", description: "Write a file to disk." },
  ],
}));

vi.mock("@dantecode/danteforge", () => ({
  queryLessons: vi.fn().mockResolvedValue([]),
  formatLessonsForPrompt: vi.fn(() => ""),
}));

vi.mock("@dantecode/git-engine", () => ({
  generateRepoMap: vi.fn(() => []),
  formatRepoMapForContext: vi.fn(() => ""),
}));

function makeSession(projectRoot: string): Session {
  return {
    id: "context-test-session",
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
      supportsToolCalls: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    agentStack: [],
    todoList: [],
  };
}

function makeConfig(): AgentLoopConfig {
  return {
    state: {
      model: {
        default: {
          provider: "grok",
          modelId: "grok-3",
          maxTokens: 4096,
          temperature: 0.1,
          contextWindow: 131072,
          supportsVision: false,
          supportsToolCalls: false,
        },
        fallback: [],
        taskOverrides: {},
      },
      project: {
        name: "test-project",
        language: "typescript",
      },
      pdse: {
        threshold: 60,
        hardViolationsAllowed: 0,
        maxRegenerationAttempts: 3,
        weights: { completeness: 0.3, correctness: 0.3, clarity: 0.2, consistency: 0.2 },
      },
      autoforge: {
        enabled: false,
        maxIterations: 1,
        gstackCommands: [],
        lessonInjectionEnabled: false,
        abortOnSecurityViolation: false,
      },
    } as unknown as DanteCodeState,
    verbose: false,
    enableGit: false,
    enableSandbox: false,
    silent: true,
  };
}

describe("buildSystemPrompt", () => {
  it("injects persisted project rules into the prompt", async () => {
    mockLoadPersistentRulesPrompt.mockResolvedValueOnce([
      "## Persistent Rules",
      "",
      "### Project Rule (.dantecode/rules.md)",
      "",
      "Always verify mutations before claiming completion.",
      "",
      "### Project Rule (.dantecode/rules/execution.md)",
      "",
      "Never narrate a file change without a successful mutating tool result.",
    ].join("\n"));

    const projectRoot = "/tmp/test-project";
    const prompt = await buildSystemPrompt(makeSession(projectRoot), makeConfig());

    expect(prompt).toContain("## Persistent Rules");
    expect(prompt).toContain("Project Rule (.dantecode/rules.md)");
    expect(prompt).toContain("Always verify mutations before claiming completion.");
    expect(prompt).toContain("Never narrate a file change without a successful mutating tool result.");
    expect(mockLoadPersistentRulesPrompt).toHaveBeenCalledWith(projectRoot);
  });
});
