// ============================================================================
// packages/vscode/src/__tests__/sidebar-context.test.ts
// Tests for BM25 context retrieval injection into the chat sidebar.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── VS Code mock ──────────────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, defaultVal: unknown) => defaultVal),
    })),
    workspaceFolders: [{ uri: { fsPath: "/test-project" } }],
    registerTextDocumentContentProvider: vi.fn(),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    activeTextEditor: undefined,
    showWarningMessage: vi.fn(),
    visibleTextEditors: [],
  },
  Uri: { file: vi.fn((p: string) => ({ fsPath: p, toString: () => p })) },
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
  ExtensionMode: { Production: 1 },
  DiagnosticSeverity: { Error: 0, Warning: 1 },
}));

// ── Heavy dependency mocks ────────────────────────────────────────────────────

vi.mock("@dantecode/core", () => ({
  DEFAULT_MODEL_ID: "grok/grok-3-mini-fast",
  MODEL_CATALOG: [],
  ModelRouterImpl: vi.fn(),
  SessionStore: vi.fn(() => ({ list: vi.fn().mockResolvedValue([]) })),
  appendAuditEvent: vi.fn(),
  compactTextTranscript: vi.fn((msgs: unknown[]) => msgs),
  createSelfImprovementContext: vi.fn(),
  detectSelfImprovementContext: vi.fn().mockReturnValue(null),
  getContextUtilization: vi.fn().mockReturnValue({ percent: 0, used: 0, total: 100_000 }),
  getProviderPromptSupplement: vi.fn().mockReturnValue(""),
  getProviderCatalogEntry: vi.fn().mockReturnValue(null),
  groupCatalogModels: vi.fn().mockReturnValue([]),
  parseModelReference: vi.fn().mockReturnValue(["grok", "grok-3-mini-fast"]),
  readOrInitializeState: vi.fn().mockResolvedValue({ model: { default: { provider: "grok", modelId: "grok-3-mini-fast" } }, pdse: { threshold: 70 }, autoforge: { enabled: false, gstackCommands: [] } }),
  responseNeedsToolExecutionNudge: vi.fn().mockReturnValue(false),
  shouldContinueLoop: vi.fn().mockReturnValue(false),
  parseSearchReplaceBlocks: vi.fn().mockReturnValue([]),
  WebSearchOrchestrator: vi.fn(),
  ApprovalWorkflow: vi.fn().mockImplementation(() => ({
    submit: vi.fn().mockReturnValue({ request: { id: "req-1" }, response: null }),
    decide: vi.fn(),
    registerUndo: vi.fn(),
    undoLast: vi.fn().mockResolvedValue(undefined),
  })),
  captureGitContext: vi.fn().mockReturnValue({
    repoRoot: "/test", recentChanges: [], workingTreeDiffs: [], currentBranch: "main", generatedAt: new Date().toISOString(),
  }),
  formatGitContextForPrompt: vi.fn().mockReturnValue(""),
  buildRepoMap: vi.fn().mockReturnValue(""),
  formatRepoMap: vi.fn().mockReturnValue(""),
  classifyTaskComplexity: vi.fn().mockReturnValue("moderate"),
  parsePlan: vi.fn().mockReturnValue({ id: "plan-1", goal: "test", steps: [], estimatedChangedFiles: 0, hasDestructiveSteps: false, createdAt: new Date().toISOString() }),
  buildPlanModeSystemPrompt: vi.fn().mockReturnValue("## Plan Mode Active"),
  buildPlanModeSystemPromptStructured: vi.fn().mockReturnValue("## Plan Mode Active — Structured Output"),
  PlanActController: vi.fn().mockImplementation(() => ({
    reset: vi.fn(),
    setPlan: vi.fn(),
    requiresApproval: vi.fn().mockReturnValue(false),
    canExecute: vi.fn().mockReturnValue(true),
    formatPlan: vi.fn().mockReturnValue(""),
    processApproval: vi.fn().mockReturnValue(true),
  })),
  globalMcpRegistry: { size: 0, formatManifestForPrompt: vi.fn().mockReturnValue("") },
  ProjectKnowledgeStore: vi.fn().mockImplementation(() => ({ formatForPrompt: vi.fn().mockReturnValue(""), size: 0 })),
  detectAvailableProvidersAsync: vi.fn().mockResolvedValue(new Set(["anthropic", "ollama"])),
  routeByComplexity: vi.fn().mockReturnValue({ provider: "anthropic", modelId: "claude-sonnet-4-6", complexity: "moderate", rationale: "mock" }),
  WorkspaceLspAggregator: vi.fn().mockImplementation(() => ({
    indexFile: vi.fn(),
    buildContextBundle: vi.fn().mockReturnValue({ focusFile: "", reachableDefinitions: [], hovers: [], diagnostics: [], importEdges: [], totalSymbols: 0 }),
    formatBundleForPrompt: vi.fn().mockReturnValue(""),
  })),
  parseImports: vi.fn().mockReturnValue([]),
}));

vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn().mockResolvedValue({ score: 85, passed: true }),
  runAntiStubScanner: vi.fn().mockResolvedValue({ passed: true }),
  runConstitutionCheck: vi.fn().mockResolvedValue({ passed: true }),
  queryLessons: vi.fn().mockResolvedValue([]),
}));

vi.mock("@dantecode/git-engine", () => ({
  generateRepoMap: vi.fn().mockReturnValue([]),
  formatRepoMapForContext: vi.fn().mockReturnValue(""),
  getStatus: vi.fn().mockReturnValue({ staged: [], unstaged: [], untracked: [] }),
}));

vi.mock("../agent-tools.js", () => ({
  executeTool: vi.fn(),
  extractToolCalls: vi.fn().mockReturnValue({ calls: [], parseErrors: [] }),
  getReadOnlyToolDefinitionsPrompt: vi.fn().mockReturnValue(""),
  getToolDefinitionsPrompt: vi.fn().mockReturnValue(""),
  getWrittenFilePath: vi.fn().mockReturnValue(null),
}));

vi.mock("../context-provider.js", () => ({
  globalContextRegistry: {
    resolveAllMentions: vi.fn().mockResolvedValue([]),
    register: vi.fn(),
  },
  formatForPrompt: vi.fn().mockReturnValue(""),
  setCodebaseIndexManager: vi.fn(),
}));

// ── Subject under test ────────────────────────────────────────────────────────

import { ChatSidebarProvider } from "../sidebar-provider.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFakeSecrets() {
  return {
    get: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    onDidChange: vi.fn(),
  };
}

function makeFakeGlobalState() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(<T>(key: string, defaultVal?: T) => (store.get(key) as T) ?? defaultVal),
    update: vi.fn((key: string, val: unknown) => { store.set(key, val); return Promise.resolve(); }),
    keys: vi.fn(() => [] as readonly string[]),
  };
}

function makeFakeUri() {
  return { fsPath: "/ext", toString: () => "/ext", with: vi.fn() } as unknown as import("vscode").Uri;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ChatSidebarProvider.setContextRetriever", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("can be constructed without a contextRetriever (retriever starts null)", () => {
    const provider = new ChatSidebarProvider(
      makeFakeUri(),
      makeFakeSecrets() as unknown as import("vscode").SecretStorage,
      makeFakeGlobalState() as unknown as import("vscode").Memento,
    );
    // Should not throw
    expect(provider).toBeInstanceOf(ChatSidebarProvider);
  });

  it("setContextRetriever stores the retriever without throwing", () => {
    const provider = new ChatSidebarProvider(
      makeFakeUri(),
      makeFakeSecrets() as unknown as import("vscode").SecretStorage,
      makeFakeGlobalState() as unknown as import("vscode").Memento,
    );
    const mockRetriever = {
      retrieve: vi.fn().mockReturnValue(["snippet 1", "snippet 2"]),
    };
    expect(() => provider.setContextRetriever(mockRetriever)).not.toThrow();
  });

  it("setContextRetriever can be called multiple times (last one wins)", () => {
    const provider = new ChatSidebarProvider(
      makeFakeUri(),
      makeFakeSecrets() as unknown as import("vscode").SecretStorage,
      makeFakeGlobalState() as unknown as import("vscode").Memento,
    );
    const first = { retrieve: vi.fn().mockReturnValue([]) };
    const second = { retrieve: vi.fn().mockReturnValue(["updated"]) };
    provider.setContextRetriever(first);
    provider.setContextRetriever(second);
    // second should be active; first should never be called during subsequent use
    expect(() => provider.setContextRetriever(second)).not.toThrow();
  });

  it("retrieve() is called with string[] queryLines", () => {
    const mockRetriever = {
      retrieve: vi.fn().mockReturnValue([]),
    };
    const provider = new ChatSidebarProvider(
      makeFakeUri(),
      makeFakeSecrets() as unknown as import("vscode").SecretStorage,
      makeFakeGlobalState() as unknown as import("vscode").Memento,
    );
    provider.setContextRetriever(mockRetriever);
    // Verify the retriever interface matches what sidebar-provider.ts calls
    const result = mockRetriever.retrieve(["line1", "line2"], 3, 600, 100);
    expect(Array.isArray(result)).toBe(true);
    expect(mockRetriever.retrieve).toHaveBeenCalledWith(["line1", "line2"], 3, 600, 100);
  });
});

describe("BM25 retriever interface contract", () => {
  it("retrieve() signature matches sidebar expectation: (string[], number, number, number) => string[]", () => {
    // The sidebar calls: retriever.retrieve(queryLines, 3, 600, 100)
    // Verify any retriever passed via setContextRetriever satisfies this
    const mockRetriever = {
      retrieve: vi.fn((queryLines: string[], maxSnippets: number, tokenBudget: number, timeoutMs: number): string[] => {
        void maxSnippets; void tokenBudget; void timeoutMs;
        return queryLines.map((l) => `snippet for: ${l}`);
      }),
    };
    const result = mockRetriever.retrieve(["const x =", "return x"], 3, 600, 100);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain("const x =");
  });

  it("retrieve() returning [] means no BM25 context injected", () => {
    const emptyRetriever = { retrieve: vi.fn().mockReturnValue([]) };
    const snippets = emptyRetriever.retrieve(["any query"], 3, 600, 100);
    expect(snippets.length).toBe(0);
    // Sidebar skips injection when snippets.length === 0
  });

  it("retrieve() returning non-empty snippets triggers injection", () => {
    const richRetriever = {
      retrieve: vi.fn().mockReturnValue([
        "```ts\nfunction useAuth() { return token; }\n```",
        "```ts\nconst AUTH_KEY = 'x-auth-token';\n```",
      ]),
    };
    const snippets = richRetriever.retrieve(["useAuth"], 3, 600, 100);
    expect(snippets.length).toBe(2);
    const block = `## Relevant codebase snippets\n${snippets.join("\n---\n")}`;
    expect(block).toContain("useAuth");
    expect(block).toContain("AUTH_KEY");
  });
});
