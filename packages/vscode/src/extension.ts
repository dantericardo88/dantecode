// ============================================================================
// DanteCode VS Code Extension — Main Entry Point
// Registers providers, status bar, diagnostics, and all commands.
// ============================================================================

import * as vscode from "vscode";
import * as path from "path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { DEFAULT_MODEL_ID, MODEL_CATALOG, detectInstallContext, setEditQualityOutputHook } from "@dantecode/core";

import { ChatSidebarProvider } from "./sidebar-provider.js";
import { AuditPanelProvider } from "./audit-panel-provider.js";
import { DanteCodeCompletionProvider, disposeInlinePDSEDiagnostics } from "./inline-completion.js";
import { globalEmitterRegistry } from "./completion-streaming-emitter.js";
import { CompletionTelemetryService } from "@dantecode/core";
import { CompletionAcceptanceTracker } from "./completion-acceptance-tracker.js";
import { CompletionContextRetriever } from "./completion-context-retriever.js";
import { FimModelRouter } from "./fim-model-router.js";
import { FimLatencyTracker } from "./fim-latency-tracker.js";
import { EditHistoryTracker } from "./edit-history-tracker.js";
import { NextEditPredictor } from "./next-edit-predictor.js";
import { TestFrameworkDetector } from "./test-framework-detector.js";
import {
  createStatusBar,
  updateStatusBar,
  updateStatusBarInfo,
  updateSandboxStatus,
  updateStatusBarWithCost,
  setIndexState,
  createCircuitBreakerBar,
  updateCircuitBreakerBar,
  type StatusBarState,
} from "./status-bar.js";
import { PDSEDiagnosticProvider } from "./diagnostics.js";
import { OnboardingProvider } from "./onboarding-provider.js";
import { PreviewPanelProvider } from "./preview-panel-provider.js";
import { RepoMapTreeDataProvider } from "./repo-map-tree-provider.js";
import { CheckpointManager } from "./checkpoint-manager.js";
import { DiffReviewProvider, type PendingDiffReview } from "./diff-review-provider.js";
import { DanteCodeLensProvider } from "./codelens-provider.js";
import { DanteCodeQuickFixProvider } from "./quick-fix-provider.js";
import { InlineEditProvider } from "./inline-edit-provider.js";
import { globalContextRegistry, setCodebaseIndexManager, type ContextItem } from "./context-provider.js";
import { CodebaseIndexManager } from "./codebase-index-manager.js";
import { StreamingDiffProvider } from "./streaming-diff-provider.js";
import { TerminalOutputManager } from "./terminal-output-manager.js";
import { DebugAttachProvider } from "./debug-attach-provider.js";
import { HOVER_PROVIDER, DEFINITION_PROVIDER, REFERENCES_PROVIDER, SYMBOL_PROVIDER, TYPES_PROVIDER } from "./lsp-context-provider.js";
import { CurrentFileProvider, OpenFilesProvider, ProblemsProvider, UrlProvider } from "./context-providers/index.js";
import { LspDiagnosticsInjector } from "./lsp-diagnostics-injector.js";
import { globalCoreRegistry } from "@dantecode/core";
import {
  createTestDecorationManager,
  parseVitestResults,
  type TestDecorationManager,
} from "./test-decoration-manager.js";

// ─── Module-Level State ──────────────────────────────────────────────────────

export let testDecoManager: TestDecorationManager | undefined;
let statusBarState: StatusBarState | undefined;
let chatSidebarProvider: ChatSidebarProvider | undefined;
let auditPanelProvider: AuditPanelProvider | undefined;
let completionProvider: DanteCodeCompletionProvider | undefined;
let diagnosticProvider: PDSEDiagnosticProvider | undefined;
/** Live as-you-type diagnostic collection — DanteCode layer (dim 2) */
let danteDiagnostics: vscode.DiagnosticCollection | undefined;
let onboardingProvider: OnboardingProvider | undefined;
let checkpointManager: CheckpointManager | undefined;
let diffReviewProvider: DiffReviewProvider | undefined;
let codeLensProvider: DanteCodeLensProvider | undefined;
let inlineEditProvider: InlineEditProvider | undefined;
let codebaseIndexManager: CodebaseIndexManager | undefined;
let streamingDiffProvider: StreamingDiffProvider | undefined;
let completionTelemetry: CompletionTelemetryService | undefined;
let completionAcceptanceTracker: CompletionAcceptanceTracker | undefined;
let fimModelRouter: FimModelRouter | undefined;
/** Active dev server port for auto-refresh on save (dim 14). 0 = no active server. */
let activePreviewPort = 0;
/** Debounce timer for preview auto-refresh. */
let previewRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let fimLatencyTracker: FimLatencyTracker | undefined;
let editHistoryTracker: EditHistoryTracker | undefined;
let nextEditPredictor: NextEditPredictor | undefined;
let testFrameworkDetector: TestFrameworkDetector | undefined;
let terminalOutputManager: TerminalOutputManager | undefined;
/** Output channel — populated during activate(), used for FIM latency + SSO reporting. */
let danteOutputChannel: vscode.OutputChannel | undefined;

/** Tracks the last diff hunk file path for accept/reject commands. */
let pendingDiffFilePath: string | undefined;
let pendingDiffNewContent: string | undefined;
let pendingDiffOldContent: string | undefined;
/** Stores per-file review comments added via "Approve with comments" workflow (dim 13). */
let pendingReviewComments: Array<{ file: string; comment: string }> = [];
/** Returns the latest per-file review comments for injection into agent context. */
export function getPendingReviewComments(): Array<{ file: string; comment: string }> {
  return pendingReviewComments;
}

// ─── Activate ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Diagnostic: log activation entry/exit so we can tell from the bypass log
  // whether activation is firing, succeeding, or crashing partway through.
  // If the chat panel is blank, the answer is in this log.
  try {
    const fs = require("fs") as typeof import("fs");
    fs.appendFileSync(
      "C:/tmp/dante-bypass.log",
      `[${new Date().toISOString()}] activate() ENTERED\n`,
    );
  } catch { /* ignore */ }
  try {
    activateInner(context);
    try {
      const fs = require("fs") as typeof import("fs");
      fs.appendFileSync(
        "C:/tmp/dante-bypass.log",
        `[${new Date().toISOString()}] activate() COMPLETED\n`,
      );
    } catch { /* ignore */ }
  } catch (activationErr) {
    const msg = activationErr instanceof Error ? activationErr.message : String(activationErr);
    const stack = activationErr instanceof Error ? activationErr.stack ?? "" : "";
    try {
      const fs = require("fs") as typeof import("fs");
      fs.appendFileSync(
        "C:/tmp/dante-bypass.log",
        `[${new Date().toISOString()}] activate() THREW: ${msg}\n${stack}\n`,
      );
    } catch { /* ignore */ }
    void vscode.window.showErrorMessage(
      `DanteCode activation failed: ${msg}. Check C:/tmp/dante-bypass.log for the stack trace.`,
    );
    // Re-throw so the host knows activation failed (otherwise it thinks we're alive
    // and the chat view sits blank forever).
    throw activationErr;
  }
}

function activateInner(context: vscode.ExtensionContext): void {
  const extensionUri = context.extensionUri;

  // ── Reload-notification infrastructure ──
  // On fresh activation (after a reload), silently delete any pending marker so the
  // file watcher below doesn't fire again in the same window session.
  const _reloadMarker = path.join(extensionUri.fsPath, "dist", "RELOAD_NEEDED");
  if (existsSync(_reloadMarker)) {
    try { unlinkSync(_reloadMarker); } catch { /* ignore */ }
  }
  // Watch for the marker file that deploy-local.mjs creates after each build.
  // Fires while the OLD extension is running — prompts the user to reload.
  const _reloadWatcher = vscode.workspace.createFileSystemWatcher(_reloadMarker);
  _reloadWatcher.onDidCreate(() => {
    vscode.window.showInformationMessage(
      "DanteCode was rebuilt. Reload window to activate the latest fixes.",
      "Reload Now"
    ).then((sel) => {
      if (sel === "Reload Now") {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    });
  });
  context.subscriptions.push(_reloadWatcher);

  // ── Repo map tree ──
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  if (projectRoot) {
    checkpointManager = new CheckpointManager(projectRoot);
    diffReviewProvider = new DiffReviewProvider(projectRoot);
    const treeProvider = new RepoMapTreeDataProvider(projectRoot);
    const repoTree = vscode.window.createTreeView("dantecode.repoMap", {
      treeDataProvider: treeProvider,
    });
    context.subscriptions.push(repoTree);
  }

  // ── Sidebar providers ──
  chatSidebarProvider = new ChatSidebarProvider(
    extensionUri,
    context.secrets,
    context.globalState,
    {
      onCostUpdate: ({ model, modelTier, sessionTotalUsd }) => {
        if (!statusBarState) {
          return;
        }

        updateStatusBar(statusBarState, model, statusBarState.gateStatus);
        updateStatusBarWithCost(statusBarState, modelTier, sessionTotalUsd);
      },
      onDiffReview: ({ filePath, oldContent, newContent }) => {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const resolvedPath =
          workspaceRoot && !path.isAbsolute(filePath)
            ? path.resolve(workspaceRoot, filePath)
            : filePath;
        setPendingDiff(resolvedPath, oldContent, newContent);
      },
      onModelChange: (model) => {
        if (statusBarState) {
          updateStatusBar(statusBarState, model, statusBarState.gateStatus);
        }
      },
      onStatusBarUpdate: (info) => {
        if (statusBarState) {
          updateStatusBarInfo(statusBarState, info);
        }
      },
      onCircuitStateChange: (isOpen) => {
        updateCircuitBreakerBar(isOpen);
      },
    },
  );
  const chatViewRegistration = vscode.window.registerWebviewViewProvider(
    ChatSidebarProvider.viewType,
    chatSidebarProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(chatViewRegistration);

  auditPanelProvider = new AuditPanelProvider(extensionUri);
  const auditViewRegistration = vscode.window.registerWebviewViewProvider(
    AuditPanelProvider.viewType,
    auditPanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(auditViewRegistration);

  // ── Completion telemetry + acceptance tracking ──
  completionTelemetry = new CompletionTelemetryService(
    path.join(context.globalStorageUri.fsPath, "telemetry"),
  );
  completionAcceptanceTracker = new CompletionAcceptanceTracker(completionTelemetry);
  context.subscriptions.push(completionAcceptanceTracker);

  // ── FIM model router (connection reuse + Ollama auto-detect) ──
  const config = vscode.workspace.getConfiguration("dantecode");
  fimModelRouter = new FimModelRouter();
  fimModelRouter.startHealthProbe({
    ollamaUrl: config.get<string>("fimOllamaUrl", "http://localhost:11434"),
    localModel: config.get<string>("fimLocalModel", ""),
    autoDetect: config.get<boolean>("fimOllamaAutoDetect", true),
  });

  // ── FIM latency tracker (p50/p95 status bar) ──
  fimLatencyTracker = new FimLatencyTracker(completionTelemetry);

  // ── Next-Edit Prediction (edit history ring + heuristic predictor) ──
  editHistoryTracker = new EditHistoryTracker(50);
  nextEditPredictor = new NextEditPredictor(editHistoryTracker);

  // ── Test framework detector (framework detection + test file finder) ──
  testFrameworkDetector = new TestFrameworkDetector();

  // ── BM25 context retriever (wired to codebase index if available) ──
  const contextRetriever = new CompletionContextRetriever(() => {
    if (!codebaseIndexManager) return [];
    return codebaseIndexManager.getChunks();
  });

  // Wire BM25 into sidebar chat — same retriever used by inline-completion
  chatSidebarProvider?.setContextRetriever(contextRetriever);

  // ── LSP diagnostics injector (wires real-time errors/warnings into FIM context + sidebar chat) ──
  const lspDiagnosticsInjector = new LspDiagnosticsInjector(vscode);
  // Wire into sidebar chat so the model sees live errors/warnings on every request (dim 2)
  chatSidebarProvider?.setLspInjector(lspDiagnosticsInjector);

  // ── Inline completion ──
  completionProvider = new DanteCodeCompletionProvider(context, {
    acceptanceTracker: completionAcceptanceTracker,
    telemetry: completionTelemetry,
    contextRetriever,
    fimModelRouter,
    latencyTracker: fimLatencyTracker,
    nextEditPredictor,
    codebaseIndexManager: codebaseIndexManager ?? undefined,
    lspInjector: lspDiagnosticsInjector,
  });
  const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    completionProvider,
  );
  context.subscriptions.push(completionRegistration);

  // Track recently-edited files for completion context injection
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme === "file") {
        completionProvider?.recordRecentEdit(e.document.uri.fsPath);
      }
    }),
  );

  // ── Real-time DanteCode diagnostics — as-you-type underlines (dim 2) ──
  // 300ms debounce mirrors VS Code's own TS pull-diagnostic cadence.
  // Forwards error-level LSP diagnostics into a named DanteCode collection so
  // the user sees "[DC]" tagged squiggles driven by the workspace TS server.
  danteDiagnostics = vscode.languages.createDiagnosticCollection("dantecode-live");
  context.subscriptions.push(danteDiagnostics);
  {
    let diagDebounce: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.scheme !== "file") return;
        if (!/\.(ts|tsx|js|jsx|py)$/.test(e.document.fileName)) return;
        clearTimeout(diagDebounce);
        diagDebounce = setTimeout(() => {
          try {
            const existing = vscode.languages.getDiagnostics(e.document.uri);
            const errors = existing
              .filter((d) => d.severity === vscode.DiagnosticSeverity.Error)
              .map(
                (d) =>
                  new vscode.Diagnostic(
                    d.range,
                    `[DC] ${d.message}`,
                    vscode.DiagnosticSeverity.Error,
                  ),
              );
            danteDiagnostics!.set(e.document.uri, errors.length > 0 ? errors : []);
          } catch {
            /* non-fatal — diagnostic refresh is best-effort */
          }
        }, 300);
      }),
    );
  }

  // Internal acceptance tracking command (fired by InlineCompletionItem.command)
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode._internalTrackAccept", (completionId: string) => {
      completionAcceptanceTracker?.trackAccepted(completionId);
    }),
  );

  // ── Status bar ──
  statusBarState = createStatusBar(context);
  updateStatusBar(statusBarState, DEFAULT_MODEL_ID, "none");

  // ── Circuit breaker status bar indicator (dim 24) ──
  createCircuitBreakerBar(context);

  // ── Diagnostics ──
  diagnosticProvider = new PDSEDiagnosticProvider();
  context.subscriptions.push(diagnosticProvider);

  // ── CodeLens provider ──
  {
    codeLensProvider = new DanteCodeLensProvider();
    context.subscriptions.push(
      vscode.languages.registerCodeLensProvider(
        ["typescript", "javascript", "typescriptreact", "javascriptreact", "python", "go"],
        codeLensProvider,
      ),
      // Refresh code lenses when the document changes
      vscode.workspace.onDidChangeTextDocument(() => {
        codeLensProvider?.scheduleRefresh();
      }),
    );
  }

  // ── Quick Fix provider ──
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      ["typescript", "javascript", "typescriptreact", "javascriptreact"],
      new DanteCodeQuickFixProvider(),
      { providedCodeActionKinds: DanteCodeQuickFixProvider.providedCodeActionKinds },
    ),
  );

  // ── Inline Edit provider (Cmd+I / Ctrl+I) ──
  inlineEditProvider = new InlineEditProvider(
    context,
    checkpointManager,
    async (system, user) => {
      // Use ModelRouterImpl to call the model — same as the chat sidebar.
      const modelId = vscode.workspace
        .getConfiguration("dantecode")
        .get<string>("defaultModel") ?? "claude-sonnet-4-6";
      const { ModelRouterImpl } = await import("@dantecode/core");
      const modelConfig = { provider: "anthropic" as const, modelId, maxTokens: 4096, temperature: 0.1, contextWindow: 200000, supportsVision: false, supportsToolCalls: false };
      const routerConfig = { default: modelConfig, fallback: [], overrides: {} as Record<string, typeof modelConfig> };
      const router = new ModelRouterImpl(routerConfig, projectRoot ?? "", "inline-edit");
      return router.generate(
        [{ role: "user" as const, content: user }],
        { system, maxTokens: 4096 },
      );
    },
  );
  context.subscriptions.push(...inlineEditProvider.activate());

  // ── Context providers: VS Code-specific (@terminal, @selection) ──
  // Note: @problems is now handled by ProblemsProvider (Machine 2)

  globalContextRegistry.register({
    name: "selection",
    trigger: "@selection",
    description: "Inject currently selected text",
    async resolve(_query, _workspace) {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        return [{ type: "selection", label: "@selection", content: "(no selection)" }];
      }
      const text = editor.document.getText(editor.selection);
      const file = path.basename(editor.document.uri.fsPath);
      const startLine = editor.selection.start.line + 1;
      const endLine = editor.selection.end.line + 1;
      return [{
        type: "selection",
        label: "@selection",
        content: `\`\`\`\n// ${file}:${startLine}-${endLine}\n${text}\n\`\`\``,
        uri: editor.document.uri.fsPath,
      }];
    },
  });

  // ── Terminal output capture ───────────────────────────────────────────────
  terminalOutputManager = new TerminalOutputManager();
  // onDidWriteTerminalData is a PROPOSED API (terminalDataWriteEvent). The
  // function exists in Antigravity/VSCode but CALLING it throws unless the
  // extension declares the proposal in package.json#enabledApiProposals AND
  // the editor was launched with --enable-proposed-api dantecode.dantecode.
  // We don't want to require the user to launch with that flag, so wrap the
  // call in try/catch — terminal-output capture is a nice-to-have, not core.
  // This regression has happened before (memory: "terminal API try/catch"
  // was a documented activation-blocker fix).
  try {
    const windowAny = vscode.window as unknown as Record<string, unknown>;
    if (typeof windowAny["onDidWriteTerminalData"] === "function") {
      const onData = windowAny["onDidWriteTerminalData"] as (
        handler: (e: { terminal: { name: string }; data: string }) => void,
      ) => vscode.Disposable;
      context.subscriptions.push(
        onData((e) => terminalOutputManager!.onData(e)),
      );
    }
  } catch (terminalApiErr) {
    // Proposed-API not enabled. Log and continue — the rest of the extension
    // works fine without terminal-output capture.
    try {
      const fs = require("fs") as typeof import("fs");
      fs.appendFileSync(
        "C:/tmp/dante-bypass.log",
        `[${new Date().toISOString()}] terminal-data API unavailable (proposal not enabled): ${String(terminalApiErr)}\n`,
      );
    } catch { /* ignore */ }
  }

  globalContextRegistry.register({
    name: "terminal",
    trigger: "@terminal",
    description: "Inject last terminal output into context",
    async resolve(_query, _workspace) {
      const terminal = vscode.window.activeTerminal ?? vscode.window.terminals[0];
      if (!terminal) {
        return [{ type: "terminal", label: "@terminal", content: "(no terminal open)" }];
      }
      const output = terminalOutputManager!.getBuffer(terminal.name);
      if (!output) {
        return [{
          type: "terminal" as const,
          label: "@terminal",
          content: `(${terminal.name}: no output captured yet — run a command first)`,
        }];
      }
      return [{
        type: "terminal" as const,
        label: `@terminal:${terminal.name}`,
        content: `\`\`\`\n${output.slice(-2_000)}\n\`\`\``,
      }];
    },
  });

  // Wire terminal manager into sidebar for test-failure auto-fix
  chatSidebarProvider?.setTerminalOutputManager(terminalOutputManager);

  // ── Codebase index manager + @codebase context provider ─────────────────────
  if (projectRoot) {
    codebaseIndexManager = new CodebaseIndexManager(projectRoot);
    setCodebaseIndexManager(codebaseIndexManager);

    globalContextRegistry.register({
      name: "codebase",
      trigger: "@codebase",
      description: "Semantic search across the entire codebase",
      async resolve(query: string, _workspace: string): Promise<ContextItem[]> {
        if (!codebaseIndexManager) return [];
        const raw = await codebaseIndexManager.search(query || "");
        const chunks = raw as Array<{
          filePath: string;
          startLine: number;
          endLine: number;
          content: string;
          symbols: string[];
        }>;
        return [
          {
            type: "codebase",
            label: `@codebase:${query || ""}`,
            content:
              chunks.length === 0
                ? "(codebase index not ready — will be available shortly)"
                : formatChunks(chunks),
          },
        ];
      },
    });

    // Background index build — non-blocking; activate() returns immediately
    void codebaseIndexManager.initialize();

    // Pre-embed corpus for semantic retrieval warmup — Tabby pattern (dim 3+4)
    // After warmup, report FIM P50 latency to output channel (dim 1).
    // danteOutputChannel is populated after this block — captured via closure.
    void contextRetriever.warmup(projectRoot).then(() => {
      const p50 = fimLatencyTracker?.reportP50(danteOutputChannel ?? undefined);
      void p50; // value surfaced via outputChannel.appendLine
    }).catch(() => {});

    // ── Test decoration manager — gutter icons for pass/fail (dim 19) ──
    testDecoManager = createTestDecorationManager();
    context.subscriptions.push({ dispose: () => testDecoManager?.dispose() });

    // Incremental reindex on file save (300ms debounced inside manager)
    // Also apply test decorations when vitest results file is present (dim 19)
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (doc.uri.scheme === "file") {
          codebaseIndexManager?.onFileSaved(doc.uri.fsPath);
          // Apply test gutter decorations for TS/JS source files on save
          if (/\.(ts|tsx|js|jsx)$/.test(doc.fileName)) {
            const resultsPath = path.join(projectRoot, ".dantecode", "test-results.json");
            try {
              const raw = await readFile(resultsPath, "utf8");
              testDecoManager?.apply(parseVitestResults(raw));
            } catch {
              // No results file yet — silently skip
            }
          }
          // Dim 14 — auto-refresh preview panel on relevant file saves (debounced 300ms)
          if (activePreviewPort > 0 && /\.(ts|tsx|js|jsx|css|html)$/.test(doc.fileName)) {
            if (previewRefreshTimer) clearTimeout(previewRefreshTimer);
            previewRefreshTimer = setTimeout(() => {
              PreviewPanelProvider.refresh(activePreviewPort);
              previewRefreshTimer = null;
            }, 300);
          }
        }
      }),
    );

    // Status bar: reflect index state
    if (statusBarState) {
      codebaseIndexManager.onStateChange((state, count) => {
        setIndexState(
          statusBarState!,
          state === "indexing" ? "indexing" : state === "ready" ? "ready" : "none",
          count,
        );
      });
    }
  }

  // ── Debug Attach Provider ──
  const debugAttachProvider = new DebugAttachProvider();
  const debugDisposables = debugAttachProvider.activate(context);
  context.subscriptions.push(...debugDisposables, debugAttachProvider);
  chatSidebarProvider?.setDebugAttachProvider(debugAttachProvider);

  // ── Context providers: @clipboard, @repo-map ─────────────────────────
  // Note: @open is now handled by OpenFilesProvider (Machine 2)

  globalContextRegistry.register({
    name: "clipboard",
    trigger: "@clipboard",
    description: "Current clipboard contents",
    async resolve(_query, _workspace) {
      const text = await vscode.env.clipboard.readText();
      if (!text?.trim()) {
        return [{ type: "file" as const, label: "@clipboard", content: "(clipboard is empty)" }];
      }
      return [{ type: "file" as const, label: "@clipboard", content: text.slice(0, 2000) }];
    },
  });

  globalContextRegistry.register({
    name: "repo-map",
    trigger: "@repo-map",
    description: "PageRank-based repo map with most important files",
    async resolve(_query, _workspace) {
      if (!codebaseIndexManager) {
        return [{ type: "codebase" as const, label: "@repo-map", content: "(index not ready)" }];
      }
      const map = await codebaseIndexManager.getRepoMap(2000);
      return [{ type: "codebase" as const, label: "@repo-map", content: map || "(repo map unavailable)" }];
    },
  });

  // ── LSP context providers: @hover, @definition, @references, @symbol, @types ─
  globalContextRegistry.register(HOVER_PROVIDER);
  globalContextRegistry.register(DEFINITION_PROVIDER);
  globalContextRegistry.register(REFERENCES_PROVIDER);
  globalContextRegistry.register(SYMBOL_PROVIDER);
  globalContextRegistry.register(TYPES_PROVIDER);

  // ── Machine 2: Formalized context providers ───────────────────────────────
  const _newProviders = [
    new CurrentFileProvider(),
    new OpenFilesProvider(),
    new ProblemsProvider(),
    new UrlProvider(),
  ];
  for (const p of _newProviders) {
    globalCoreRegistry.register(p);
    globalContextRegistry.register({
      name: p.name,
      trigger: `@${p.name}`,
      description: p.description,
      async resolve(query: string, workspace: string) {
        const items = await p.getContextItems({ query, workspaceRoot: workspace });
        return items.map((item) => ({
          type: "file" as const,
          label: `@${p.name}`,
          content: item.content,
          uri: item.uri?.value,
        }));
      },
    });
  }

  // ── Streaming diff provider (SEARCH/REPLACE pre-apply preview) ──
  streamingDiffProvider = new StreamingDiffProvider(context);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, streamingDiffProvider),
  );

  // ── Onboarding ──
  onboardingProvider = new OnboardingProvider(extensionUri, context.secrets, context);

  // ── Commands ──
  registerCommands(context);

  // ── Semantic go-to-definition (dim 4) ──
  // Falls back from native LSP → embedding-based codebase search when LSP returns nothing.
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.semanticGoToDefinition", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const pos = editor.selection.active;
      const wordRange = editor.document.getWordRangeAtPosition(pos);
      const symbol = wordRange ? editor.document.getText(wordRange) : "";
      if (!symbol) return;

      // 1. Try native LSP definition provider first
      try {
        const lspResults = await vscode.commands.executeCommand<vscode.Location[]>(
          "vscode.executeDefinitionProvider",
          editor.document.uri,
          pos,
        );
        if (lspResults && lspResults.length > 0) {
          await vscode.commands.executeCommand("editor.action.revealDefinition");
          return;
        }
      } catch {
        /* LSP unavailable — fall through to semantic search */
      }

      // 2. Fallback: semantic search via codebase index (dim 4 gap-closer)
      if (!codebaseIndexManager) {
        void vscode.window.showInformationMessage(
          "DanteCode: Codebase index not ready — try again in a moment",
        );
        return;
      }
      const rawHits = await codebaseIndexManager.search(symbol, 3);
      const hits = rawHits as Array<{ filePath: string; startLine?: number; content: string }>;
      if (hits.length === 0) {
        void vscode.window.showInformationMessage(
          `DanteCode: No semantic matches found for "${symbol}"`,
        );
        return;
      }

      const items = hits.map((h) => ({
        label: path.basename(h.filePath),
        description: `${h.filePath}:${h.startLine ?? 1}`,
        detail: (h.content.split("\n")[0] ?? "").slice(0, 80),
        filePath: h.filePath,
        startLine: Math.max(0, (h.startLine ?? 1) - 1),
      }));

      const picked = await vscode.window.showQuickPick(items, {
        title: `Semantic go-to-definition: ${symbol}`,
        placeHolder: "Select result to navigate",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!picked) return;

      const uri = vscode.Uri.file(picked.filePath);
      await vscode.window.showTextDocument(uri, {
        selection: new vscode.Range(picked.startLine, 0, picked.startLine, 0),
      });
    }),
  );

  // ── Output channel ──
  const outputChannel = vscode.window.createOutputChannel("DanteCode");
  danteOutputChannel = outputChannel;
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("DanteCode extension activated");
  // Sprint AR (dim 6): wire edit quality hook → VSCode output channel
  setEditQualityOutputHook((line) => outputChannel.appendLine(line));

  // ── Enterprise SSO gate (dim 28): check ssoConfig workspace setting on activation ──
  // If ssoConfig is configured, surface domain in output channel and update status bar.
  void (async () => {
    try {
      const ssoRaw = vscode.workspace.getConfiguration("dantecode").get<{ domain?: string; provider?: string; entityId?: string; acsUrl?: string; idpMetadata?: string }>("ssoConfig");
      if (ssoRaw?.domain) {
        const { EnterpriseSSOManager } = await import("@dantecode/core");
        const ssoManager = new EnterpriseSSOManager({
          provider: (ssoRaw.provider ?? "saml") as "saml" | "oidc",
          entityId: ssoRaw.entityId ?? `dantecode:${ssoRaw.domain}`,
          acsUrl: ssoRaw.acsUrl ?? `https://${ssoRaw.domain}/acs`,
          idpMetadata: ssoRaw.idpMetadata ?? "",
          allowedDomains: [ssoRaw.domain],
        });
        outputChannel.appendLine(`[Enterprise SSO: active — domain: ${ssoRaw.domain}]`);
        // Check if any existing sessions are valid
        const activeSessions = ssoManager.getActiveSessions();
        const sessionStatus = activeSessions.length > 0 ? "session active" : "no active session";
        outputChannel.appendLine(`[Enterprise SSO: ${sessionStatus}]`);
        // Update status bar tooltip with SSO domain
        if (statusBarState?.item) {
          statusBarState.item.tooltip = `DanteCode — SSO: ${ssoRaw.domain}`;
        }
      }
    } catch {
      // SSO config check is best-effort — never block activation
    }
  })();

  // ── First-run onboarding ──
  if (!OnboardingProvider.hasOnboarded(context)) {
    void onboardingProvider.show();
  }
}

// ─── Deactivate ──────────────────────────────────────────────────────────────

export function deactivate(): void {
  statusBarState?.item.dispose();
  chatSidebarProvider = undefined;
  auditPanelProvider = undefined;
  completionProvider = undefined;
  checkpointManager = undefined;
  diffReviewProvider = undefined;
  testDecoManager = undefined;
  codeLensProvider?.dispose();
  codeLensProvider = undefined;
  inlineEditProvider?.dispose();
  inlineEditProvider = undefined;
  codebaseIndexManager?.dispose();
  codebaseIndexManager = undefined;
  setCodebaseIndexManager(null);
  streamingDiffProvider?.dispose();
  streamingDiffProvider = undefined;
  completionAcceptanceTracker = undefined;
  completionTelemetry = undefined;
  fimModelRouter?.dispose();
  fimModelRouter = undefined;
  fimLatencyTracker?.dispose();
  fimLatencyTracker = undefined;
  nextEditPredictor?.dispose();
  nextEditPredictor = undefined;
  editHistoryTracker?.dispose();
  editHistoryTracker = undefined;
  testFrameworkDetector = undefined;

  if (diagnosticProvider) {
    diagnosticProvider.clearAll();
    diagnosticProvider = undefined;
  }
  danteDiagnostics?.dispose();
  danteDiagnostics = undefined;
  disposeInlinePDSEDiagnostics();
  globalEmitterRegistry.cancelAll();
  onboardingProvider = undefined;
  setEditQualityOutputHook(null);
}

// ─── Command Registration ────────────────────────────────────────────────────

function registerCommands(context: vscode.ExtensionContext): void {
  const commands: Array<[string, (...args: unknown[]) => unknown]> = [
    ["dantecode.selfUpdate", () => commandSelfUpdate(context)],
    ["dantecode.openChat", commandOpenChat],
    ["dantecode.addFileToContext", commandAddFileToContext],
    ["dantecode.importClaudeSkills", commandImportClaudeSkills],
    ["dantecode.runPDSE", commandRunPDSE],
    ["dantecode.runGStack", commandRunGStack],
    ["dantecode.switchModel", commandSwitchModel],
    ["dantecode.toggleSandbox", commandToggleSandbox],
    ["dantecode.showLessons", commandShowLessons],
    ["dantecode.initProject", commandInitProject],
    ["dantecode.acceptDiff", commandAcceptDiff],
    ["dantecode.rejectDiff", commandRejectDiff],
    ["dantecode.reviewDiff", commandReviewDiff],
    ["dantecode.acceptDiffHunks", commandAcceptDiffHunks],
    ["dantecode.rejectDiffHunks", commandRejectDiffHunks],
    ["dantecode.createCheckpoint", commandCreateCheckpoint],
    ["dantecode.listCheckpoints", commandListCheckpoints],
    ["dantecode.rewindCheckpoint", commandRewindCheckpoint],
    ["dantecode.setupApiKeys", commandSetupApiKeys],
    // Note: dantecode.inlineEdit, acceptInlineEdit, rejectInlineEdit are registered by InlineEditProvider.activate()
    ["dantecode.fixDiagnostic", commandFixDiagnostic],
    ["dantecode.explainDiagnostic", commandExplainDiagnostic],
    ["dantecode.slashCommandTest", commandSlashCommandTest],
    ["dantecode.generateTestFile", commandGenerateTestFile],
    ["dantecode.rebuildIndex", commandRebuildIndex],
    ["dantecode.acceptDiffBlock", commandAcceptDiffBlock],
    ["dantecode.rejectDiffBlock", commandRejectDiffBlock],
    ["dantecode.completionStats", commandCompletionStats],
    ["dantecode.clearCompletionStats", commandClearCompletionStats],
    ["dantecode.reviewPR", commandReviewPR],
    ["dantecode.clearTestDecorations", () => testDecoManager?.clear()],
    // Run vitest with JSON reporter and apply gutter decorations (dim 19)
    // Unified review changes QuickPick (dim 13): Accept / View diff / Reject in 2 keystrokes
    // User sees diff stats BEFORE deciding — informed approval, not blind approve.
    ["dantecode.reviewChanges", async () => {
      const items = [
        { label: "$(check) Accept", description: "Apply all changes", action: "accept" },
        { label: "$(comment) Approve with comments", description: "Accept and annotate per file", action: "approve-comments" },
        { label: "$(diff) View diff", description: "Open diff review panel", action: "review" },
        { label: "$(x) Reject", description: "Discard all changes", action: "reject" },
      ];
      // Build diff stats for the placeholder: compute +added/-removed lines from pending diff
      // Include diff quality score (dim 13) so user sees quality before deciding
      let diffStats = "";
      if (pendingDiffOldContent !== undefined && pendingDiffNewContent !== undefined) {
        const oldLines = pendingDiffOldContent.split("\n");
        const newLines = pendingDiffNewContent.split("\n");
        const linesAdded = newLines.filter((l) => !oldLines.includes(l)).length;
        const linesRemoved = oldLines.filter((l) => !newLines.includes(l)).length;
        const fileName = pendingDiffFilePath ? path.basename(pendingDiffFilePath) : "file";
        try {
          const { scoreDiff } = await import("@dantecode/core");
          const qs = scoreDiff(pendingDiffOldContent, pendingDiffNewContent, pendingDiffFilePath ?? "").qualityScore;
          diffStats = ` — ${fileName}: ▲${linesAdded} ▼${linesRemoved} quality:${qs.toFixed(2)}`;
        } catch {
          diffStats = ` — ${fileName}: +${linesAdded}/-${linesRemoved} lines`;
        }
      }
      const selected = await vscode.window.showQuickPick(items, {
        title: "Review Changes",
        placeHolder: `Choose action${diffStats}`,
      });
      if (!selected) return;
      if (selected.action === "accept") return commandAcceptDiff();
      if (selected.action === "approve-comments") {
        // Line-level diff comment workflow (dim 13): per-file comment input
        const files = pendingDiffFilePath ? [pendingDiffFilePath] : [];
        const newComments: Array<{ file: string; comment: string }> = [];
        for (const filePath of files) {
          const comment = await vscode.window.showInputBox({
            prompt: `Comment for ${path.basename(filePath)} (or leave blank to skip)`,
            placeHolder: "e.g. verify this logic handles edge case X",
          });
          if (comment) newComments.push({ file: filePath, comment });
        }
        if (newComments.length > 0) {
          pendingReviewComments = newComments;
          danteOutputChannel?.appendLine(`[Review: ${newComments.length} comment${newComments.length === 1 ? "" : "s"} added to context]`);
          // Persist review comments to disk for cross-session reference (dim 13)
          const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
          if (wsRoot) {
            try {
              const reviewDir = path.join(wsRoot, ".danteforge");
              await mkdir(reviewDir, { recursive: true });
              const reviewPath = path.join(reviewDir, "review-comments.json");
              let existing: Array<{ file: string; comment: string; timestamp: string; commitSha: string }> = [];
              try {
                existing = JSON.parse(await readFile(reviewPath, "utf-8")) as typeof existing;
              } catch { /* first write */ }
              const commitSha = (() => {
                try {
                  return (execSync("git rev-parse --short HEAD", { cwd: wsRoot, encoding: "utf-8" }) as string).trim();
                } catch { return ""; }
              })();
              const timestamp = new Date().toISOString();
              for (const c of newComments) {
                existing.push({ file: c.file, comment: c.comment, timestamp, commitSha });
              }
              await writeFile(reviewPath, JSON.stringify(existing, null, 2), "utf-8");
            } catch { /* non-fatal */ }
          }
          // Emit diff quality score to .danteforge/diff-quality-log.json (dim 13)
          try {
            const { scoreDiff, emitDiffQualityLog } = await import("@dantecode/core");
            if (pendingDiffFilePath) {
              const score = scoreDiff(
                pendingDiffOldContent ?? "",
                pendingDiffNewContent ?? "",
                pendingDiffFilePath,
              );
              emitDiffQualityLog(score, pendingDiffFilePath, undefined, wsRoot ?? undefined);
            }
          } catch { /* non-fatal */ }
        }
        return commandAcceptDiff();
      }
      if (selected.action === "review") {
        // Auto-open diff panel when user selects "View diff" (dim 13)
        if (pendingDiffFilePath && pendingDiffOldContent !== undefined && pendingDiffNewContent !== undefined) {
          const originalUri = vscode.Uri.parse(`dantecode-diff:original/${path.basename(pendingDiffFilePath)}`);
          await vscode.commands.executeCommand("vscode.diff", originalUri, vscode.Uri.file(pendingDiffFilePath), `Review: ${path.basename(pendingDiffFilePath)}`);
        }
        return commandReviewDiff();
      }
      if (selected.action === "reject") return commandRejectDiff();
    }],
    // Sprint Dim14: open browser live preview panel at a given port
    ["dantecode.openPreview", async () => {
      const portStr = await vscode.window.showInputBox({
        prompt: "Dev server port",
        value: "3000",
        validateInput: (v) => (isNaN(parseInt(v)) ? "Enter a valid port number" : undefined),
      });
      if (portStr) {
        activePreviewPort = parseInt(portStr);
        PreviewPanelProvider.createOrShow(activePreviewPort, context);
      }
    }],
    // Sprint Dim14: detect + start local dev server and open preview panel
    ["dantecode.startDevServer", async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsRoot) { vscode.window.showErrorMessage("No workspace folder open."); return; }
      try {
        const { detectDevCommand, startDevServer } = await import("./dev-server-bridge.js");
        const cmd = detectDevCommand(wsRoot);
        if (!cmd) { vscode.window.showErrorMessage("No dev script found in package.json (dev/start/serve)."); return; }
        vscode.window.showInformationMessage(`Starting: ${cmd}…`);
        const handle = await startDevServer({ command: cmd, cwd: wsRoot });
        activePreviewPort = handle.port;
        handle.onExit(() => { activePreviewPort = 0; });
        PreviewPanelProvider.createOrShow(handle.port, context);
        vscode.window.showInformationMessage(`Preview ready at http://localhost:${handle.port}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Dev server failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }],
    ["dantecode.runTestsAndDecorate", async () => {
      const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!wsRoot) return;
      const outputPath = path.join(wsRoot, ".dantecode", "test-results.json");
      try {
        await mkdir(path.dirname(outputPath), { recursive: true });
        const { spawn } = await import("node:child_process");
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(
            "npx",
            ["vitest", "run", "--reporter=json", `--outputFile=${outputPath}`],
            { cwd: wsRoot, shell: true },
          );
          proc.on("close", () => resolve());
          proc.on("error", reject);
        });
        const raw = await readFile(outputPath, "utf8");
        testDecoManager?.apply(parseVitestResults(raw));
      } catch { /* non-fatal */ }
    }],
  ];

  for (const [id, handler] of commands) {
    const disposable = vscode.commands.registerCommand(id, handler);
    context.subscriptions.push(disposable);
  }
}

// ─── Command Implementations ─────────────────────────────────────────────────

async function commandOpenChat(): Promise<void> {
  await vscode.commands.executeCommand("dantecode.chatView.focus");
}

async function commandAddFileToContext(uri?: unknown): Promise<void> {
  let filePath: string;

  if (uri instanceof vscode.Uri) {
    filePath = uri.fsPath;
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage("DanteCode: No active file to add to context");
      return;
    }
    filePath = editor.document.uri.fsPath;
  }

  if (chatSidebarProvider) {
    (chatSidebarProvider as unknown as { handleFileAdd: (filePath: string) => void }).handleFileAdd(
      filePath,
    );
    void vscode.window.showInformationMessage(
      `DanteCode: Added ${path.basename(filePath)} to context`,
    );
  } else {
    void vscode.window.showWarningMessage("DanteCode: Chat sidebar not ready");
  }
}

async function commandImportClaudeSkills(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DanteCode: Importing Claude skills...",
      cancellable: true,
    },
    async (_progress, token) => {
      try {
        const { scanClaudeSkills, importSkills } = await import("@dantecode/skill-adapter");
        const scanned = await scanClaudeSkills(projectRoot);
        if (scanned.length === 0) {
          void vscode.window.showInformationMessage("DanteCode: No Claude skills found in project");
          return;
        }
        if (token.isCancellationRequested) return;
        const result = await importSkills({ projectRoot, source: "claude" });
        if (token.isCancellationRequested) return;
        const names = result.imported.join(", ");
        const detail = result.imported.length > 0 ? ` (${names})` : "";
        void vscode.window.showInformationMessage(
          `DanteCode: Imported ${result.imported.length} skill(s)${detail}, ${result.skipped.length} skipped`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`DanteCode: Skill import failed — ${msg}`);
      }
    },
  );
}

async function commandRunPDSE(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!editor || !projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a file in a workspace to score");
    return;
  }

  const content = editor.document.getText();
  const filePath = editor.document.uri.fsPath;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `DanteCode: Scoring ${path.basename(filePath)}...`,
      cancellable: false,
    },
    async () => {
      try {
        const { runLocalPDSEScorer } = await import("@dantecode/danteforge");
        const score = runLocalPDSEScorer(content, projectRoot);
        const status = score.passedGate ? "PASSED" : "FAILED";
        void vscode.window.showInformationMessage(
          `DanteCode PDSE: ${score.overall}/100 (${status}) — ` +
            `completeness: ${score.completeness}, correctness: ${score.correctness}, ` +
            `clarity: ${score.clarity}, consistency: ${score.consistency}`,
        );

        // Push violations to diagnostics panel
        if (diagnosticProvider) {
          diagnosticProvider.updateDiagnostics(editor.document.uri, score);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`DanteCode: PDSE scoring failed — ${msg}`);
      }
    },
  );
}

async function commandRunGStack(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  // Try to read commands from STATE.yaml, fall back to defaults
  let commands = "npm run typecheck && npm run lint && npm test";
  try {
    const { readStateYaml } = await import("@dantecode/core");
    const state = await readStateYaml(projectRoot);
    if (state?.autoforge?.gstackCommands?.length) {
      commands = state.autoforge.gstackCommands
        .map((c: { command?: string; name?: string }) => c.command ?? c.name ?? "")
        .filter(Boolean)
        .join(" && ");
    }
  } catch {
    // Use defaults
  }

  const terminal = vscode.window.createTerminal({
    name: "DanteCode GStack",
    cwd: projectRoot,
  });
  terminal.sendText(commands);
  terminal.show();
  void vscode.window.showInformationMessage(
    `DanteCode: GStack running ${commands.split("&&").length} command(s)`,
  );
}

async function commandSwitchModel(): Promise<void> {
  const models = MODEL_CATALOG.filter((entry) => entry.supportTier === "tier1").map((entry) => ({
    label: entry.label,
    description: entry.id,
  }));
  const selected = await vscode.window.showQuickPick(models, { placeHolder: "Select model" });
  if (selected) {
    const nextModel = selected.description ?? DEFAULT_MODEL_ID;
    const config = vscode.workspace.getConfiguration("dantecode");
    await config.update("defaultModel", nextModel, vscode.ConfigurationTarget.Global);
    if (statusBarState) {
      updateStatusBar(statusBarState, nextModel, "none");
    }
    void vscode.window.showInformationMessage(`DanteCode: Switched to ${nextModel}`);
  }
}

async function commandToggleSandbox(): Promise<void> {
  if (statusBarState) {
    const enabled = statusBarState.sandboxEnabled;
    const config = vscode.workspace.getConfiguration("dantecode");
    await config.update("sandboxEnabled", !enabled, vscode.ConfigurationTarget.Global);
    updateSandboxStatus(statusBarState, !enabled);
    void vscode.window.showInformationMessage(
      `DanteCode: Sandbox ${!enabled ? "enabled" : "disabled"}`,
    );
  }
}

async function commandShowLessons(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  try {
    const { queryLessons, formatLessonsForPrompt } = await import("@dantecode/danteforge");
    const lessons = await queryLessons({ projectRoot, limit: 20 });
    if (lessons.length === 0) {
      void vscode.window.showInformationMessage(
        "DanteCode: No lessons recorded yet. Lessons are captured automatically during autoforge runs " +
          "when corrections or failures occur. Run /forge or /magic to get started.",
      );
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: formatLessonsForPrompt(lessons),
      language: "markdown",
    });
    await vscode.window.showTextDocument(doc, { preview: true });
    void vscode.window.showInformationMessage(
      `DanteCode: Showing ${lessons.length} lesson(s) for this project`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Failed to load lessons — ${msg}`);
  }
}

async function commandInitProject(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open workspace first");
    return;
  }

  // Check if already initialized
  const dantecodeDir = path.join(projectRoot, ".dantecode");
  const statePath = path.join(dantecodeDir, "STATE.yaml");
  try {
    await readFile(statePath, "utf-8");
    const reinit = await vscode.window.showInformationMessage(
      "DanteCode: Project already initialized. Re-initialize?",
      "Re-initialize",
      "Cancel",
    );
    if (reinit !== "Re-initialize") return;
  } catch {
    // Not initialized yet — continue
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DanteCode: Initializing project...",
      cancellable: false,
    },
    async () => {
      try {
        await mkdir(dantecodeDir, { recursive: true });
        await mkdir(path.join(dantecodeDir, "agents"), { recursive: true });
        await mkdir(path.join(dantecodeDir, "lessons"), { recursive: true });
        await mkdir(path.join(dantecodeDir, "sessions"), { recursive: true });

        await writeFile(
          statePath,
          [
            "# DanteCode project configuration",
            "model:",
            "  default:",
            '    provider: "grok"',
            '    modelId: "grok-3"',
            "    maxTokens: 8192",
            "    temperature: 0.1",
            "    contextWindow: 131072",
            "    supportsVision: false",
            "    supportsToolCalls: true",
            "autoforge:",
            "  maxIterations: 5",
            "  gstackCommands:",
            '    - "npm run typecheck"',
            '    - "npm run lint"',
            '    - "npm test"',
            "",
          ].join("\n"),
          "utf-8",
        );

        void vscode.window.showInformationMessage(
          `DanteCode: Project initialized at ${dantecodeDir}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`DanteCode: Init failed — ${msg}`);
      }
    },
  );
}

async function commandAcceptDiff(): Promise<void> {
  if (!pendingDiffFilePath || pendingDiffNewContent === undefined) {
    void vscode.window.showWarningMessage("DanteCode: No pending diff to accept");
    return;
  }
  try {
    await writeFile(pendingDiffFilePath, pendingDiffNewContent, "utf-8");
    void vscode.window.showInformationMessage(
      `DanteCode: Applied diff to ${path.basename(pendingDiffFilePath)}`,
    );
    clearPendingDiff();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Failed to apply diff — ${msg}`);
  }
}

async function commandRejectDiff(): Promise<void> {
  if (!pendingDiffFilePath || pendingDiffOldContent === undefined) {
    void vscode.window.showWarningMessage("DanteCode: No pending diff to reject");
    return;
  }
  try {
    await writeFile(pendingDiffFilePath, pendingDiffOldContent, "utf-8");
    void vscode.window.showInformationMessage(
      `DanteCode: Reverted diff on ${path.basename(pendingDiffFilePath)}`,
    );
    clearPendingDiff();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Failed to revert diff — ${msg}`);
  }
}

async function commandReviewDiff(): Promise<void> {
  const review = await createPendingDiffReview();
  if (!review) {
    return;
  }

  await diffReviewProvider?.openReview(review);
  if (review.hunks.length === 0) {
    void vscode.window.showInformationMessage("DanteCode: Pending diff has no reviewable hunks");
  }
}

async function commandAcceptDiffHunks(): Promise<void> {
  const review = await createPendingDiffReview();
  if (!review || !diffReviewProvider) {
    return;
  }

  await diffReviewProvider.openReview(review);
  const selection = await vscode.window.showQuickPick(
    diffReviewProvider.buildQuickPickItems(review),
    {
      canPickMany: true,
      placeHolder: "Select hunks to keep in the file",
    },
  );

  if (!selection) {
    return;
  }

  await diffReviewProvider.applySelectedHunks(
    review,
    selection.map((item) => item.index),
  );
  clearPendingDiff();
  void vscode.window.showInformationMessage(
    `DanteCode: Applied ${selection.length} selected hunk(s) to ${path.basename(review.filePath)}`,
  );
}

async function commandRejectDiffHunks(): Promise<void> {
  const review = await createPendingDiffReview();
  if (!review || !diffReviewProvider) {
    return;
  }

  await diffReviewProvider.openReview(review);
  const selection = await vscode.window.showQuickPick(
    diffReviewProvider.buildQuickPickItems(review),
    {
      canPickMany: true,
      placeHolder: "Select hunks to remove from the file",
    },
  );

  if (!selection) {
    return;
  }

  await diffReviewProvider.rejectSelectedHunks(
    review,
    selection.map((item) => item.index),
  );
  clearPendingDiff();
  void vscode.window.showInformationMessage(
    `DanteCode: Rejected ${selection.length} hunk(s) from ${path.basename(review.filePath)}`,
  );
}

async function commandCreateCheckpoint(): Promise<void> {
  if (!checkpointManager) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  try {
    const checkpoint = await checkpointManager.createCheckpoint({ label: "manual-checkpoint" });
    void vscode.window.showInformationMessage(
      `DanteCode: Created checkpoint ${checkpoint.id} (${checkpoint.label})`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Failed to create checkpoint - ${msg}`);
  }
}

async function commandListCheckpoints(): Promise<void> {
  if (!checkpointManager) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const checkpoints = checkpointManager.listCheckpoints();
  if (checkpoints.length === 0) {
    void vscode.window.showInformationMessage("DanteCode: No checkpoints available");
    return;
  }

  await vscode.window.showQuickPick(
    checkpoints.map((checkpoint) => ({
      label: checkpoint.label,
      description: checkpoint.id,
      detail: `${checkpoint.strategy} - ${new Date(checkpoint.createdAt).toLocaleString()}`,
    })),
    { placeHolder: "Available DanteCode checkpoints" },
  );
}

async function commandRewindCheckpoint(): Promise<void> {
  if (!checkpointManager) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const checkpoints = checkpointManager.listCheckpoints();
  if (checkpoints.length === 0) {
    void vscode.window.showInformationMessage("DanteCode: No checkpoints available");
    return;
  }

  const selection = await vscode.window.showQuickPick(
    checkpoints.map((checkpoint) => ({
      label: checkpoint.label,
      description: checkpoint.id,
      detail: `${checkpoint.strategy} - ${new Date(checkpoint.createdAt).toLocaleString()}`,
    })),
    { placeHolder: "Select a checkpoint to rewind" },
  );

  if (!selection?.description) {
    return;
  }

  try {
    await checkpointManager.rewindCheckpoint(selection.description);
    void vscode.window.showInformationMessage(
      `DanteCode: Rewound checkpoint ${selection.description}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Failed to rewind checkpoint - ${msg}`);
  }
}

async function commandSetupApiKeys(): Promise<void> {
  if (onboardingProvider) {
    await onboardingProvider.show();
    return;
  }

  void vscode.commands.executeCommand("workbench.action.openSettings", "dantecode");
}

async function commandSelfUpdate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const installContext = detectInstallContext({
    runtimePath: context.extensionPath,
    workspaceRoot,
    extensionPath: context.extensionPath,
  });

  if (installContext.repoRoot && installContext.workspaceIsRepoRoot) {
    const terminal = vscode.window.createTerminal({
      name: "DanteCode Self-Update",
      cwd: installContext.repoRoot,
    });
    terminal.sendText("node packages/cli/dist/index.js self-update --verbose");
    terminal.show();
    void vscode.window.showInformationMessage("DanteCode: Repo self-update started in terminal");
    return;
  }

  void vscode.commands.executeCommand("workbench.extensions.action.checkForUpdates");
  void vscode.window.showInformationMessage(
    "DanteCode: Extension updates come from the VS Code Extensions view. Update the CLI separately with `npm install -g @dantecode/cli@latest`.",
  );
}

/**
 * Sets the pending diff for accept/reject commands. Called from the sidebar
 * when a diff hunk is emitted.
 */
export function setPendingDiff(filePath: string, oldContent: string, newContent: string): void {
  void checkpointManager?.createCheckpoint({
    label: `agent-edit:${path.basename(filePath)}`,
    fileSnapshots: [{ filePath, content: oldContent }],
  });
  pendingDiffFilePath = filePath;
  pendingDiffOldContent = oldContent;
  pendingDiffNewContent = newContent;
}

async function createPendingDiffReview(): Promise<PendingDiffReview | null> {
  if (!diffReviewProvider) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return null;
  }

  if (
    !pendingDiffFilePath ||
    pendingDiffOldContent === undefined ||
    pendingDiffNewContent === undefined
  ) {
    void vscode.window.showWarningMessage("DanteCode: No pending diff to review");
    return null;
  }

  return diffReviewProvider.createReview(
    pendingDiffFilePath,
    pendingDiffOldContent,
    pendingDiffNewContent,
  );
}

// ── New IDE Integration commands ─────────────────────────────────────────
// Note: dantecode.inlineEdit is registered by InlineEditProvider.activate() directly.

async function commandFixDiagnostic(
  _uri?: unknown,
  _range?: unknown,
  message?: unknown,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("DanteCode: Open a file to fix a diagnostic");
    return;
  }
  const prefill = typeof message === "string" ? `Fix: ${message.slice(0, 80)}` : undefined;
  if (inlineEditProvider) {
    await inlineEditProvider.triggerInlineEdit(editor, prefill);
  }
}

async function commandExplainDiagnostic(message?: unknown): Promise<void> {
  if (typeof message !== "string") return;
  if (chatSidebarProvider) {
    (
      chatSidebarProvider as unknown as { handleChatRequest: (text: string) => Promise<void> }
    ).handleChatRequest(`Explain this error: ${message}`);
  }
  await vscode.commands.executeCommand("dantecode.chatView.focus");
}

async function commandSlashCommandTest(symbolName?: unknown): Promise<void> {
  if (chatSidebarProvider) {
    const { buildSlashPrompt, SLASH_COMMANDS } = await import("./slash-commands.js");
    const testCmd = SLASH_COMMANDS.find((c) => c.name === "test");
    if (testCmd) {
      const editor = vscode.window.activeTextEditor;
      const selection = editor ? editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection) : "";
      const filePath = editor?.document.uri.fsPath ?? "";
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
      const language = editor?.document.languageId ?? "typescript";

      let extraArg = typeof symbolName === "string" ? symbolName : "";
      if (testFrameworkDetector && filePath) {
        try {
          const tc = await testFrameworkDetector.buildTestContext(filePath, workspaceRoot, selection, language);
          extraArg = JSON.stringify({
            frameworkName: tc.framework.name,
            runCommand: tc.framework.runCommand,
            existingTestFile: tc.existingTestFile,
            inferredTestFilePath: tc.inferredTestFilePath,
            existingTestHead: tc.existingTestHead,
            functionSignatures: tc.functionSignatures,
          });
        } catch { /* fall through with empty extraArg */ }
      }

      const prompt = buildSlashPrompt(testCmd, selection, filePath, extraArg);
      (
        chatSidebarProvider as unknown as { handleChatRequest: (text: string) => Promise<void> }
      ).handleChatRequest(prompt);
    }
  }
  await vscode.commands.executeCommand("dantecode.chatView.focus");
}

async function commandGenerateTestFile(args?: unknown): Promise<void> {
  if (!chatSidebarProvider) return;

  const typedArgs = args as { filePath?: string; symbolName?: string } | undefined;
  const editor = vscode.window.activeTextEditor;
  const filePath = typedArgs?.filePath ?? editor?.document.uri.fsPath ?? "";
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";

  if (!filePath) return;

  const { buildSlashPrompt, SLASH_COMMANDS } = await import("./slash-commands.js");
  const testfileCmd = SLASH_COMMANDS.find((c) => c.name === "testfile");
  if (!testfileCmd) return;

  let extraArg = "";
  if (testFrameworkDetector) {
    try {
      const tc = await testFrameworkDetector.buildTestContext(filePath, workspaceRoot, "", "typescript");
      extraArg = JSON.stringify({
        frameworkName: tc.framework.name,
        runCommand: tc.framework.runCommand,
        existingTestFile: tc.existingTestFile,
        inferredTestFilePath: tc.inferredTestFilePath,
        existingTestHead: tc.existingTestHead,
        functionSignatures: tc.functionSignatures,
      });
    } catch { /* fall through with empty extraArg */ }
  }

  const prompt = buildSlashPrompt(testfileCmd, "", filePath, extraArg);
  (
    chatSidebarProvider as unknown as { handleChatRequest: (text: string) => Promise<void> }
  ).handleChatRequest(prompt);
  await vscode.commands.executeCommand("dantecode.chatView.focus");
}

async function commandRebuildIndex(): Promise<void> {
  if (!codebaseIndexManager) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace to use codebase index");
    return;
  }
  void vscode.window.showInformationMessage("DanteCode: Rebuilding codebase index\u2026");
  void codebaseIndexManager.initialize({ force: true });
}

/**
 * Format retrieved CodeIndex chunks into a prompt-ready string.
 * Caps total output at 8000 chars and includes file path + line range + symbol names.
 */
function formatChunks(
  chunks: Array<{
    filePath: string;
    startLine: number;
    endLine: number;
    content: string;
    symbols: string[];
  }>,
): string {
  const MAX_CHARS = 8_000;
  const parts: string[] = [];
  let total = 0;
  for (const c of chunks) {
    const syms = c.symbols.length > 0 ? ` [${c.symbols.slice(0, 5).join(", ")}]` : "";
    const section = `// ${c.filePath}:${c.startLine}-${c.endLine}${syms}\n${c.content}`;
    if (total + section.length > MAX_CHARS) {
      const remaining = MAX_CHARS - total;
      if (remaining > 100) parts.push(section.slice(0, remaining));
      break;
    }
    parts.push(section);
    total += section.length;
  }
  return parts.join("\n\n");
}

function clearPendingDiff(): void {
  pendingDiffFilePath = undefined;
  pendingDiffNewContent = undefined;
  pendingDiffOldContent = undefined;
}

async function commandAcceptDiffBlock(
  _filePath: unknown,
  blockIndex: unknown,
): Promise<void> {
  const session = streamingDiffProvider?.activeSession;
  if (!session) {
    void vscode.window.showWarningMessage("DanteCode: No active diff session");
    return;
  }
  const idx = typeof blockIndex === "number" ? blockIndex : 0;
  const block = session.blocks[idx];
  if (!block) {
    void vscode.window.showWarningMessage("DanteCode: Diff block not found");
    return;
  }
  try {
    const result = await session.applyBlock(
      block.id,
      (p) => readFile(p, "utf-8"),
      (p, c) => writeFile(p, c, "utf-8"),
    );
    if (!result.matched) {
      void vscode.window.showWarningMessage(
        `DanteCode: Block apply failed — ${result.diagnostic ?? "no match found"}`,
      );
    } else {
      void vscode.window.showInformationMessage(
        `DanteCode: Applied change (${result.matchQuality})`,
      );
    }
  } finally {
    if (session.allSettled) streamingDiffProvider?.clearSession();
  }
}

async function commandRejectDiffBlock(
  _filePath: unknown,
  blockIndex: unknown,
): Promise<void> {
  const session = streamingDiffProvider?.activeSession;
  if (!session) return;
  const idx = typeof blockIndex === "number" ? blockIndex : 0;
  const block = session.blocks[idx];
  if (!block) return;
  session.rejectBlock(block.id);
  void vscode.window.showInformationMessage("DanteCode: Diff block rejected");
  if (session.allSettled) streamingDiffProvider?.clearSession();
}

async function commandCompletionStats(): Promise<void> {
  if (!completionTelemetry) {
    void vscode.window.showWarningMessage("DanteCode: No completion telemetry available");
    return;
  }
  const stats = completionTelemetry.getStats(24);
  if (stats.totalViewed === 0) {
    void vscode.window.showInformationMessage("DanteCode: No completions recorded in the last 24h");
    return;
  }
  const rate = (stats.acceptanceRate * 100).toFixed(1);
  const p50 = stats.p50LatencyMs > 0 ? `p50: ${stats.p50LatencyMs}ms` : "p50: n/a";
  const p95 = stats.p95LatencyMs > 0 ? `p95: ${stats.p95LatencyMs}ms` : "p95: n/a";
  const localModel = fimModelRouter?.hasLocalModel ? ` | Local: ${fimModelRouter.localModelId ?? ""}` : "";
  const msg = [
    `Rate: ${rate}%`,
    `Viewed: ${stats.totalViewed} | Accepted: ${stats.totalAccepted} | Dismissed: ${stats.totalDismissed}`,
    `${p50} | ${p95} | Avg: ${stats.avgElapsedMs}ms${localModel}`,
  ].join("  |  ");
  void vscode.window.showInformationMessage(`DanteCode: ${msg}`);
}

async function commandClearCompletionStats(): Promise<void> {
  completionTelemetry?.clearStats();
  void vscode.window.showInformationMessage("DanteCode: Completion stats cleared");
}

async function commandReviewPR(): Promise<void> {
  // Auto-detect PR number from current branch via gh CLI, or prompt user
  let prNumberStr: string | undefined;
  try {
    const { execFileSync } = await import("node:child_process");
    const out = execFileSync("gh", ["pr", "view", "--json", "number", "--jq", ".number"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    prNumberStr = out.length > 0 ? out : undefined;
  } catch {
    // gh not available or not in a PR branch — fall through to manual prompt
  }

  if (!prNumberStr) {
    prNumberStr = await vscode.window.showInputBox({
      prompt: "Enter PR number to review",
      placeHolder: "123",
      validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : "Enter a valid PR number"),
    });
  }

  if (!prNumberStr) return;

  const prNumber = Number(prNumberStr.trim());
  if (!prNumber) return;

  // Route through sidebar handleWebviewMessage to trigger the pr_review_request handler
  await vscode.commands.executeCommand("dantecode.chatView.focus");
  await chatSidebarProvider?.handleWebviewMessage({
    type: "pr_review_request",
    payload: { prNumber },
  });
}
