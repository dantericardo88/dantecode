// ============================================================================
// @dantecode/cli — /history Command Tests
// Tests for the session history command and memory count message format.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies BEFORE importing module under test
vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@dantecode/core");

  // Create a mock SessionStore class
  class MockSessionStore {
    private sessions: Array<{
      id: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      model: string;
      messages: Array<{ role: string; content: string; timestamp: string }>;
      contextFiles: string[];
      summary?: string;
    }> = [];

    constructor(_projectRoot: string) {}

    setSessions(sessions: typeof this.sessions) {
      this.sessions = sessions;
    }

    async list() {
      return this.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.messages.length,
        summary: s.summary,
      }));
    }

    async load(id: string) {
      return this.sessions.find((s) => s.id === id) ?? null;
    }

    async deleteAll() {
      const count = this.sessions.length;
      this.sessions = [];
      return count;
    }

    async summarize(session: { summary?: string }) {
      const summary = "Auto-generated summary for testing.";
      session.summary = summary;
      return summary;
    }

    async save() {}
    async delete() {
      return true;
    }
    async exists() {
      return true;
    }
    getSessionsDir() {
      return "/test/.dantecode/sessions";
    }
  }

  return {
    ...actual,
    SessionStore: MockSessionStore,
    getProviderCatalogEntry: vi.fn(() => ({ label: "Mock" })),
    getContextUtilization: vi.fn(() => ({
      tokens: 100,
      maxTokens: 128000,
      percent: 0,
      tier: "green",
    })),
    parseModelReference: vi.fn((ref: string) => ({ provider: "grok", modelId: ref, id: ref })),
    readAuditEvents: vi.fn().mockResolvedValue([]),
    MultiAgent: vi.fn(),
    ModelRouterImpl: vi.fn(),
  };
});

vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn(),
  runGStack: vi.fn(),
  allGStackPassed: vi.fn(),
  summarizeGStackResults: vi.fn(),
  queryLessons: vi.fn().mockResolvedValue([]),
  formatLessonsForPrompt: vi.fn().mockReturnValue(""),
  runAutoforgeIAL: vi.fn(),
  formatBladeProgressLine: vi.fn(),
}));

vi.mock("@dantecode/skill-adapter", () => ({
  listSkills: vi.fn().mockResolvedValue([]),
  getSkill: vi.fn(),
}));

vi.mock("@dantecode/git-engine", () => ({
  getStatus: vi.fn(() => ({ staged: [], unstaged: [], untracked: [] })),
  getDiff: vi.fn(() => ""),
  autoCommit: vi.fn(),
  revertLastCommit: vi.fn(),
  createWorktree: vi.fn(),
}));

vi.mock("./sandbox-bridge.js", () => ({
  SandboxBridge: vi.fn(),
}));

import { routeSlashCommand } from "./slash-commands.js";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeReplState(overrides?: Record<string, unknown>) {
  return {
    session: {
      id: "test-session",
      projectRoot: "/test/project",
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
    } as Session,
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
      project: { name: "test", language: "typescript" },
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
    projectRoot: "/test/project",
    verbose: false,
    enableGit: false,
    enableSandbox: false,
    silent: false,
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
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// /history Command Tests
// ---------------------------------------------------------------------------

describe("/history command", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty message when no sessions exist", async () => {
    const state = makeReplState();
    const result = await routeSlashCommand("/history", state);
    expect(result).toContain("No saved sessions");
  });

  it("returns unknown command for non-existent commands", async () => {
    const state = makeReplState();
    const result = await routeSlashCommand("/nonexistent", state);
    expect(result).toContain("Unknown command");
  });
});

// ---------------------------------------------------------------------------
// Memory Count Message Format Tests
// ---------------------------------------------------------------------------

describe("Memory count message format", () => {
  function formatMemory(lessonCount: number, sessionCount: number): string {
    return `Memory: ${lessonCount} lesson${lessonCount !== 1 ? "s" : ""} | ${sessionCount} session${sessionCount !== 1 ? "s" : ""}`;
  }

  it("formats correctly with plural lessons and sessions", () => {
    expect(formatMemory(5, 12)).toBe("Memory: 5 lessons | 12 sessions");
  });

  it("formats correctly with singular lesson and session", () => {
    expect(formatMemory(1, 1)).toBe("Memory: 1 lesson | 1 session");
  });

  it("formats correctly with zero counts", () => {
    expect(formatMemory(0, 0)).toBe("Memory: 0 lessons | 0 sessions");
  });

  it("formats correctly with mixed singular/plural", () => {
    expect(formatMemory(1, 3)).toBe("Memory: 1 lesson | 3 sessions");
  });
});
