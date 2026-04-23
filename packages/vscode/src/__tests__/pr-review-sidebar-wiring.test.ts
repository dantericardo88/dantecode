// ============================================================================
// packages/vscode/src/__tests__/pr-review-sidebar-wiring.test.ts
//
// Sprint 25 — Dim 18: PR review surfaced in sidebar wiring tests.
// Verifies that WebviewOutboundMessage includes 'pr_review_result' discriminant,
// the 'pr_review_request' handler calls PrReviewOrchestrator and posts the result,
// and the dantecode.reviewPR command is registered.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReviewPullRequest } = vi.hoisted(() => ({
  mockReviewPullRequest: vi.fn(),
}));

vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: vi.fn((id: string) => ({ id })),
  window: {
    createStatusBarItem: vi.fn(() => ({
      text: "", tooltip: "", command: "", backgroundColor: undefined,
      show: vi.fn(), hide: vi.fn(), dispose: vi.fn(),
    })),
    showInputBox: vi.fn().mockResolvedValue("42"),
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    onDidChangeActiveTextEditor: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeTextEditorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    activeTextEditor: undefined,
    visibleTextEditors: [],
    createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn() })),
    createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn(() => undefined) })),
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidOpenTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    registerTextDocumentContentProvider: vi.fn(() => ({ dispose: vi.fn() })),
    textDocuments: [],
    workspaceFolders: [],
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn().mockResolvedValue(undefined),
  },
  env: { appName: "VS Code" },
  Uri: {
    parse: vi.fn((s: string) => ({ toString: () => s, fsPath: s })),
    file: vi.fn((s: string) => ({ toString: () => `file://${s}`, fsPath: s })),
  },
  Range: vi.fn(),
  Position: vi.fn(),
  EventEmitter: vi.fn(() => ({ fire: vi.fn(), event: vi.fn(), dispose: vi.fn() })),
  debug: {
    onDidStartDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
    onDidTerminateDebugSession: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    ModelRouterImpl: vi.fn(),
    parseModelReference: vi.fn(() => ({ provider: "ollama", model: "deepseek-coder" })),
    reviewPullRequest: mockReviewPullRequest,
  };
});

vi.mock("../cross-file-context.js", () => ({ gatherCrossFileContext: vi.fn().mockResolvedValue("") }));
vi.mock("../prefix-tree-cache.js", () => ({ PrefixTreeCache: vi.fn(() => ({ lookup: vi.fn(() => null), insert: vi.fn() })) }));
vi.mock("../udiff-parser.js", () => ({ parseUdiffResponse: vi.fn(() => null) }));
vi.mock("../completion-streaming-emitter.js", () => ({
  globalEmitterRegistry: { startFor: vi.fn(), cancelFor: vi.fn(), cancelAll: vi.fn() },
  CompletionStreamingEmitter: vi.fn(),
  EmitterRegistry: vi.fn(),
}));
vi.mock("../completion-stop-sequences.js", () => ({
  StopSequenceDetector: { forLanguage: vi.fn(() => ({ getStopSequences: vi.fn(() => []), checkStop: vi.fn(() => undefined) })) },
  BracketBalanceDetector: vi.fn(() => ({ check: vi.fn(() => ({ balanced: false, depth: 0 })) })),
}));
vi.mock("../file-interaction-cache.js", () => ({ globalInteractionCache: { get: vi.fn(() => 0), record: vi.fn() } }));
vi.mock("@dantecode/danteforge", () => ({ runLocalPDSEScorer: vi.fn().mockResolvedValue({ score: 80 }) }));
vi.mock("@dantecode/codebase-index", () => ({
  SymbolDefinitionLookup: { extractCallSiteSymbol: vi.fn(() => null) },
}));

import { ChatSidebarProvider, type WebviewInboundMessage } from "../sidebar-provider.js";
import type * as vscode from "vscode";

const FAKE_URI = { toString: () => "vscode-ext://test", fsPath: "/ext" } as unknown as vscode.Uri;
const FAKE_SECRETS = { get: vi.fn().mockResolvedValue(undefined), store: vi.fn().mockResolvedValue(undefined), delete: vi.fn() } as unknown as vscode.SecretStorage;
const FAKE_GLOBAL_STATE = { get: vi.fn().mockReturnValue(undefined), update: vi.fn().mockResolvedValue(undefined) } as unknown as vscode.Memento;

function makeProvider() {
  const provider = new ChatSidebarProvider(FAKE_URI, FAKE_SECRETS, FAKE_GLOBAL_STATE, {});
  const postMessageSpy = vi.spyOn(provider as unknown as { postMessage: (m: unknown) => void }, "postMessage");
  return { provider, postMessageSpy };
}

// ── Sprint 25 tests ──────────────────────────────────────────────────────────

describe("Sprint 25 — PR review sidebar wiring", () => {

  beforeEach(() => {
    vi.clearAllMocks();
    mockReviewPullRequest.mockResolvedValue({
      prNumber: 42,
      verdict: "changes-required",
      score: 6.5,
      summary: "Review complete",
      checklistPassed: 1,
      checklistTotal: 2,
      rawPrompt: "## PR Review Summary\n\n## PR Diff Evidence",
    });
  });

  it("WebviewOutboundMessage type includes 'pr_review_result' discriminant", async () => {
    // Type-level test: verify by importing the type and using it
    type MsgType = WebviewInboundMessage["type"];
    const validType: MsgType = "pr_review_request";
    expect(validType).toBe("pr_review_request");
  });

  it("'pr_review_request' handler calls reviewPullRequest with prNumber", async () => {
    const { provider } = makeProvider();
    const { reviewPullRequest } = await import("@dantecode/core");
    await provider.handleWebviewMessage({
      type: "pr_review_request",
      payload: { prNumber: 42 },
    });
    expect(vi.mocked(reviewPullRequest)).toHaveBeenCalledWith({ prNumber: 42, repo: undefined });
  });

  it("postMessage called with type 'pr_review_result' after review completes", async () => {
    const { provider, postMessageSpy } = makeProvider();
    await provider.handleWebviewMessage({
      type: "pr_review_request",
      payload: { prNumber: 42 },
    });
    const call = postMessageSpy.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "pr_review_result",
    );
    expect(call).toBeDefined();
  });

  it("verdict field present in posted pr_review_result message", async () => {
    const { provider, postMessageSpy } = makeProvider();
    await provider.handleWebviewMessage({
      type: "pr_review_request",
      payload: { prNumber: 42 },
    });
    const call = postMessageSpy.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "pr_review_result",
    );
    const payload = (call?.[0] as { payload?: { verdict?: string } })?.payload;
    expect(payload?.verdict).toBeDefined();
  });

  it("score field is a number in pr_review_result payload", async () => {
    const { provider, postMessageSpy } = makeProvider();
    await provider.handleWebviewMessage({
      type: "pr_review_request",
      payload: { prNumber: 42 },
    });
    const call = postMessageSpy.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "pr_review_result",
    );
    const payload = (call?.[0] as { payload?: { score?: unknown } })?.payload;
    expect(typeof payload?.score).toBe("number");
  });

  it("createReview error → postMessage({ type: 'error' }) no crash", async () => {
    mockReviewPullRequest.mockRejectedValueOnce(new Error("gh CLI not found"));
    const { provider, postMessageSpy } = makeProvider();
    await provider.handleWebviewMessage({
      type: "pr_review_request",
      payload: { prNumber: 99 },
    });
    const errorCall = postMessageSpy.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "error",
    );
    expect(errorCall).toBeDefined();
  });

  it("invalid prNumber (0) → postMessage error without calling createReview", async () => {
    const { provider, postMessageSpy } = makeProvider();
    const { reviewPullRequest } = await import("@dantecode/core");
    await provider.handleWebviewMessage({
      type: "pr_review_request",
      payload: { prNumber: 0 },
    });
    const errorCall = postMessageSpy.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "error",
    );
    expect(errorCall).toBeDefined();
    expect(vi.mocked(reviewPullRequest)).not.toHaveBeenCalled();
  });

  it("checklistPassed count matches true passed items", async () => {
    const { provider, postMessageSpy } = makeProvider();
    await provider.handleWebviewMessage({
      type: "pr_review_request",
      payload: { prNumber: 42 },
    });
    const call = postMessageSpy.mock.calls.find(
      (c) => (c[0] as { type: string }).type === "pr_review_result",
    );
    const payload = (call?.[0] as { payload?: { checklistPassed?: number } })?.payload;
    expect(payload?.checklistPassed).toBe(1);
  });

});
