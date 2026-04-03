// ============================================================================
// DanteCode VS Code Extension — Main Entry Point
// Registers providers, status bar, diagnostics, and all commands.
// ============================================================================

import * as vscode from "vscode";
import * as path from "path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { DEFAULT_MODEL_ID, MODEL_CATALOG, detectInstallContext, readOrInitializeState } from "@dantecode/core";
import type { Session, DanteCodeState } from "@dantecode/config-types";
import { OnboardingWizard } from "@dantecode/ux-polish";

import { ChatSidebarProvider } from "./sidebar-provider.js";
import { AuditPanelProvider } from "./audit-panel-provider.js";
import { AutomationPanelProvider } from "./automation-panel-provider.js";
import { VerificationPanelProvider } from "./verification-panel-provider.js";
import { PlanningPanelProvider } from "./planning-panel.js";
import { GitPanelProvider } from "./panels/git-panel-provider.js";
import { SkillsPanelProvider } from "./panels/skills-panel-provider.js";
import { SessionsPanelProvider } from "./panels/sessions-panel-provider.js";
import { PartyProgressPanel } from "./panels/party-progress-panel.js";
import { MemoryBrowserPanel } from "./panels/memory-browser-panel.js";
import { AutomationDashboardPanel } from "./panels/automation-dashboard-panel.js";
import { MagicPanelProvider } from "./panels/magic-panel.js";
import { PDSEPanelProvider } from "./panels/pdse-panel.js";
import { MemoryPanelProvider } from "./panels/memory-panel.js";
import { SearchPanelProvider } from "./panels/search-panel.js";
import { AgentsPanelProvider } from "./panels/agents-panel.js";
import { DanteCodeCompletionProvider, disposeInlinePDSEDiagnostics } from "./inline-completion.js";
import {
  createStatusBar,
  updateStatusBar,
  updateStatusBarInfo,
  updateSandboxStatus,
  updateStatusBarWithCost,
  registerPdseActiveEditorListener,
  type StatusBarState,
} from "./status-bar.js";
import { PDSEDiagnosticProvider } from "./diagnostics.js";
import { OnboardingProvider } from "./onboarding-provider.js";
import { RepoMapTreeDataProvider } from "./repo-map-tree-provider.js";
import { CheckpointManager } from "./checkpoint-manager.js";
import { DiffReviewProvider, type PendingDiffReview } from "./diff-review-provider.js";
import { CheckpointTreeDataProvider } from "./checkpoint-tree-provider.js";
import { SkillsTreeDataProvider } from "./skills-tree-provider.js";
import { registerVersionCommand } from "./version-command.js";
import {
  registerDiffViewer,
  registerFileDecorations,
  registerVerificationAnnotations,
  registerQuickActions,
  registerTimelineView,
  registerNotificationManager,
  registerCommandHistory,
  registerAgentProgress,
} from "./ui-enhancements/index.js";
import { registerPhase4Commands } from "./commands-phase4.js";
import { InlineEditProvider } from "./inline-edit.js";

// ─── Module-Level State ──────────────────────────────────────────────────────

let statusBarState: StatusBarState | undefined;
let chatSidebarProvider: ChatSidebarProvider | undefined;
let auditPanelProvider: AuditPanelProvider | undefined;
let automationPanelProvider: AutomationPanelProvider | undefined;
let verificationPanelProvider: VerificationPanelProvider | undefined;
let planningPanelProvider: PlanningPanelProvider | undefined;
let gitPanelProvider: GitPanelProvider | undefined;
let skillsPanelProvider: SkillsPanelProvider | undefined;
let sessionsPanelProvider: SessionsPanelProvider | undefined;
let partyProgressPanel: PartyProgressPanel | undefined;
let memoryBrowserPanel: MemoryBrowserPanel | undefined;
let automationDashboardPanel: AutomationDashboardPanel | undefined;
let completionProvider: DanteCodeCompletionProvider | undefined;
let diagnosticProvider: PDSEDiagnosticProvider | undefined;
let onboardingProvider: OnboardingProvider | undefined;
let checkpointManager: CheckpointManager | undefined;
let diffReviewProvider: DiffReviewProvider | undefined;
let checkpointTreeProvider: CheckpointTreeDataProvider | undefined;
let skillsTreeProvider: SkillsTreeDataProvider | undefined;
let semanticIndex:
  | {
      start: () => Promise<void>;
      getReadiness: () => { status: "indexing" | "ready" | "error"; progress: number };
    }
  | undefined;

let inlineEditProvider: InlineEditProvider | undefined;

// Phase 5: UX Enhancements registered directly (no need to store return values)

/** Tracks the last diff hunk file path for accept/reject commands. */
let pendingDiffFilePath: string | undefined;
let pendingDiffNewContent: string | undefined;
let pendingDiffOldContent: string | undefined;

// ─── Activate ────────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const extensionUri = context.extensionUri;

  // ── Output channel (created early for bridge initialization) ──
  const outputChannel = vscode.window.createOutputChannel("DanteCode");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("DanteCode extension activated");

  // ── Repo map tree ──
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";

  // ── Initialize session and state for command bridge ──
  let initialSession: Session | undefined;
  let initialState: DanteCodeState | undefined;

  if (projectRoot) {
    try {
      // Load existing state or initialize default
      initialState = await readOrInitializeState(projectRoot);

      // Create initial session
      initialSession = {
        id: `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        projectRoot,
        messages: [],
        activeFiles: [],
        readOnlyFiles: [],
        todoList: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        agentStack: [],
        model: initialState.model.default,
      };
    } catch (error) {
      outputChannel.appendLine(`Warning: Failed to initialize session/state: ${error}`);
    }
  }

  // Session/state loaded above — used for panel initialization check
  const sessionReady = Boolean(initialSession && initialState);

  if (projectRoot) {
    checkpointManager = new CheckpointManager(projectRoot);
    diffReviewProvider = new DiffReviewProvider(projectRoot);
    const treeProvider = new RepoMapTreeDataProvider(projectRoot);
    const repoTree = vscode.window.createTreeView("dantecode.repoMap", {
      treeDataProvider: treeProvider,
    });
    context.subscriptions.push(repoTree);

    // ── Checkpoint tree ──
    checkpointTreeProvider = new CheckpointTreeDataProvider(projectRoot);
    const checkpointTree = vscode.window.createTreeView("dantecode.checkpointTree", {
      treeDataProvider: checkpointTreeProvider,
      showCollapseAll: false,
    });
    context.subscriptions.push(checkpointTree);

    // ── Skills tree (Wave 3 Task 3.6) ──
    skillsTreeProvider = new SkillsTreeDataProvider(projectRoot);
    const skillsTree = vscode.window.createTreeView("dantecode.skillsTree", {
      treeDataProvider: skillsTreeProvider,
      showCollapseAll: false,
    });
    context.subscriptions.push(skillsTree);

    // ── Background Semantic Index (Wave 3 Task 3.6) ──
    // Start indexing in background (non-blocking)
    void (async () => {
      try {
        const { BackgroundSemanticIndex } = await import("@dantecode/core");
        semanticIndex = new BackgroundSemanticIndex({
          projectRoot,
          sessionId: "vscode-session",
        });
        await semanticIndex.start();

        // Update status bar periodically with index readiness
        const currentIndex = semanticIndex; // Capture in closure
        const indexInterval = setInterval(() => {
          if (currentIndex && statusBarState) {
            const readiness = currentIndex.getReadiness();
            if (readiness) {
              updateStatusBarInfo(statusBarState, { indexReadiness: readiness });
            }
          }
        }, 2000);

        context.subscriptions.push({
          dispose: () => {
            clearInterval(indexInterval);
          },
        });
      } catch (error) {
        console.error("Failed to start semantic index:", error);
      }
    })();
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

  automationPanelProvider = new AutomationPanelProvider(extensionUri);
  const automationViewRegistration = vscode.window.registerWebviewViewProvider(
    AutomationPanelProvider.viewType,
    automationPanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(automationViewRegistration);

  verificationPanelProvider = new VerificationPanelProvider(extensionUri);
  const verificationViewRegistration = vscode.window.registerWebviewViewProvider(
    VerificationPanelProvider.viewType,
    verificationPanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(verificationViewRegistration);

  planningPanelProvider = new PlanningPanelProvider(extensionUri);
  const planningViewRegistration = vscode.window.registerWebviewViewProvider(
    PlanningPanelProvider.viewType,
    planningPanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(planningViewRegistration);

  // ── Phase 3: High-priority command panels ──
  const magicPanelProvider = new MagicPanelProvider(extensionUri);
  const magicViewRegistration = vscode.window.registerWebviewViewProvider(
    MagicPanelProvider.viewType,
    magicPanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(magicViewRegistration);

  const pdsePanelProvider = new PDSEPanelProvider(extensionUri);
  const pdseViewRegistration = vscode.window.registerWebviewViewProvider(
    PDSEPanelProvider.viewType,
    pdsePanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(pdseViewRegistration);

  const memoryPanelProvider = new MemoryPanelProvider(extensionUri);
  const memoryViewRegistration = vscode.window.registerWebviewViewProvider(
    MemoryPanelProvider.viewType,
    memoryPanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(memoryViewRegistration);

  const searchPanelProvider = new SearchPanelProvider(extensionUri);
  const searchViewRegistration = vscode.window.registerWebviewViewProvider(
    SearchPanelProvider.viewType,
    searchPanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(searchViewRegistration);

  const agentsPanelProvider = new AgentsPanelProvider(extensionUri);
  const agentsViewRegistration = vscode.window.registerWebviewViewProvider(
    AgentsPanelProvider.viewType,
    agentsPanelProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  context.subscriptions.push(agentsViewRegistration);

  // ── Phase 4 panel providers ──
  if (sessionReady) {
    gitPanelProvider = new GitPanelProvider(extensionUri);
    const gitViewRegistration = vscode.window.registerWebviewViewProvider(
      GitPanelProvider.viewType,
      gitPanelProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    context.subscriptions.push(gitViewRegistration);

    skillsPanelProvider = new SkillsPanelProvider(extensionUri);
    const skillsViewRegistration = vscode.window.registerWebviewViewProvider(
      SkillsPanelProvider.viewType,
      skillsPanelProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    context.subscriptions.push(skillsViewRegistration);

    sessionsPanelProvider = new SessionsPanelProvider(extensionUri);
    const sessionsViewRegistration = vscode.window.registerWebviewViewProvider(
      SessionsPanelProvider.viewType,
      sessionsPanelProvider,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    context.subscriptions.push(sessionsViewRegistration);

    // ── Phase 3 New Panels: Party Progress, Memory Browser, Automation ──
    partyProgressPanel = new PartyProgressPanel(extensionUri, context);
    const partyProgressViewRegistration = vscode.window.registerWebviewViewProvider(
      PartyProgressPanel.viewType,
      partyProgressPanel,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    context.subscriptions.push(partyProgressViewRegistration);

    memoryBrowserPanel = new MemoryBrowserPanel(extensionUri, context);
    const memoryBrowserViewRegistration = vscode.window.registerWebviewViewProvider(
      MemoryBrowserPanel.viewType,
      memoryBrowserPanel,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    context.subscriptions.push(memoryBrowserViewRegistration);

    automationDashboardPanel = new AutomationDashboardPanel(extensionUri, context);
    const automationDashboardViewRegistration = vscode.window.registerWebviewViewProvider(
      AutomationDashboardPanel.viewType,
      automationDashboardPanel,
      { webviewOptions: { retainContextWhenHidden: true } },
    );
    context.subscriptions.push(automationDashboardViewRegistration);

    outputChannel.appendLine("✓ Phase 4 panels registered");
  } else {
    outputChannel.appendLine("⚠ Session/state not available - Phase 4 panels disabled");
  }

  // ── Inline completion ──
  completionProvider = new DanteCodeCompletionProvider();
  const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    completionProvider,
  );
  context.subscriptions.push(completionRegistration);

  // ── Cmd+K Inline Edit Provider ──
  inlineEditProvider = new InlineEditProvider(context.secrets, DEFAULT_MODEL_ID);
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.inlineEdit", () => inlineEditProvider?.execute()),
  );

  // ── Inline completion: cache invalidation + accept detection ──
  const docChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
    if (completionProvider === undefined) return;
    // Update cursor position tracking so cache invalidation knows the current cursor line
    const cursorLine = vscode.window.activeTextEditor?.selection.active.line ?? 0;
    completionProvider.completionCache.updateCursorPosition(
      event.document.uri.toString(),
      cursorLine,
    );
    // Cache invalidation: clear trie entries when edit is above cursor line
    for (const change of event.contentChanges) {
      completionProvider.completionCache.onDocumentChange(
        event.document.uri.toString(),
        change.range.start.line,
        event.document.version,
      );
    }
    // Accept detection for telemetry outcome update + prefetch trigger
    completionProvider.handleDocumentChange(event);
  });
  context.subscriptions.push(docChangeDisposable);

  // ── Status bar ──
  statusBarState = createStatusBar(context);
  updateStatusBar(statusBarState, DEFAULT_MODEL_ID, "none");

  // ── Real-time PDSE score in status bar ──
  if (projectRoot) {
    registerPdseActiveEditorListener(context, statusBarState, projectRoot);
  }

  // ── Diagnostics ──
  diagnosticProvider = new PDSEDiagnosticProvider();
  context.subscriptions.push(diagnosticProvider);

  // ── Onboarding ──
  onboardingProvider = new OnboardingProvider(extensionUri, context.secrets, context);

  // ── Phase 5: UX Enhancements ──
  if (projectRoot) {
    // 1. Visual diff viewer
    registerDiffViewer(context);

    // 2. PDSE score badges in file explorer
    registerFileDecorations(context, projectRoot);

    // 3. Inline verification annotations
    registerVerificationAnnotations(context, projectRoot);

    // 4. Command history with re-run buttons
    registerCommandHistory(context, (command: string) => {
      // Execute command via sidebar provider
      if (chatSidebarProvider) {
        void chatSidebarProvider.sendCommandToChat(command);
      }
    });

    // 5. Quick actions sidebar
    registerQuickActions(context, (command: string) => {
      // Execute command via sidebar provider
      if (chatSidebarProvider) {
        void chatSidebarProvider.sendCommandToChat(command);
      }
    });

    // 6. Session snapshots timeline
    registerTimelineView(context, projectRoot, (id: string) => {
      // Restore checkpoint
      if (checkpointManager) {
        void checkpointManager.rewindCheckpoint(id);
      }
    });

    // 7. Agent progress visualization
    registerAgentProgress(context);

    // 10. Notification toasts
    registerNotificationManager(context);
  }

  // ── Commands ──
  registerCommands(context, chatSidebarProvider);

  // ── Version command ──
  context.subscriptions.push(registerVersionCommand(context));

  // ── First-run onboarding ──
  if (!OnboardingProvider.hasOnboarded(context)) {
    void onboardingProvider.show();
  }

  // ── UX Polish OnboardingWizard ──
  // Runs the ux-polish OnboardingWizard on first activation to guide initial setup.
  // Uses globalState to gate so it only runs once per install.
  if (!context.globalState.get<boolean>("dantecode.uxOnboardingComplete")) {
    const wizard = new OnboardingWizard({
      stateOptions: { projectRoot },
    });
    if (!wizard.isComplete()) {
      void wizard.run({ ci: process.env["CI"] === "true" }).then((result) => {
        if (result.completed) {
          void context.globalState.update("dantecode.uxOnboardingComplete", true);
        }
      });
    } else {
      void context.globalState.update("dantecode.uxOnboardingComplete", true);
    }
  }
}

// ─── Deactivate ──────────────────────────────────────────────────────────────

export function deactivate(): void {
  statusBarState?.item.dispose();
  chatSidebarProvider = undefined;
  auditPanelProvider = undefined;
  automationPanelProvider = undefined;
  verificationPanelProvider = undefined;
  completionProvider = undefined;
  checkpointManager = undefined;
  diffReviewProvider = undefined;
  checkpointTreeProvider = undefined;
  skillsTreeProvider = undefined;
  semanticIndex = undefined;

  if (diagnosticProvider) {
    diagnosticProvider.clearAll();
    diagnosticProvider = undefined;
  }
  disposeInlinePDSEDiagnostics();
  onboardingProvider = undefined;
}

// ─── Command Registration ────────────────────────────────────────────────────

function registerCommands(context: vscode.ExtensionContext, chatSidebarProvider?: ChatSidebarProvider): void {
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
    [
      "dantecode.resumeSession",
      (sessionId?: unknown) => commandResumeSession(sessionId as string | undefined),
    ],
    [
      "dantecode.forkSession",
      (sessionId?: unknown) => commandForkSession(sessionId as string | undefined),
    ],
    [
      "dantecode.deleteCheckpoint",
      (sessionId?: unknown) => commandDeleteCheckpoint(sessionId as string | undefined),
    ],
    ["dantecode.refreshCheckpoints", commandRefreshCheckpoints],
    [
      "dantecode.executeSkill",
      (skillName?: unknown) => commandExecuteSkill(skillName as string | undefined),
    ],
    [
      "dantecode.executeSkillChain",
      (chainName?: unknown) => commandExecuteSkillChain(chainName as string | undefined),
    ],
    ["dantecode.refreshSkills", commandRefreshSkills],
  ];

  // ── Phase 4 commands (from commands-phase4.ts) ──
  if (chatSidebarProvider) {
    const phase4Commands = registerPhase4Commands(chatSidebarProvider, context);
    commands.push(...phase4Commands);
  }

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
    // Auto-commit any local changes before self-update (self-update refuses on dirty repo).
    // Stage tracked modifications, commit if anything changed, push, then update.
    const autoCommitAndUpdate = [
      `git add -u`,
      `git diff --cached --quiet || git commit -m "chore: auto-snapshot before self-update"`,
      `git push origin HEAD`,
      `node packages/cli/dist/index.js self-update --verbose`,
    ].join(" && ");
    terminal.sendText(autoCommitAndUpdate);
    terminal.show();
    void vscode.window
      .showInformationMessage(
        "DanteCode: Committing, pushing, and self-updating… Reload window when the terminal finishes.",
        "Reload Now",
      )
      .then((action) => {
        if (action === "Reload Now") {
          void vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
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

function clearPendingDiff(): void {
  pendingDiffFilePath = undefined;
  pendingDiffNewContent = undefined;
  pendingDiffOldContent = undefined;
}

// ─── Checkpoint/Resume Commands ──────────────────────────────────────────────

async function commandResumeSession(sessionId?: string): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  try {
    const { RecoveryManager, resumeFromCheckpoint, JsonlEventStore } =
      await import("@dantecode/core");
    const recoveryManager = new RecoveryManager({ projectRoot });
    const staleSessions = await recoveryManager.scanStaleSessions();
    const resumableSessions = staleSessions.filter((s) => s.status === "resumable");

    // If sessionId provided, try to find it
    let targetSession;
    if (sessionId) {
      targetSession = resumableSessions.find(
        (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId),
      );
      if (!targetSession) {
        void vscode.window.showWarningMessage(`DanteCode: Session ${sessionId} is not resumable`);
        return;
      }
    } else {
      // Show quick pick if no sessionId provided
      if (resumableSessions.length === 0) {
        void vscode.window.showInformationMessage("DanteCode: No resumable sessions found");
        return;
      }

      const selection = await vscode.window.showQuickPick(
        resumableSessions.map((s) => {
          const timestamp = s.timestamp ? new Date(s.timestamp).toLocaleString() : "unknown";
          const eventInfo = s.lastEventId !== undefined ? ` • ${s.lastEventId} events` : "";
          return {
            label: s.sessionId.slice(0, 12),
            description: timestamp,
            detail: `Step ${s.step ?? 0}${eventInfo}`,
            sessionId: s.sessionId,
          };
        }),
        { placeHolder: "Select a session to resume" },
      );

      if (!selection) {
        return;
      }

      targetSession = resumableSessions.find((s) => s.sessionId === selection.sessionId);
    }

    if (!targetSession) {
      void vscode.window.showWarningMessage("DanteCode: Session not found");
      return;
    }

    // Load checkpoint and event store
    const eventStore = new JsonlEventStore(projectRoot, targetSession.sessionId);
    const resumeContext = await resumeFromCheckpoint(
      projectRoot,
      targetSession.sessionId,
      eventStore,
    );

    if (!resumeContext) {
      void vscode.window.showErrorMessage(
        `DanteCode: Failed to load checkpoint for session ${targetSession.sessionId}`,
      );
      return;
    }

    void vscode.window.showInformationMessage(
      `DanteCode: Resumed session ${targetSession.sessionId.slice(0, 12)} from step ${resumeContext.checkpoint.step} with ${resumeContext.replayEventCount} replay events`,
    );

    // Refresh checkpoint tree
    await checkpointTreeProvider?.refresh();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Resume failed — ${msg}`);
  }
}

async function commandForkSession(sessionId?: string): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  try {
    const { RecoveryManager, EventSourcedCheckpointer } = await import("@dantecode/core");
    const recoveryManager = new RecoveryManager({ projectRoot });
    const staleSessions = await recoveryManager.scanStaleSessions();

    // Find session (allow any status for forking)
    let targetSession;
    if (sessionId) {
      targetSession = staleSessions.find(
        (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId),
      );
      if (!targetSession) {
        void vscode.window.showWarningMessage(`DanteCode: Session ${sessionId} not found`);
        return;
      }
    } else {
      // Show quick pick
      if (staleSessions.length === 0) {
        void vscode.window.showInformationMessage("DanteCode: No sessions available to fork");
        return;
      }

      const selection = await vscode.window.showQuickPick(
        staleSessions.map((s) => {
          const timestamp = s.timestamp ? new Date(s.timestamp).toLocaleString() : "unknown";
          const statusIcon = s.status === "resumable" ? "✓" : s.status === "stale" ? "⚠" : "✗";
          return {
            label: `${statusIcon} ${s.sessionId.slice(0, 12)}`,
            description: `${s.status} • ${timestamp}`,
            detail: `Step ${s.step ?? 0}`,
            sessionId: s.sessionId,
          };
        }),
        { placeHolder: "Select a session to fork" },
      );

      if (!selection) {
        return;
      }

      targetSession = staleSessions.find((s) => s.sessionId === selection.sessionId);
    }

    if (!targetSession) {
      void vscode.window.showWarningMessage("DanteCode: Session not found");
      return;
    }

    // Load checkpoint
    const checkpointer = new EventSourcedCheckpointer(projectRoot, targetSession.sessionId);
    const tuple = await checkpointer.getTuple();

    if (!tuple) {
      void vscode.window.showErrorMessage(
        `DanteCode: Failed to load checkpoint for session ${targetSession.sessionId}`,
      );
      return;
    }

    const { checkpoint } = tuple;

    // Create new branch from checkpoint's worktree ref (or current HEAD)
    const baseRef = checkpoint.worktreeRef || "HEAD";
    const timestamp = Date.now();
    const newBranchName = `fork-${targetSession.sessionId.slice(0, 8)}-${timestamp}`;

    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["branch", newBranchName, baseRef], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    const switchToNew = await vscode.window.showInformationMessage(
      `DanteCode: Forked session to branch ${newBranchName}`,
      "Switch to Branch",
      "Stay Here",
    );

    if (switchToNew === "Switch to Branch") {
      execFileSync("git", ["checkout", newBranchName], {
        cwd: projectRoot,
        encoding: "utf8",
      });
      void vscode.window.showInformationMessage(`DanteCode: Switched to ${newBranchName}`);
    }

    // Refresh checkpoint tree
    await checkpointTreeProvider?.refresh();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Fork failed — ${msg}`);
  }
}

async function commandDeleteCheckpoint(sessionId?: string): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot || !checkpointTreeProvider) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  try {
    const { RecoveryManager } = await import("@dantecode/core");
    const recoveryManager = new RecoveryManager({ projectRoot });
    const staleSessions = await recoveryManager.scanStaleSessions();

    let targetSession;
    if (sessionId) {
      targetSession = staleSessions.find(
        (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId),
      );
    } else {
      // Show quick pick
      if (staleSessions.length === 0) {
        void vscode.window.showInformationMessage("DanteCode: No checkpoints to delete");
        return;
      }

      const selection = await vscode.window.showQuickPick(
        staleSessions.map((s) => {
          const timestamp = s.timestamp ? new Date(s.timestamp).toLocaleString() : "unknown";
          return {
            label: s.sessionId.slice(0, 12),
            description: `${s.status} • ${timestamp}`,
            sessionId: s.sessionId,
          };
        }),
        { placeHolder: "Select a checkpoint to delete" },
      );

      if (!selection) {
        return;
      }

      targetSession = staleSessions.find((s) => s.sessionId === selection.sessionId);
    }

    if (!targetSession) {
      void vscode.window.showWarningMessage("DanteCode: Checkpoint not found");
      return;
    }

    // Confirm deletion
    const confirm = await vscode.window.showWarningMessage(
      `Delete checkpoint ${targetSession.sessionId.slice(0, 12)}?`,
      { modal: true },
      "Delete",
      "Cancel",
    );

    if (confirm !== "Delete") {
      return;
    }

    // Delete checkpoint directory
    const { rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const checkpointDir = join(projectRoot, ".dantecode", "checkpoints", targetSession.sessionId);
    await rm(checkpointDir, { recursive: true, force: true });

    // Delete event log
    const eventLog = join(projectRoot, ".dantecode", "events", `${targetSession.sessionId}.jsonl`);
    await rm(eventLog, { force: true });

    void vscode.window.showInformationMessage(
      `DanteCode: Deleted checkpoint ${targetSession.sessionId.slice(0, 12)}`,
    );

    // Refresh checkpoint tree
    await checkpointTreeProvider.refresh();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Delete failed — ${msg}`);
  }
}

async function commandRefreshCheckpoints(): Promise<void> {
  if (!checkpointTreeProvider) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  await checkpointTreeProvider.refresh();
  const count = checkpointTreeProvider.getCheckpointCount();
  const resumableCount = checkpointTreeProvider.getResumableCount();
  void vscode.window.showInformationMessage(
    `DanteCode: Found ${count} checkpoint(s), ${resumableCount} resumable`,
  );
}

// ─── Skill Commands (Wave 3 Task 3.6) ────────────────────────────────────────

async function commandExecuteSkill(skillName?: string): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  try {
    const { listSkills, getSkill } = await import("@dantecode/skill-adapter");
    const { runSkill, makeRunContext, makeProvenance } = await import("@dantecode/skills-runtime");

    // If no skill name provided, show picker
    if (!skillName) {
      const skills = await listSkills(projectRoot);
      if (skills.length === 0) {
        void vscode.window.showInformationMessage("DanteCode: No skills found");
        return;
      }

      const selected = await vscode.window.showQuickPick(
        skills.map((s) => ({
          label: s.name,
          description: s.importSource || "",
          detail: s.description,
          skillName: s.name,
        })),
        {
          placeHolder: "Select a skill to execute",
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );

      if (!selected) {
        return;
      }

      skillName = selected.skillName;
    }

    // Execute skill
    void vscode.window.showInformationMessage(`DanteCode: Executing skill "${skillName}"...`);

    // Load skill definition
    const skillDef = await getSkill(skillName as string, projectRoot as string);
    if (!skillDef) {
      void vscode.window.showErrorMessage(`DanteCode: Skill "${skillName}" not found`);
      return;
    }

    // Convert to DanteSkill format
    const skill = {
      name: skillDef.frontmatter.name,
      description: skillDef.frontmatter.description ?? "",
      sourceType: "native" as const,
      sourceRef: skillDef.sourcePath ?? skillName,
      license: "MIT",
      instructions: skillDef.instructions,
      commandOverrides: [],
      provenance: makeProvenance({
        sourceType: "native",
        sourceRef: skillDef.sourcePath ?? skillName,
        originalName: skillDef.frontmatter.name,
        license: "MIT",
      }),
    };

    const context = makeRunContext({
      skillName: skillName as string,
      projectRoot: projectRoot as string,
    });
    const result = await runSkill({ skill, context });

    // Show result
    if (result.state === "applied" || result.state === "verified") {
      void vscode.window.showInformationMessage(
        `DanteCode: Skill "${skillName}" completed successfully`,
      );
    } else {
      void vscode.window.showWarningMessage(
        `DanteCode: Skill "${skillName}" completed with state: ${result.state}`,
      );
    }

    // Show output in channel
    const outputChannel = vscode.window.createOutputChannel(`DanteCode: ${skillName}`);
    outputChannel.appendLine(`Skill: ${skillName}`);
    outputChannel.appendLine(`State: ${result.state}`);
    outputChannel.appendLine(`Summary: ${result.plainLanguageSummary}`);
    if (result.commandsRun.length > 0) {
      outputChannel.appendLine(`\nCommands:\n${result.commandsRun.join("\n")}`);
    }
    if (result.filesTouched.length > 0) {
      outputChannel.appendLine(`\nFiles:\n${result.filesTouched.join("\n")}`);
    }
    outputChannel.show();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`DanteCode: Skill execution failed — ${msg}`);
  }
}

async function commandExecuteSkillChain(chainName?: string): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  try {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { executeChain, makeRunContext, makeProvenance } =
      await import("@dantecode/skills-runtime");
    const { getSkill } = await import("@dantecode/skill-adapter");

    // If no chain name provided, show picker
    if (!chainName) {
      const { readdir } = await import("node:fs/promises");
      const chainsDir = join(projectRoot, ".dantecode", "skills", "chains");

      let chainFiles: string[] = [];
      try {
        chainFiles = await readdir(chainsDir);
        chainFiles = chainFiles.filter((f) => f.endsWith(".json"));
      } catch {
        void vscode.window.showInformationMessage("DanteCode: No skill chains found");
        return;
      }

      if (chainFiles.length === 0) {
        void vscode.window.showInformationMessage("DanteCode: No skill chains found");
        return;
      }

      const selected = await vscode.window.showQuickPick(
        chainFiles.map((f) => ({
          label: f.replace(".json", ""),
          description: "Skill chain",
          chainName: f.replace(".json", ""),
        })),
        {
          placeHolder: "Select a skill chain to execute",
        },
      );

      if (!selected) {
        return;
      }

      chainName = selected.chainName;
    }

    // Load chain definition
    const chainPath = join(projectRoot, ".dantecode", "skills", "chains", `${chainName}.json`);
    const chainContent = await readFile(chainPath, "utf-8");
    const chain = JSON.parse(chainContent);

    // Get initial input from user
    const initialInput = await vscode.window.showInputBox({
      prompt: `Enter initial input for chain "${chainName}"`,
      placeHolder: "Chain input (optional)",
    });

    if (initialInput === undefined) {
      return;
    }

    // Execute chain
    void vscode.window.showInformationMessage(`DanteCode: Executing chain "${chainName}"...`);

    // Create a context for chain execution - use a placeholder skill name
    const context = makeRunContext({ skillName: `chain:${chainName}`, projectRoot });

    const result = await executeChain({
      chain,
      initialInput: initialInput || "",
      context,
      skillLoader: async (name: string) => {
        const skillDef = await getSkill(name, projectRoot);
        if (!skillDef) {
          return null;
        }

        return {
          name: skillDef.frontmatter.name,
          description: skillDef.frontmatter.description ?? "",
          sourceType: "native" as const,
          sourceRef: skillDef.sourcePath ?? name,
          license: "MIT",
          instructions: skillDef.instructions,
          commandOverrides: [],
          provenance: makeProvenance({
            sourceType: "native",
            sourceRef: skillDef.sourcePath ?? name,
            originalName: skillDef.frontmatter.name,
            license: "MIT",
          }),
        };
      },
    });

    // Show result
    if (result.success) {
      void vscode.window.showInformationMessage(
        `DanteCode: Chain "${chainName}" completed successfully (${result.stepResults.length} steps)`,
      );
    } else {
      void vscode.window.showWarningMessage(
        `DanteCode: Chain "${chainName}" failed at step ${result.failedAtStep !== undefined ? result.failedAtStep + 1 : "unknown"}`,
      );
    }

    // Show output in channel
    const outputChannel = vscode.window.createOutputChannel(`DanteCode: ${chainName}`);
    outputChannel.appendLine(`Chain: ${chainName}`);
    outputChannel.appendLine(`Success: ${result.success}`);
    outputChannel.appendLine(`Steps completed: ${result.stepResults.length}`);
    outputChannel.appendLine("");

    for (const stepResult of result.stepResults) {
      outputChannel.appendLine(`Step ${stepResult.stepIndex + 1}: ${stepResult.skillName}`);
      outputChannel.appendLine(`  State: ${stepResult.result.state}`);
      outputChannel.appendLine(
        `  Summary: ${stepResult.result.plainLanguageSummary.substring(0, 200)}${stepResult.result.plainLanguageSummary.length > 200 ? "..." : ""}`,
      );
    }

    outputChannel.show();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`DanteCode: Chain execution failed — ${msg}`);
  }
}

async function commandRefreshSkills(): Promise<void> {
  if (!skillsTreeProvider) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  skillsTreeProvider.refresh();
  void vscode.window.showInformationMessage("DanteCode: Skills refreshed");
}
