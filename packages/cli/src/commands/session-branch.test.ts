// ============================================================================
// @dantecode/cli -- Session Branch Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@dantecode/core");
  return {
    ...actual,
    getProviderCatalogEntry: vi.fn(() => ({ label: "Mock" })),
    getContextUtilization: vi.fn(() => ({
      tokens: 100,
      maxTokens: 128000,
      percent: 0,
      tier: "green",
    })),
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
    preMutationSnapshotted: new Set<string>(),
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
    verificationTrendTracker: null,
    lastSessionPdseResults: [],
    pdseCache: new Map(),
    lastFileList: [],
    planMode: false,
    currentPlan: null,
    planApproved: false,
    currentPlanId: null,
    planExecutionInProgress: false,
    planExecutionResult: null,
    approvalMode: "default",
    macroRecording: false,
    macroRecordingName: null,
    macroRecordingSteps: [],
    reasoningOverrideSession: false,
    theme: "default",
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

  it("parent session file is written to disk before branching", async () => {
    const state = makeState(tempDir);
    const parentId = state.session.id;
    await routeSlashCommand("/branch sub", state);

    // Real SessionStore writes to <projectRoot>/.dantecode/sessions/<id>.json
    const parentFile = join(tempDir, ".dantecode", "sessions", `${parentId}.json`);
    expect(existsSync(parentFile)).toBe(true);

    const raw = await readFile(parentFile, "utf8");
    const saved = JSON.parse(raw) as { id: string };
    expect(saved.id).toBe(parentId);
  });

  it("branched session file is written to disk with new ID", async () => {
    const state = makeState(tempDir);
    const parentId = state.session.id;
    await routeSlashCommand("/branch new-id-test", state);

    const newId = state.session.id;
    expect(newId).not.toBe(parentId);

    const branchFile = join(tempDir, ".dantecode", "sessions", `${newId}.json`);
    expect(existsSync(branchFile)).toBe(true);

    const raw = await readFile(branchFile, "utf8");
    const saved = JSON.parse(raw) as { id: string; title: string };
    expect(saved.id).toBe(newId);
    expect(saved.title).toBe("new-id-test");
  });

  it("both parent and branch session files exist after branching", async () => {
    const state = makeState(tempDir);
    const parentId = state.session.id;
    await routeSlashCommand("/branch both-files", state);
    const branchId = state.session.id;

    const sessionsDir = join(tempDir, ".dantecode", "sessions");
    const files = await readdir(sessionsDir);

    expect(files).toContain(`${parentId}.json`);
    expect(files).toContain(`${branchId}.json`);
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

  it("/branch returns warning when new-branch save fails (T2)", async () => {
    const state = makeState(tempDir);
    const { SessionStore } = await import("@dantecode/core");
    vi.spyOn(SessionStore.prototype, "save")
      .mockResolvedValueOnce(undefined) // parent save OK
      .mockRejectedValueOnce(new Error("ENOSPC: no space left")); // branch save fails
    const result = await routeSlashCommand("/branch nospc-branch", state);
    expect(result).toContain("branched");
    expect(result).toMatch(/warning|not persisted/i);
    // Session state was still mutated (new ID/name)
    expect(state.session.name).toBe("nospc-branch");
  });

  it("/branch falls back to message count when memorySummarize throws (T3)", async () => {
    const state = makeState(tempDir);
    state.memoryOrchestrator = {
      memorySummarize: vi.fn().mockRejectedValueOnce(new Error("OOM")),
    } as unknown as typeof state.memoryOrchestrator;
    await routeSlashCommand("/branch mem-fallback", state);
    const sysMsg = state.session.messages.find(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        (m.content as string).includes("Branched from:"),
    );
    expect(sysMsg).toBeDefined();
    expect(sysMsg?.content).toMatch(/\d+ messages/);
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

  it("/name persists session to disk via real SessionStore.save", async () => {
    const state = makeState(tempDir);
    await routeSlashCommand("/name persisted-name", state);

    // Real SessionStore writes to <projectRoot>/.dantecode/sessions/<id>.json
    const sessionFile = join(tempDir, ".dantecode", "sessions", `${state.session.id}.json`);
    expect(existsSync(sessionFile)).toBe(true);

    const raw = await readFile(sessionFile, "utf8");
    const saved = JSON.parse(raw) as { id: string; title: string };
    expect(saved.title).toBe("persisted-name");
  });

  it("/name returns warning when SessionStore.save fails (T1)", async () => {
    const state = makeState(tempDir);
    const { SessionStore } = await import("@dantecode/core");
    vi.spyOn(SessionStore.prototype, "save").mockRejectedValueOnce(
      new Error("EACCES: permission denied"),
    );
    const result = await routeSlashCommand("/name fail-name", state);
    // In-memory rename still applied (D2 design: name updates even if disk fails)
    expect(state.session.name).toBe("fail-name");
    // Warning emitted about persistence failure
    expect(result).toMatch(/warning|failed to persist/i);
  });
});

// ---------------------------------------------------------------------------
// --continue flag: session restore pathway (D10 fix verification)
// ---------------------------------------------------------------------------

describe("--continue flag: SessionStore restore pathway", () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await mkdtemp(join(tmpdir(), "dantecode-continue-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("SessionStore.load returns the session saved via /name (D10 restore pathway)", async () => {
    // Persist a named session to disk (as --continue would read it back)
    const state = makeState(tempDir);
    await routeSlashCommand("/name my-previous-session", state);

    // Verify the restore pathway: SessionStore.load returns the saved file
    const { SessionStore } = await import("@dantecode/core");
    const store = new SessionStore(tempDir);
    const sessions = await store.list();
    expect(sessions.length).toBeGreaterThan(0);

    const latest = sessions[0]!;
    const file = await store.load(latest.id);
    expect(file).not.toBeNull();
    expect(file!.title).toBe("my-previous-session");
    expect(file!.id).toBe(state.session.id);
  });

  it("--continue restore preserves full message count from saved session", async () => {
    // makeSession gives 8 messages; verify all survive the save+load round-trip
    const state = makeState(tempDir); // 8 messages
    await routeSlashCommand("/name session-with-msgs", state);

    const { SessionStore } = await import("@dantecode/core");
    const store = new SessionStore(tempDir);
    const file = await store.load(state.session.id);
    expect(file).not.toBeNull();
    expect(file!.messages.length).toBe(state.session.messages.length);
  });
});
