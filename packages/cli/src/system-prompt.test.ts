import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@dantecode/config-types";

type MockTaskOutcomeTrendSummary = {
  total: number;
  successCount: number;
  failureCount: number;
  verifiedCount: number;
  partiallyVerifiedCount: number;
  unverifiedCount: number;
  verificationFailureCount: number;
  unverifiedFailureCount: number;
  runtimeFailureCount: number;
  dominantFailureMode?: "verification_failures" | "unverified_completion" | "runtime_failures";
  dominantFailureCommand?: string;
  warning?: string;
};

const {
  mockLoadRepoMemory,
  mockGetRecentSummaries,
  mockGetCoChangeFiles,
  mockQueryLessons,
  mockQueryRecentTaskOutcomes,
  mockQueryRecentBenchmarkOutcomes,
  mockFormatBenchmarkOutcomesForPrompt,
  mockFormatTaskOutcomesForPrompt,
  mockSummarizeTaskOutcomeTrends,
  mockFormatTaskOutcomeTrendSummary,
} = vi.hoisted(() => ({
  mockLoadRepoMemory: vi.fn(),
  mockGetRecentSummaries: vi.fn(),
  mockGetCoChangeFiles: vi.fn(),
  mockQueryLessons: vi.fn(async () => []),
  mockQueryRecentTaskOutcomes: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  mockQueryRecentBenchmarkOutcomes: vi.fn<(...args: unknown[]) => Promise<unknown[]>>(async () => []),
  mockFormatBenchmarkOutcomesForPrompt: vi.fn(() => ""),
  mockFormatTaskOutcomesForPrompt: vi.fn(() => ""),
  mockSummarizeTaskOutcomeTrends: vi.fn<(...args: unknown[]) => MockTaskOutcomeTrendSummary>(() => ({
    total: 0,
    successCount: 0,
    failureCount: 0,
    verifiedCount: 0,
    partiallyVerifiedCount: 0,
    unverifiedCount: 0,
    verificationFailureCount: 0,
    unverifiedFailureCount: 0,
    runtimeFailureCount: 0,
    warning: undefined,
  })),
  mockFormatTaskOutcomeTrendSummary: vi.fn<(...args: unknown[]) => string>(() => ""),
}));

vi.mock("@dantecode/core", () => ({
  loadRepoMemory: (...args: unknown[]) => mockLoadRepoMemory(...args),
  getProviderPromptSupplement: vi.fn(() => "## Provider-Specific Rules\nExecute tools first."),
  SessionStore: class MockSessionStore {
    constructor(_projectRoot: string) {}
    async getRecentSummaries(limit = 3) {
      return mockGetRecentSummaries(limit);
    }
  },
  ProjectKnowledgeStore: class MockProjectKnowledgeStore {
    constructor(_projectRoot: string) {}
    formatForPrompt() {
      return "";
    }
  },
  getCurrentWave: vi.fn(),
  advanceWave: vi.fn(),
  buildWavePrompt: vi.fn(() => "## Wave 1/2: Research\nWave instructions here."),
  isWaveComplete: vi.fn(),
  CLAUDE_WORKFLOW_MODE: "## Claude Workflow Mode - ACTIVE",
  getCoChangeFiles: (...args: unknown[]) => mockGetCoChangeFiles(...args),
}));

vi.mock("@dantecode/danteforge", () => ({
  queryLessons: mockQueryLessons,
  formatLessonsForPrompt: vi.fn(() => ""),
  queryRecentTaskOutcomes: mockQueryRecentTaskOutcomes,
  queryRecentBenchmarkOutcomes: mockQueryRecentBenchmarkOutcomes,
  formatBenchmarkOutcomesForPrompt: mockFormatBenchmarkOutcomesForPrompt,
  formatTaskOutcomesForPrompt: mockFormatTaskOutcomesForPrompt,
  summarizeTaskOutcomeTrends: mockSummarizeTaskOutcomeTrends,
  formatTaskOutcomeTrendSummary: mockFormatTaskOutcomeTrendSummary,
}));

vi.mock("@dantecode/git-engine", () => ({
  generateSemanticRepoMap: vi.fn(() => []),
  formatSemanticRepoMapForContext: vi.fn(() => ""),
  generateRepoMap: vi.fn(() => []),
  formatRepoMapForContext: vi.fn(() => ""),
}));

vi.mock("./tools.js", () => ({
  getToolDefinitions: vi.fn(() => [
    { name: "Read", description: "Read a file" },
    { name: "Edit", description: "Edit a file" },
  ]),
}));

import {
  buildSystemPrompt,
  selectHotContext,
  type SystemPromptConfig,
} from "./system-prompt.js";

function makeSession(): Session {
  return {
    id: "session-1",
    projectRoot: "C:/Projects/DanteCode",
    messages: [],
    activeFiles: ["src/app.ts"],
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

function makeConfig(overrides: Partial<SystemPromptConfig> = {}): SystemPromptConfig {
  return {
    state: {
      model: {
        default: {
          provider: "grok",
        },
      },
      project: {
        name: "DanteCode",
        language: "TypeScript",
        framework: "Node.js",
      },
    },
    skillActive: false,
    waveState: undefined,
    ...overrides,
  };
}

describe("system-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadRepoMemory.mockResolvedValue(null);
    mockGetRecentSummaries.mockResolvedValue([]);
    mockGetCoChangeFiles.mockResolvedValue([]);
    mockQueryLessons.mockResolvedValue([]);
    mockQueryRecentTaskOutcomes.mockResolvedValue([]);
    mockQueryRecentBenchmarkOutcomes.mockResolvedValue([]);
    mockFormatBenchmarkOutcomesForPrompt.mockReturnValue("");
    mockFormatTaskOutcomesForPrompt.mockReturnValue("");
    mockSummarizeTaskOutcomeTrends.mockReturnValue({
      total: 0,
      successCount: 0,
      failureCount: 0,
      verifiedCount: 0,
      partiallyVerifiedCount: 0,
      unverifiedCount: 0,
      verificationFailureCount: 0,
      unverifiedFailureCount: 0,
      runtimeFailureCount: 0,
      warning: undefined,
    });
    mockFormatTaskOutcomeTrendSummary.mockReturnValue("");
  });

  it("formats hot context for active files and related tests", () => {
    const hotContext = selectHotContext(
      {
        fileGraph: [],
        hotspots: [
          { file: "src/app.ts", changeCount: 7 },
          { file: "src/utils.ts", changeCount: 3 },
        ],
        symbolGraph: [
          { name: "App", kind: "function", file: "src/app.ts", references: [] },
          { name: "ignored", kind: "function", file: "src/other.ts", references: [] },
        ],
        testMap: [
          { testFile: "src/app.test.ts", sourceFiles: ["src/app.ts"] },
          { testFile: "src/other.test.ts", sourceFiles: ["src/other.ts"] },
        ],
        lastUpdated: new Date().toISOString(),
      },
      makeSession(),
    );

    expect(hotContext).toContain("Recent hot files:");
    expect(hotContext).toContain("- src/app.ts (7 changes)");
    expect(hotContext).toContain("Symbols in active files:");
    expect(hotContext).toContain("- App (function) in src/app.ts");
    expect(hotContext).toContain("Related tests:");
    expect(hotContext).toContain("- src/app.test.ts covers src/app.ts");
    expect(hotContext).not.toContain("src/other.test.ts");
  });

  it("builds the base system prompt with provider guidance and files in context", async () => {
    const prompt = await buildSystemPrompt(makeSession(), makeConfig());

    expect(prompt).toContain("You are DanteCode");
    expect(prompt).toContain("## Available Tools");
    expect(prompt).toContain("## Provider-Specific Rules");
    expect(prompt).toContain("## Files in Context");
    expect(prompt).toContain("- src/app.ts");
  });

  it("injects skill execution recipes when skillActive is true without multi-wave orchestration", async () => {
    const prompt = await buildSystemPrompt(makeSession(), makeConfig({ skillActive: true }));

    expect(prompt).toContain("## Tool Recipes for Skill Execution");
    expect(prompt).toContain("gh search repos");
    expect(prompt).toContain("Skill Execution Protocol");
    expect(prompt).not.toContain("## Claude Workflow Mode - ACTIVE");
  });

  it("injects recent task outcomes and trend summaries when available", async () => {
    mockQueryRecentTaskOutcomes.mockResolvedValue([
      {
        id: "outcome-1",
        command: "agent",
        taskDescription: "Fix auth tests",
        success: false,
        startedAt: "2026-04-20T10:00:00.000Z",
        completedAt: "2026-04-20T10:00:05.000Z",
        durationMs: 5000,
        proofStatus: "unverified",
        verificationSummary: {
          totalChecks: 0,
          passedChecks: 0,
          failedChecks: 0,
        },
        verificationSnapshots: [],
        evidenceRefs: [],
      },
    ]);
    mockFormatTaskOutcomesForPrompt.mockReturnValue(
      "- [failure/unverified] agent: Fix auth tests\n  Verification: no checks recorded",
    );
    mockSummarizeTaskOutcomeTrends.mockReturnValue({
      total: 1,
      successCount: 0,
      failureCount: 1,
      verifiedCount: 0,
      partiallyVerifiedCount: 0,
      unverifiedCount: 1,
      verificationFailureCount: 0,
      unverifiedFailureCount: 1,
      runtimeFailureCount: 0,
      dominantFailureMode: "unverified_completion",
      dominantFailureCommand: "agent",
      warning: "Recent outcomes are frequently unverified.",
    });
    mockFormatTaskOutcomeTrendSummary.mockReturnValue(
      "- Outcomes analyzed: 1\n- Failures: 1\n- Warning: Recent outcomes are frequently unverified.",
    );

    const prompt = await buildSystemPrompt(makeSession(), makeConfig());

    expect(prompt).toContain("## Recent Task Outcomes");
    expect(prompt).toContain("[failure/unverified] agent: Fix auth tests");
    expect(prompt).toContain("## Task Outcome Trends");
    expect(prompt).toContain("Outcomes analyzed: 1");
    expect(prompt).toContain("Recent outcomes are frequently unverified.");
  });

  it("injects recent benchmark outcomes when available", async () => {
    mockQueryRecentBenchmarkOutcomes.mockResolvedValue([
      {
        id: "bench-1",
        runId: "run-1",
        suite: "swe-bench",
        model: "anthropic/claude-sonnet-4-6",
        total: 25,
        resolved: 16,
        passRate: 0.64,
        topFailures: ["timeout:3", "test_assertion:2"],
        generatedAt: "2026-04-21T10:00:00.000Z",
      },
    ]);
    mockFormatBenchmarkOutcomesForPrompt.mockReturnValue(
      "- [swe-bench] anthropic/claude-sonnet-4-6: 64.0% (16/25)\n  Top failures: timeout:3, test_assertion:2",
    );

    const prompt = await buildSystemPrompt(makeSession(), makeConfig());

    expect(prompt).toContain("## Recent Benchmark Outcomes");
    expect(prompt).toContain("64.0% (16/25)");
    expect(prompt).toContain("timeout:3, test_assertion:2");
  });
});
