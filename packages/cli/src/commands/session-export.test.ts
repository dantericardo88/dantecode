// ============================================================================
// @dantecode/cli — Session Export / Import Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@dantecode/core");
  class MockSessionStore {
    constructor(_root: string) {}
    async save(_file: unknown) {}
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
import type { DanteCodeState, Session } from "@dantecode/config-types";
import type { ReplState } from "../slash-commands.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(projectRoot: string, overrides: Partial<Session> = {}): Session {
  return {
    id: "export-session-1",
    projectRoot,
    messages: [
      {
        id: "m1",
        role: "user",
        content: "Hello DanteCode",
        timestamp: "2026-03-21T10:00:00Z",
      },
      {
        id: "m2",
        role: "assistant",
        content: "Hello! How can I help?",
        timestamp: "2026-03-21T10:00:01Z",
      },
    ],
    activeFiles: ["src/index.ts"],
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
// /export tests
// ---------------------------------------------------------------------------

describe("/export command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dantecode-export-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("/export json creates valid JSON file with session data", async () => {
    const state = makeState(tempDir);
    const result = await routeSlashCommand("/export json", state);

    expect(result).toMatch(/exported to:/i);
    expect(result).toMatch(/\.json/);

    // Verify the file was written
    const files = await import("node:fs/promises").then((m) => m.readdir(tempDir));
    const jsonFile = files.find((f) => f.endsWith(".json"));
    expect(jsonFile).toBeDefined();

    const raw = await readFile(join(tempDir, jsonFile!), "utf8");
    const data = JSON.parse(raw);
    expect(data.version).toBe("1.0.0");
    expect(data.exportedAt).toBeDefined();
    expect(data.session.id).toBe("export-session-1");
    expect(data.session.messages).toHaveLength(2);
  });

  it("/export md creates Markdown with message history", async () => {
    const state = makeState(tempDir);
    const result = await routeSlashCommand("/export md", state);

    expect(result).toMatch(/exported to:/i);
    expect(result).toMatch(/\.md/);

    const files = await import("node:fs/promises").then((m) => m.readdir(tempDir));
    const mdFile = files.find((f) => f.endsWith(".md"));
    expect(mdFile).toBeDefined();

    const raw = await readFile(join(tempDir, mdFile!), "utf8");
    expect(raw).toContain("# Session:");
    expect(raw).toContain("Hello DanteCode");
    expect(raw).toContain("Hello! How can I help?");
  });

  it("export with custom path writes to specified location", async () => {
    const state = makeState(tempDir);
    const customPath = "my-export.json";
    const result = await routeSlashCommand(`/export json ${customPath}`, state);

    expect(result).toContain(customPath);
    const raw = await readFile(join(tempDir, customPath), "utf8");
    const data = JSON.parse(raw);
    expect(data.session.id).toBe("export-session-1");
  });

  it("export uses session name in default filename", async () => {
    const state = makeState(tempDir, { name: "my-session" });
    const result = await routeSlashCommand("/export json", state);

    expect(result).toContain("my-session");
  });

  it("export JSON includes memoryStats as null when no orchestrator", async () => {
    const state = makeState(tempDir);
    await routeSlashCommand("/export json", state);

    const files = await import("node:fs/promises").then((m) => m.readdir(tempDir));
    const jsonFile = files.find((f) => f.endsWith(".json"))!;
    const raw = await readFile(join(tempDir, jsonFile), "utf8");
    const data = JSON.parse(raw);
    expect(data.memoryStats).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// /import tests
// ---------------------------------------------------------------------------

describe("/import command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dantecode-import-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("/import loads session and injects context summary", async () => {
    const importFile = join(tempDir, "imported.json");
    const importData = {
      version: "1.0.0",
      exportedAt: "2026-03-20T00:00:00Z",
      session: {
        id: "old-session",
        name: "old-work",
        createdAt: "2026-03-20T00:00:00Z",
        model: "anthropic/claude-sonnet-4-6",
        messages: [
          { id: "x1", role: "user", content: "Do the thing", timestamp: "2026-03-20T00:00:00Z" },
          { id: "x2", role: "assistant", content: "Done!", timestamp: "2026-03-20T00:00:01Z" },
        ],
      },
    };
    await import("node:fs/promises").then((m) =>
      m.writeFile(importFile, JSON.stringify(importData), "utf8"),
    );

    const state = makeState(tempDir);
    const before = state.session.messages.length;
    const result = await routeSlashCommand("/import imported.json", state);

    expect(result).toMatch(/imported session/i);
    expect(result).toContain("old-work");
    // Two system messages injected: header + context summary
    expect(state.session.messages.length).toBeGreaterThan(before);
  });

  it("/import with invalid file returns error", async () => {
    const state = makeState(tempDir);
    const result = await routeSlashCommand("/import nonexistent.json", state);
    expect(result).toMatch(/failed to import|error/i);
  });

  it("/import with missing messages field returns error", async () => {
    const badFile = join(tempDir, "bad.json");
    await import("node:fs/promises").then((m) =>
      m.writeFile(badFile, JSON.stringify({ version: "1.0.0", session: { id: "x" } }), "utf8"),
    );

    const state = makeState(tempDir);
    const result = await routeSlashCommand("/import bad.json", state);
    expect(result).toMatch(/invalid session file|missing messages/i);
  });

  it("import truncates very long message history (last 20)", async () => {
    const manyMessages = Array.from({ length: 50 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i}`,
      timestamp: new Date().toISOString(),
    }));
    const importData = {
      version: "1.0.0",
      session: { id: "big", messages: manyMessages },
    };
    const file = join(tempDir, "big.json");
    await import("node:fs/promises").then((m) =>
      m.writeFile(file, JSON.stringify(importData), "utf8"),
    );

    const state = makeState(tempDir);
    await routeSlashCommand("/import big.json", state);

    // Check context summary only includes last 20
    const contextMsg = state.session.messages.find(
      (m) => typeof m.content === "string" && m.content.includes("Previous Session Context"),
    );
    expect(contextMsg).toBeDefined();
    // The context summary should show at most 20 messages
    const lines = (contextMsg!.content as string).split("\n").filter((l) => l.startsWith("["));
    expect(lines.length).toBeLessThanOrEqual(20);
  });

  it("/import with no path returns usage message", async () => {
    const state = makeState(tempDir);
    const result = await routeSlashCommand("/import", state);
    expect(result).toMatch(/usage/i);
  });
});
