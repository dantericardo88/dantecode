// ============================================================================
// @dantecode/cli — /magic Command Tests (OnRamp v1.3, D-11)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the agent loop and DanteForge before importing
vi.mock("./agent-loop.js", () => ({
  runAgentLoop: vi.fn().mockResolvedValue({
    id: "test-session",
    name: null,
    messages: [
      {
        id: "1",
        role: "assistant",
        content: "Built the todo app successfully.",
        timestamp: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projectRoot: "/tmp/test",
  }),
}));

vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn().mockReturnValue({
    overall: 92,
    passedGate: true,
    completeness: 90,
    correctness: 94,
    clarity: 90,
    consistency: 92,
  }),
  runAntiStubScanner: vi.fn().mockReturnValue({ passed: true, hardViolations: [] }),
  runConstitutionCheck: vi.fn().mockReturnValue({ passed: true, violations: [] }),
  runGStack: vi.fn().mockReturnValue({ results: [] }),
  allGStackPassed: vi.fn().mockReturnValue(true),
  summarizeGStackResults: vi.fn().mockReturnValue("All passed"),
  queryLessons: vi.fn().mockReturnValue([]),
  formatLessonsForPrompt: vi.fn().mockReturnValue(""),
  runAutoforgeIAL: vi.fn().mockResolvedValue({ success: true }),
  formatBladeProgressLine: vi.fn().mockReturnValue(""),
}));

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<typeof import("@dantecode/core")>("@dantecode/core");
  return {
    ...actual,
    writeRunReport: vi.fn().mockResolvedValue("/tmp/test/.dantecode/reports/run-test.md"),
  };
});

vi.mock("@dantecode/git-engine", async () => {
  const actual =
    await vi.importActual<typeof import("@dantecode/git-engine")>("@dantecode/git-engine");
  return {
    ...actual,
    autoCommit: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ staged: [], unstaged: [], untracked: [] }),
  };
});

// Strip ANSI escape codes
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("/magic command", () => {
  let _stdoutOutput: string;
  const originalWrite = process.stdout.write;

  beforeEach(() => {
    _stdoutOutput = "";
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      _stdoutOutput += String(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("returns usage hint when no args provided", async () => {
    // Dynamic import to get the magicCommand through routeSlashCommand
    const { routeSlashCommand } = await import("./slash-commands.js");
    const state = createMockState();
    const result = await routeSlashCommand("/magic", state);
    const plain = stripAnsi(result);
    expect(plain).toContain("What would you like to build?");
    expect(plain).toContain("Examples:");
  });

  it("returns usage hint with example commands", async () => {
    const { routeSlashCommand } = await import("./slash-commands.js");
    const state = createMockState();
    const result = await routeSlashCommand("/magic", state);
    const plain = stripAnsi(result);
    expect(plain).toContain("/magic");
    expect(plain).toContain("authentication");
  });
});

// Minimal mock state for testing
function createMockState(): any {
  return {
    session: {
      id: "test-session-id",
      name: null,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      projectRoot: "/tmp/test",
    },
    state: {
      model: {
        default: {
          provider: "anthropic",
          modelId: "claude-sonnet-4-20250514",
          maxTokens: 4096,
          temperature: 0.7,
          contextWindow: 200000,
          supportsVision: true,
          supportsToolCalls: true,
        },
        fallback: [],
      },
      pdse: { threshold: 85 },
    },
    projectRoot: "/tmp/test",
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
    skillbook: null,
    memoryOrchestrator: null,
    reasoningOverride: undefined,
    reasoningOverrideSession: false,
    lastThinkingBudget: undefined,
    theme: "default",
    runReportAccumulator: null,
  };
}
