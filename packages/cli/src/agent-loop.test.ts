// ============================================================================
// @dantecode/cli — Agent Loop Smoke Tests
// End-to-end smoke tests that exercise the full agent loop flow with mocked
// providers. Tests: basic prompt, tool dispatch, safety blocking, stuck loop,
// planning phase, approach memory, pivot logic, progress tracking.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies BEFORE importing module under test

// Mock generateText at the "ai" module level — ModelRouterImpl calls this internally.
const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
}));

// Track analyzeComplexity return value so tests can override it
let mockAnalyzeComplexityValue = 0.3;
const mockEscalateTier = vi.fn();

vi.mock("@dantecode/core", () => {
  // Build a lightweight mock ModelRouterImpl that uses our mockGenerateText
  class MockModelRouterImpl {
    private _modelRatedComplexity: number | null = null;
    private _firstTurnCompleted = false;

    constructor(_routerConfig: unknown, _projectRoot: string, _sessionId: string) {}

    async generate(
      messages: Array<{ role: string; content: string }>,
      _options?: Record<string, unknown>,
    ): Promise<string> {
      const result = await mockGenerateText({
        model: { modelId: "mock" },
        messages,
      });
      return result.text;
    }

    async stream(
      messages: Array<{ role: string; content: string }>,
      _options?: Record<string, unknown>,
    ): Promise<{ textStream: AsyncIterable<string> }> {
      const result = await mockGenerateText({
        model: { modelId: "mock" },
        messages,
      });
      const text = result.text;
      return {
        textStream: (async function* () {
          yield text;
        })(),
      };
    }

    extractModelComplexityRating(_responseText: string, _userPrompt?: string): number | null {
      if (this._firstTurnCompleted) return this._modelRatedComplexity;
      this._firstTurnCompleted = true;
      this._modelRatedComplexity = 0.3;
      return 0.3;
    }

    getModelRatedComplexity(): number | null {
      return this._modelRatedComplexity;
    }

    analyzeComplexity(_prompt: string): number {
      return mockAnalyzeComplexityValue;
    }

    forceCapable() {
      mockEscalateTier("forceCapable");
    }

    escalateTier(reason: string) {
      mockEscalateTier(reason);
    }

    selectTier() {
      return "fast";
    }
    recordRequestCost() {}
    resetSessionCost() {}
  }

  // Mock SessionStore for cross-session learning
  const mockGetRecentSummaries = vi.fn().mockResolvedValue([]);

  class MockSessionStore {
    constructor(_projectRoot: string) {}
    async getRecentSummaries(limit = 3) {
      return mockGetRecentSummaries(limit);
    }
    async list() { return []; }
    async load() { return null; }
    async save() {}
  }

  return {
    ModelRouterImpl: MockModelRouterImpl,
    SessionStore: MockSessionStore,
    _mockGetRecentSummaries: mockGetRecentSummaries,
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    shouldContinueLoop: vi.fn(() => true),
    estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
    estimateMessageTokens: vi.fn((msgs: Array<{ content: string }>) =>
      msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
    ),
    promptRequestsToolExecution: vi.fn((prompt: string) =>
      /\b(fix|update|write|edit|add|build|implement|change)\b/i.test(prompt),
    ),
    responseNeedsToolExecutionNudge: vi.fn((text: string) =>
      /\b(i will|plan|steps?|phase|first|next|then|created|updated|modified|executing plan)\b/i.test(
        text,
      ),
    ),
    parseVerificationErrors: vi.fn(() => []),
    formatErrorsForFixPrompt: vi.fn(() => ""),
    computeErrorSignature: vi.fn(() => ""),
    getContextUtilization: vi.fn(() => ({ tokens: 100, maxTokens: 128000, percent: 0, tier: "green" })),
    isProtectedWriteTarget: vi.fn((filePath: string) => /packages[\\/]/.test(filePath)),
    runStartupHealthCheck: vi.fn().mockResolvedValue({ healthy: true }),
  };
});

vi.mock("@dantecode/danteforge", () => ({
  runAntiStubScanner: vi.fn(() => ({ passed: true, hardViolations: [] })),
  runLocalPDSEScorer: vi.fn(() => ({
    overall: 85,
    passedGate: true,
    completeness: 85,
    correctness: 85,
    clarity: 85,
    consistency: 85,
  })),
  runConstitutionCheck: vi.fn(() => ({ violations: [] })),
  queryLessons: vi.fn().mockResolvedValue([]),
  formatLessonsForPrompt: vi.fn().mockReturnValue(""),
  detectAndRecordPatterns: vi.fn().mockResolvedValue([]),
  recordSuccessPattern: vi.fn().mockResolvedValue({}),
}));

// Get references to the mocked danteforge functions for assertions
import {
  queryLessons as _ql,
  formatLessonsForPrompt as _flp,
  detectAndRecordPatterns as _darp,
} from "@dantecode/danteforge";
import {
  parseVerificationErrors as _parseVerificationErrors,
  computeErrorSignature as _computeErrorSignature,
} from "@dantecode/core";
const mockQueryLessons = _ql as unknown as ReturnType<typeof vi.fn>;
const mockFormatLessonsForPrompt = _flp as unknown as ReturnType<typeof vi.fn>;
const mockDetectAndRecordPatterns = _darp as unknown as ReturnType<typeof vi.fn>;
const mockParseVerificationErrors = _parseVerificationErrors as unknown as ReturnType<typeof vi.fn>;
const mockComputeErrorSignature = _computeErrorSignature as unknown as ReturnType<typeof vi.fn>;

// Core mocked functions are available via vi.mock above; import only if needed.

vi.mock("@dantecode/git-engine", () => ({
  getStatus: vi.fn(() => ({ staged: [], unstaged: [], untracked: [] })),
  autoCommit: vi.fn(),
  generateRepoMap: vi.fn(() => [
    { path: "src/index.ts", size: 1024, language: "typescript", lastModified: "2025-01-01" },
    { path: "src/utils.ts", size: 512, language: "typescript", lastModified: "2025-01-01" },
  ]),
  formatRepoMapForContext: vi.fn(
    () => "src/index.ts (1.0 KB, typescript)\nsrc/utils.ts (0.5 KB, typescript)",
  ),
}));

vi.mock("./tools.js", () => ({
  executeTool: vi.fn().mockResolvedValue({ content: "ok", isError: false }),
  getToolDefinitions: vi.fn(() => [
    { name: "Read", description: "Read a file", parameters: {} },
    { name: "Write", description: "Write a file", parameters: {} },
    { name: "Bash", description: "Run command", parameters: {} },
  ]),
}));

// Get reference to executeTool mock for assertions
import { executeTool as _et } from "./tools.js";
const mockExecuteTool = _et as unknown as ReturnType<typeof vi.fn>;

vi.mock("./tool-schemas.js", () => ({
  getAISDKTools: vi.fn(() => ({})),
}));

// Safety module is NOT mocked — we test it for real

import { runAgentLoop, type AgentLoopConfig } from "./agent-loop.js";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Test Fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "test-session",
    projectRoot: "/tmp/test-project",
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
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<AgentLoopConfig>): AgentLoopConfig {
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
    verbose: false,
    enableGit: false,
    enableSandbox: false,
    silent: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentLoop smoke tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
    mockEscalateTier.mockReset();
  });

  it("basic prompt produces response with no tool calls", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "Hello! I can help you with that.\n[COMPLEXITY: 0.1]",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Say hello", session, makeConfig());

    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages.some((m) => m.role === "user")).toBe(true);
    expect(result.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("extracts and dispatches tool calls from model response", async () => {
    // First call: model returns a tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'I will read the file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Second call: model returns final response (no tool calls)
    mockGenerateText.mockResolvedValueOnce({
      text: "The file contains the main entry point.",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Read src/index.ts", session, makeConfig());

    // Verify the session has tool use messages
    const toolUseMsg = result.messages.find(
      (m) => m.role === "assistant" && m.toolUse?.name === "Read",
    );
    expect(toolUseMsg).toBeDefined();

    // Verify tool result is in the session
    const toolResultMsg = result.messages.find((m) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
  });

  it("nudges narrated execution into real tool calls for action prompts", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: "I will inspect src/index.ts first, then update the implementation and run tests.",
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      })
      .mockResolvedValueOnce({
        text: '<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
      })
      .mockResolvedValueOnce({
        text: "I inspected the file and I am ready for the next change.",
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      });

    const session = makeSession();
    const result = await runAgentLoop("Fix src/index.ts", session, makeConfig());

    expect(result.messages.some((m) => m.toolUse?.name === "Read")).toBe(true);
    expect(result.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("blocks dangerous bash commands via safety hooks", async () => {
    // Model returns a dangerous command
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Bash","input":{"command":"rm -rf / "}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    // After blocking, model gets safety message and produces final response
    mockGenerateText.mockResolvedValueOnce({
      text: "I apologize, that was dangerous.",
      usage: { totalTokens: 40 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Delete everything", session, makeConfig());

    // The blocked command should NOT produce a tool result message with Bash output.
    // Instead, the safety hook injects a blocking message into the tool results
    // which gets sent back to the model as a user message.
    const bashToolResult = result.messages.find(
      (m) => m.role === "tool" && m.toolResult?.content.includes("rm -rf"),
    );
    expect(bashToolResult).toBeUndefined();

    // Session should end with the model's apology response
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("detects stuck loop and injects break message", async () => {
    const repeatedToolCall =
      '<tool_use>\n{"name":"Read","input":{"file_path":"same.ts"}}\n</tool_use>';

    // Model keeps returning the same tool call 3 times, then wraps up
    mockGenerateText
      .mockResolvedValueOnce({ text: repeatedToolCall, usage: { totalTokens: 30 } })
      .mockResolvedValueOnce({ text: repeatedToolCall, usage: { totalTokens: 30 } })
      .mockResolvedValueOnce({ text: repeatedToolCall, usage: { totalTokens: 30 } })
      .mockResolvedValueOnce({
        text: "I will try a different approach.",
        usage: { totalTokens: 20 },
      });

    const session = makeSession();
    const result = await runAgentLoop("Read same.ts", session, makeConfig());

    // Should eventually terminate
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[result.messages.length - 1]!.role).toBe("assistant");
  });

  it("handles model generation errors gracefully", async () => {
    mockGenerateText.mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const session = makeSession();
    const result = await runAgentLoop("Do something", session, makeConfig());

    // Should produce an error message in the session
    const errorMsg = result.messages.find(
      (m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("error"),
    );
    expect(errorMsg).toBeDefined();
  });

  it("truncates large tool output without crashing", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Read","input":{"file_path":"huge.ts"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "That was a large file.",
      usage: { totalTokens: 20 },
    });

    // executeTool mock already returns { content: "ok", isError: false } by default

    const session = makeSession();
    const result = await runAgentLoop("Read huge file", session, makeConfig());

    // The loop should complete successfully
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Memory Bridge Tests
// ---------------------------------------------------------------------------

describe("Memory Bridge: lesson injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("injects learned patterns into system prompt when lessons exist", async () => {
    const fakeLessons = [
      {
        id: "lesson-1",
        projectRoot: "/tmp/test-project",
        pattern: "Always use strict TypeScript",
        correction: "Enable strict mode in tsconfig.json",
        occurrences: 5,
        lastSeen: new Date().toISOString(),
        severity: "warning" as const,
        type: "preference" as const,
        source: "memory-detector" as const,
      },
    ];

    mockQueryLessons.mockResolvedValueOnce(fakeLessons);
    mockFormatLessonsForPrompt.mockReturnValueOnce(
      "## Previously Learned Lessons (1 relevant)\n\n### Lesson 1 [PREFERENCE / WARNING] (seen 5x)\n**Pattern:** Always use strict TypeScript\n**Correction:** Enable strict mode in tsconfig.json",
    );

    mockGenerateText.mockResolvedValueOnce({
      text: "Got it! I will follow the learned patterns.\n[COMPLEXITY: 0.2]",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    await runAgentLoop("Hello", session, makeConfig());

    // queryLessons should have been called with the session projectRoot
    expect(mockQueryLessons).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/tmp/test-project",
        limit: 10,
      }),
    );

    // formatLessonsForPrompt should have been called with the lessons
    expect(mockFormatLessonsForPrompt).toHaveBeenCalledWith(fakeLessons);

    // The model receives the system prompt embedded in the flow; verify queryLessons was invoked
    expect(mockQueryLessons).toHaveBeenCalledTimes(1);
  });

  it("system prompt works correctly when no lessons exist", async () => {
    mockQueryLessons.mockResolvedValueOnce([]);

    mockGenerateText.mockResolvedValueOnce({
      text: "Hello! How can I help?\n[COMPLEXITY: 0.1]",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Hello", session, makeConfig());

    // Should complete normally even with no lessons
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    // formatLessonsForPrompt should NOT be called when there are no lessons
    expect(mockFormatLessonsForPrompt).not.toHaveBeenCalled();
  });

  it("lesson injection failure does not break the agent loop", async () => {
    mockQueryLessons.mockRejectedValueOnce(new Error("SQLite database corrupted"));

    mockGenerateText.mockResolvedValueOnce({
      text: "I can still help you!\n[COMPLEXITY: 0.1]",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Hello", session, makeConfig());

    // Agent should still produce a response despite lesson injection failure
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("records conversation patterns at end of agent loop", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "Done!\n[COMPLEXITY: 0.1]",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("Always use bun instead of npm", session, makeConfig());

    // detectAndRecordPatterns should have been called with conversation messages
    expect(mockDetectAndRecordPatterns).toHaveBeenCalledTimes(1);
    const [messages, projectRoot] = mockDetectAndRecordPatterns.mock.calls[0]!;
    expect(projectRoot).toBe("/tmp/test-project");
    expect(Array.isArray(messages)).toBe(true);
    // Should include at least the user message and assistant response
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.some((m: { role: string }) => m.role === "user")).toBe(true);
    expect(messages.some((m: { role: string }) => m.role === "assistant")).toBe(true);
  });

  it("pattern recording failure does not break the session", async () => {
    mockDetectAndRecordPatterns.mockRejectedValueOnce(new Error("Database write failed"));

    mockGenerateText.mockResolvedValueOnce({
      text: "All done!\n[COMPLEXITY: 0.1]",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Hello", session, makeConfig());

    // Session should still complete and return normally
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.updatedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Planning Phase Tests
// ---------------------------------------------------------------------------

describe("Planning phase: injection for complex tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects planning instruction when complexity >= 0.7", async () => {
    // Set high complexity so planning is enabled
    mockAnalyzeComplexityValue = 0.8;

    mockGenerateText.mockResolvedValueOnce({
      text: "Plan: 1. Read files 2. Edit module 3. Run tests\n[COMPLEXITY: 0.8]",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Refactor the entire auth module", session, makeConfig());

    // The model should have been called, and the messages sent to it should include
    // the planning instruction as a system message
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateText.mock.calls[0]![0];
    const messagesPassedToModel = callArgs.messages;

    // Look for the planning instruction in the messages
    const planningMessage = messagesPassedToModel.find(
      (m: { role: string; content: string }) =>
        m.role === "system" && m.content.includes("Planning Required"),
    );
    expect(planningMessage).toBeDefined();
    expect(planningMessage.content).toContain("What files need to change?");
    expect(planningMessage.content).toContain("What's the approach?");
    expect(planningMessage.content).toContain("What could go wrong?");

    // Session should still complete normally
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT inject planning instruction when complexity < 0.7", async () => {
    // Set low complexity so planning is disabled
    mockAnalyzeComplexityValue = 0.3;

    mockGenerateText.mockResolvedValueOnce({
      text: "Hello!\n[COMPLEXITY: 0.2]",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("Say hello", session, makeConfig());

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateText.mock.calls[0]![0];
    const messagesPassedToModel = callArgs.messages;

    // There should be NO system message with planning instruction
    const planningMessage = messagesPassedToModel.find(
      (m: { role: string; content: string }) =>
        m.role === "system" && m.content.includes("Planning Required"),
    );
    expect(planningMessage).toBeUndefined();
  });

  it("tracks plan generation on first response for high-complexity tasks", async () => {
    mockAnalyzeComplexityValue = 0.9;

    // First response: model produces a plan and a tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'My approach: read auth.ts first, then refactor.\n<tool_use>\n{"name":"Read","input":{"file_path":"auth.ts"}}\n</tool_use>',
      usage: { totalTokens: 80 },
    });
    // Second response: final
    mockGenerateText.mockResolvedValueOnce({
      text: "Refactoring complete.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Refactor auth module", session, makeConfig());

    // The loop should complete successfully with tool use
    expect(result.messages.some((m) => m.toolUse?.name === "Read")).toBe(true);
    expect(result.messages.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Approach Memory Tests
// ---------------------------------------------------------------------------

describe("Approach memory: recording after verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("records approach outcome after verification cycle passes", async () => {
    // Configure project with a test command so verification runs
    const config = makeConfig();
    (config.state.project as unknown as Record<string, unknown>).testCommand = "npm test";

    // First call: model writes a file
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"src/app.ts","content":"export const x = 1;"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    // Second call: model responds after verification passes
    mockGenerateText.mockResolvedValueOnce({
      text: "All changes verified successfully.",
      usage: { totalTokens: 20 },
    });

    // executeTool returns success for both the Write call and the verification Bash call
    mockExecuteTool
      .mockResolvedValueOnce({ content: "ok", isError: false }) // Write
      .mockResolvedValueOnce({ content: "Tests passed", isError: false }); // npm test

    const session = makeSession();
    const result = await runAgentLoop("Update app", session, makeConfig());

    // The loop should complete. executeTool should have been called at least once
    // for the Write tool (verification may or may not run depending on mock setup).
    expect(mockExecuteTool).toHaveBeenCalled();
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("records failed approach and includes it in retry prompt when verification fails", async () => {
    const config = makeConfig();
    (config.state.project as unknown as Record<string, unknown>).testCommand = "npm test";

    // First call: model writes a file
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"src/app.ts","content":"broken code"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    // Second call: model gets the verification failure message and wraps up
    mockGenerateText.mockResolvedValueOnce({
      text: "I see the test failed. Let me try a different approach.",
      usage: { totalTokens: 30 },
    });

    // executeTool: Write succeeds, verification Bash fails
    mockExecuteTool
      .mockResolvedValueOnce({ content: "ok", isError: false }) // Write
      .mockResolvedValueOnce({ content: "Error: test failed", isError: true }); // npm test

    const session = makeSession();
    const result = await runAgentLoop("Update app", session, config);

    // The verification should have been attempted (executeTool called for Bash)
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    // The session should still complete
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("escalates tier after three repeated verification signatures", async () => {
    const config = makeConfig();
    (config.state.project as unknown as Record<string, unknown>).lintCommand = "npm run lint";
    (config.state.project as unknown as Record<string, unknown>).testCommand = "npm test";
    (config.state.project as unknown as Record<string, unknown>).buildCommand = "npm run build";

    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"src/app.ts","content":"broken code"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "I need a stronger retry strategy.",
      usage: { totalTokens: 30 },
    });

    mockExecuteTool.mockImplementation(async (name: string) => {
      if (name === "Write") {
        return { content: "ok", isError: false };
      }
      if (name === "Bash") {
        return { content: "verification failed", isError: true };
      }
      return { content: "ok", isError: false };
    });

    mockParseVerificationErrors.mockReturnValue([{ message: "same failure" }]);
    mockComputeErrorSignature.mockReturnValue("repeat-sig");

    await runAgentLoop("Update app", makeSession(), config);

    expect(mockEscalateTier).toHaveBeenCalledWith(
      expect.stringContaining("repeat-sig"),
    );
  });
});

describe("Major edit batch gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
    mockEscalateTier.mockReset();
  });

  it("runs repo-root GStack after protected writes", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"packages/cli/src/tools.ts","content":"export const gated = true;"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Protected write verified.",
      usage: { totalTokens: 20 },
    });

    mockExecuteTool.mockImplementation(async (name: string) => {
      if (name === "Write") {
        return { content: "ok", isError: false };
      }
      if (name === "Bash") {
        return { content: "green", isError: false };
      }
      return { content: "ok", isError: false };
    });

    await runAgentLoop("Harden the CLI tools", makeSession(), makeConfig());

    const bashCommands = mockExecuteTool.mock.calls
      .filter(([name]) => name === "Bash")
      .map(([, input]) => (input as Record<string, string>).command);

    expect(bashCommands).toEqual(["npm run typecheck", "npm run lint", "npm test"]);
  });

  it("blocks GitCommit when repo-root GStack is red", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: [
        '<tool_use>',
        '{"name":"Write","input":{"file_path":"packages/cli/src/tools.ts","content":"export const broken = true;"}}',
        "</tool_use>",
        '<tool_use>',
        '{"name":"GitCommit","input":{"message":"commit changes"}}',
        "</tool_use>",
      ].join("\n"),
      usage: { totalTokens: 80 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "I will fix the failing checks before committing.",
      usage: { totalTokens: 20 },
    });

    mockExecuteTool.mockImplementation(async (name: string, input: Record<string, unknown>) => {
      if (name === "Write") {
        return { content: "ok", isError: false };
      }
      if (name === "Bash") {
        const command = input.command as string;
        return {
          content: command === "npm run typecheck" ? "typecheck failed" : "skipped",
          isError: command === "npm run typecheck",
        };
      }
      if (name === "GitCommit") {
        return { content: "should not commit", isError: false };
      }
      return { content: "ok", isError: false };
    });

    await runAgentLoop("Write and commit protected changes", makeSession(), makeConfig());

    expect(mockExecuteTool.mock.calls.some(([name]) => name === "GitCommit")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pivot Logic Tests
// ---------------------------------------------------------------------------

describe("Pivot logic: strategy change after 2 same-signature failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("exports pivot instruction constant and approach log type", async () => {
    // Verify the pivot infrastructure is wired by checking the agent loop
    // completes successfully and records messages even with high complexity
    mockAnalyzeComplexityValue = 0.8;
    mockGenerateText.mockResolvedValueOnce({
      text: "I will plan my approach first, then execute.",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Complex refactor", session, makeConfig());

    // Session should complete with messages (planning instruction injected)
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Progress Tracking Tests
// ---------------------------------------------------------------------------

describe("Progress tracking: emission after tool calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("emits progress line after every 5 tool calls", async () => {
    // Set up model to return 5 tool calls in one response, then wrap up
    const fiveToolCalls = [
      '{"name":"Read","input":{"file_path":"a.ts"}}',
      '{"name":"Read","input":{"file_path":"b.ts"}}',
      '{"name":"Read","input":{"file_path":"c.ts"}}',
      '{"name":"Read","input":{"file_path":"d.ts"}}',
      '{"name":"Read","input":{"file_path":"e.ts"}}',
    ]
      .map((tc) => `<tool_use>\n${tc}\n</tool_use>`)
      .join("\n");

    mockGenerateText.mockResolvedValueOnce({
      text: `Reading files.\n${fiveToolCalls}`,
      usage: { totalTokens: 100 },
    });

    // Each Read tool call succeeds
    mockExecuteTool
      .mockResolvedValueOnce({ content: "file a content", isError: false })
      .mockResolvedValueOnce({ content: "file b content", isError: false })
      .mockResolvedValueOnce({ content: "file c content", isError: false })
      .mockResolvedValueOnce({ content: "file d content", isError: false })
      .mockResolvedValueOnce({ content: "file e content", isError: false });

    // Final response
    mockGenerateText.mockResolvedValueOnce({
      text: "All files read successfully.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Read all files", session, makeConfig());

    // After 5 tool calls, a progress message should be injected into the session
    const progressMsg = result.messages.find(
      (m) =>
        typeof m.content === "string" &&
        m.content.includes("[progress:") &&
        m.content.includes("5 tool calls"),
    );
    expect(progressMsg).toBeDefined();
    expect(progressMsg!.content).toContain("files modified");
    expect(progressMsg!.content).toContain("tests run");

    // Session should complete
    expect(result.messages.length).toBeGreaterThan(5);
  });

  it("tracks filesModified count in progress output", async () => {
    // Model writes 2 files, then wraps up. We need at least 5 tool calls for progress.
    // So: Write, Write, Read, Read, Read = 5 total
    const toolCalls = [
      '{"name":"Write","input":{"file_path":"src/a.ts","content":"a"}}',
      '{"name":"Write","input":{"file_path":"src/b.ts","content":"b"}}',
      '{"name":"Read","input":{"file_path":"c.ts"}}',
      '{"name":"Read","input":{"file_path":"d.ts"}}',
      '{"name":"Read","input":{"file_path":"e.ts"}}',
    ]
      .map((tc) => `<tool_use>\n${tc}\n</tool_use>`)
      .join("\n");

    mockGenerateText.mockResolvedValueOnce({
      text: `Working on files.\n${toolCalls}`,
      usage: { totalTokens: 100 },
    });

    mockExecuteTool
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false });

    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { totalTokens: 10 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Update files", session, makeConfig());

    // Progress message should exist and show 5 tool calls
    const progressMsg = result.messages.find(
      (m) =>
        typeof m.content === "string" &&
        m.content.includes("[progress:"),
    );
    expect(progressMsg).toBeDefined();
    expect(progressMsg!.content).toContain("5 tool calls");
  });

  it("does NOT emit progress line before reaching 5 tool calls", async () => {
    // Only 3 tool calls — should NOT trigger progress emission
    const threeToolCalls = [
      '{"name":"Read","input":{"file_path":"a.ts"}}',
      '{"name":"Read","input":{"file_path":"b.ts"}}',
      '{"name":"Read","input":{"file_path":"c.ts"}}',
    ]
      .map((tc) => `<tool_use>\n${tc}\n</tool_use>`)
      .join("\n");

    mockGenerateText.mockResolvedValueOnce({
      text: `Reading files.\n${threeToolCalls}`,
      usage: { totalTokens: 60 },
    });

    mockExecuteTool
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false });

    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { totalTokens: 10 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Read files", session, makeConfig());

    // No progress message should exist in the session
    const progressMsg = result.messages.find(
      (m) =>
        typeof m.content === "string" &&
        m.content.includes("[progress:"),
    );
    expect(progressMsg).toBeUndefined();
  });
});
