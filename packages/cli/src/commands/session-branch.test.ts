// ============================================================================
// @dantecode/cli — Session Branch Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

const { mockSessionStoreSave } = vi.hoisted(() => ({
  mockSessionStoreSave: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@dantecode/core");
  class MockSessionStore {
    constructor(_root: string) {}
    async save(file: unknown) { return mockSessionStoreSave(file); }
    async list() { return []; }
    async load(_id: string) { return null; }
    async deleteAll() { return 0; }
    async summarize(_s: unknown) { return ""; }
    async delete(_id: string) { return true; }
    async exists(_id: string) { return false; }
    getSessionsDir() { return "/mock/.dantecode/sessions"; }
  }
  return {
    ...actual,
    SessionStore: MockSessionStore,
    getProviderCatalogEntry: vi.fn(() => ({ label: "Mock" })),
    getContextUtilization: vi.fn(() => ({ tokens: 100, maxTokens: 128000, percent: 0, tier: "green" })),
    parseModelReference: vi.fn((ref: string) => ({ provider: "anthropic", modelId: ref })),
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
  queryLessons: vi.fn(),
  formatLessonsForPrompt: vi.fn(),
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
  mergeWorktree: vi.fn(),
  removeWorktree: vi.fn(),
  watchGitEvents: vi.fn(),
  listGitWatchers: vi.fn(),
  stopGitWatcher: vi.fn(),
  addChangeset: vi.fn(),
  WebhookListener: vi.fn(),
  listWebhookListeners: vi.fn(),
  stopWebhookListener: vi.fn(),
  scheduleGitTask: vi.fn(),
  listScheduledGitTasks: vi.fn(),
  stopScheduledGitTask: vi.fn(),
  GitAutomationOrchestrator: vi.fn(),
}));

vi.mock("../sandbox-bridge.js", () => ({
  SandboxBridge: vi.fn(),
}));

vi.mock("../agent-loop.js", () => ({
  runAgentLoop: vi.fn(),
}));

import { routeSlashCommand } from "../slash-commands.js";
import type { DanteCodeState, Session, SessionMessage } from "@dantecode/config-types";
import type { ReplState } from "../slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(role: SessionMessage["role"], content: string): SessionMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    timestamp: new Date().toISOString(),
  };
}

function makeSession(projectRoot: string, overrides: Partial<Session> = {}): Session {
  return {
    id: "parent-session-id",
    projectRoot,
    messages: [
      makeMsg("user", "Step 1"),
      makeMsg("assistant", "Done 1"),
      makeMsg("user", "Step 2"),
      makeMsg("assistant", "Done 2"),
      makeMsg("user", "Step 3"),
      makeMsg("assistant", "Done 3"),
      makeMsg("user", "Step 4"),
      makeMsg("assistant", "Done 4"),
    ],
    activeFiles: [],
    readOnlyFiles: [],
    model: {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      maxTokens: 8192,
      temperature: 0.1,
      contextWindow: 200000,
      supportsVision: true,
      supportsToolCalls: true,
    },
    createdAt: "2026-03-21T10:00:00Z",
    updatedAt: "2026-03-21T10:00:05Z",
    agentStack: [],
    todoList: [],
    name: "parent-session",
    ...overrides,
  };
}

function makeState(projectRoot: string, sessionOverrides: Partial<Session> = {}): ReplState {
  return {
    session: makeSession(projectRoot, sessionOverrides),
    state: {} as DanteCodeState,
    projectRoot,
    verbose: false,
    enableGit: false,
    enableSandbox: false,
    silent: true,
    lastEditFile: null,
    lastEditContent: null,
    recentToolCalls: [],
    pendingAgentPrompt: null,
    pendingResumeRunId: null,
    pendingExpectedWorkflow: null,
    pendingWorkflowContext: null,
    activeAbortController: null,
    sandboxBridge: null,
    activeSkill: null,
    waveState: null,
    gaslight: null,
    memoryOrchestrator: null,
    reasoningOverrideSession: false,
  };
}

// ---------------------------------------------------------------------------
// /branch tests
// ---------------------------------------------------------------------------

describe("/branch command", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "dantecode-branch-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("/branch my-branch creates new session with name my-branch", async () => {
    const state = makeState(tempDir);
    await routeSlashCommand("/branch my-branch", state);
    expect(state.session.name).toBe("my-branch");
  });

  it("branch preserves last 5 messages from parent", async () => {
    const state = makeState(tempDir);
    // Parent has 8 messages; after branch, new session should have summary + last 5
    await routeSlashCommand("/branch test-branch", state);
    // messages = [summary-system-msg, ...last 5 parent messages]
    const recentMsgs = state.session.messages.filter((m) => m.role !== "system");
    expect(recentMsgs.length).toBeLessThanOrEqual(5);
  });

  it("branch includes summary as system message", async () => {
    const state = makeState(tempDir);
    await routeSlashCommand("/branch feature", state);
    const sysMsg = state.session.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("Branched from:"),
    );
    expect(sysMsg).toBeDefined();
  });

  it("parent session is saved before branching", async () => {
    const state = makeState(tempDir);
    const parentId = state.session.id;
    await routeSlashCommand("/branch sub", state);
    // SessionStore.save() should have been called at least twice:
    // once for the parent session before fork, once for the new branch
    expect(mockSessionStoreSave).toHaveBeenCalledTimes(2);
    // First call should include the parent session id
    const firstCallArg = mockSessionStoreSave.mock.calls[0]?.[0] as { id: string } | undefined;
    expect(firstCallArg?.id).toBe(parentId);
  });

  it("branch with no name generates timestamp-based name", async () => {
    const state = makeState(tempDir);
    await routeSlashCommand("/branch", state);
    expect(state.session.name).toMatch(/^branch-\d+$/);
  });

  it("new session has fresh ID different from parent", async () => {
    const state = makeState(tempDir);
    const parentId = state.session.id;
    await routeSlashCommand("/branch new-id-test", state);
    expect(state.session.id).not.toBe(parentId);
  });
});

// ---------------------------------------------------------------------------
// /name tests
// ---------------------------------------------------------------------------

describe("/name command", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "dantecode-name-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("/name my-session renames current session", async () => {
    const state = makeState(tempDir);
    const result = await routeSlashCommand("/name my-session", state);
    expect(state.session.name).toBe("my-session");
    expect(result).toContain("my-session");
  });

  it("/name with no argument shows current session name", async () => {
    const state = makeState(tempDir, { name: "existing-name" });
    const result = await routeSlashCommand("/name", state);
    expect(result).toContain("existing-name");
  });

  it("/name persists session to disk (SessionStore.save called)", async () => {
    const state = makeState(tempDir);
    await routeSlashCommand("/name persisted-name", state);
    // SessionStore.save() should have been called to persist the rename
    expect(mockSessionStoreSave).toHaveBeenCalledTimes(1);
    const savedFile = mockSessionStoreSave.mock.calls[0]?.[0] as { id: string; title: string } | undefined;
    expect(savedFile?.title).toBe("persisted-name");
  });
});
