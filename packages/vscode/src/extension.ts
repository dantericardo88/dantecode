// ============================================================================
// DanteCode VS Code Extension — Main Entry Point
// Registers providers, status bar, diagnostics, and all commands.
// ============================================================================

import * as vscode from "vscode";
import * as path from "path";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { DEFAULT_MODEL_ID, MODEL_CATALOG, detectInstallContext } from "@dantecode/core";
import { OnboardingWizard } from "@dantecode/ux-polish";

import { ChatSidebarProvider } from "./sidebar-provider.js";
import { AuditPanelProvider } from "./audit-panel-provider.js";
import { AutomationPanelProvider } from "./automation-panel-provider.js";
import { VerificationPanelProvider } from "./verification-panel-provider.js";
import { DanteCodeCompletionProvider, disposeInlinePDSEDiagnostics } from "./inline-completion.js";
import {
  createStatusBar,
  updateStatusBar,
  updateStatusBarInfo,
  updateSandboxStatus,
  updateStatusBarWithCost,
  type StatusBarState,
} from "./status-bar.js";
import { PDSEDiagnosticProvider } from "./diagnostics.js";
import { OnboardingProvider } from "./onboarding-provider.js";
import { RepoMapTreeDataProvider } from "./repo-map-tree-provider.js";
import { CheckpointManager } from "./checkpoint-manager.js";
import { DiffReviewProvider, type PendingDiffReview } from "./diff-review-provider.js";

// ─── Module-Level State ──────────────────────────────────────────────────────

let statusBarState: StatusBarState | undefined;
let chatSidebarProvider: ChatSidebarProvider | undefined;
let auditPanelProvider: AuditPanelProvider | undefined;
let automationPanelProvider: AutomationPanelProvider | undefined;
let verificationPanelProvider: VerificationPanelProvider | undefined;
let completionProvider: DanteCodeCompletionProvider | undefined;
let diagnosticProvider: PDSEDiagnosticProvider | undefined;
let onboardingProvider: OnboardingProvider | undefined;
let checkpointManager: CheckpointManager | undefined;
let diffReviewProvider: DiffReviewProvider | undefined;

/** Tracks the last diff hunk file path for accept/reject commands. */
let pendingDiffFilePath: string | undefined;
let pendingDiffNewContent: string | undefined;
let pendingDiffOldContent: string | undefined;

// ─── Activate ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const extensionUri = context.extensionUri;

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

  // ── Inline completion ──
  completionProvider = new DanteCodeCompletionProvider();
  const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    completionProvider,
  );
  context.subscriptions.push(completionRegistration);

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

  // ── Diagnostics ──
  diagnosticProvider = new PDSEDiagnosticProvider();
  context.subscriptions.push(diagnosticProvider);

  // ── Onboarding ──
  onboardingProvider = new OnboardingProvider(extensionUri, context.secrets, context);

  // ── Commands ──
  registerCommands(context);

  // ── Output channel ──
  const outputChannel = vscode.window.createOutputChannel("DanteCode");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("DanteCode extension activated");

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

  if (diagnosticProvider) {
    diagnosticProvider.clearAll();
    diagnosticProvider = undefined;
  }
  disposeInlinePDSEDiagnostics();
  onboardingProvider = undefined;
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
