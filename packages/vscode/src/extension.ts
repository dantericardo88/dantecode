// ============================================================================
// DanteCode VS Code Extension — Main Entry Point
// Registers providers, status bar, diagnostics, and all commands.
// ============================================================================

import * as vscode from "vscode";
import * as path from "path";
import { readFile, mkdir, writeFile } from "node:fs/promises";

import { ChatSidebarProvider } from "./sidebar-provider.js";
import { AuditPanelProvider } from "./audit-panel-provider.js";
import { DanteCodeCompletionProvider } from "./inline-completion.js";
import {
  createStatusBar,
  updateStatusBar,
  updateSandboxStatus,
  type StatusBarState,
} from "./status-bar.js";
import { PDSEDiagnosticProvider } from "./diagnostics.js";
import { OnboardingProvider } from "./onboarding-provider.js";
import { RepoMapTreeDataProvider } from "./repo-map-tree-provider.js";

// ─── Module-Level State ──────────────────────────────────────────────────────

let statusBarState: StatusBarState | undefined;
let chatSidebarProvider: ChatSidebarProvider | undefined;
let auditPanelProvider: AuditPanelProvider | undefined;
let completionProvider: DanteCodeCompletionProvider | undefined;
let diagnosticProvider: PDSEDiagnosticProvider | undefined;
let onboardingProvider: OnboardingProvider | undefined;

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
    const treeProvider = new RepoMapTreeDataProvider(projectRoot);
    const repoTree = vscode.window.createTreeView("dantecode.repoMap", {
      treeDataProvider: treeProvider,
    });
    context.subscriptions.push(repoTree);
  }

  // ── Sidebar providers ──
  chatSidebarProvider = new ChatSidebarProvider(extensionUri, context.secrets, context.globalState);
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

  // ── Inline completion ──
  completionProvider = new DanteCodeCompletionProvider();
  const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    completionProvider,
  );
  context.subscriptions.push(completionRegistration);

  // ── Status bar ──
  statusBarState = createStatusBar(context);
  updateStatusBar(statusBarState, "grok/grok-3", "none");

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
}

// ─── Deactivate ──────────────────────────────────────────────────────────────

export function deactivate(): void {
  statusBarState?.item.dispose();
  chatSidebarProvider = undefined;
  auditPanelProvider = undefined;
  completionProvider = undefined;

  if (diagnosticProvider) {
    diagnosticProvider.clearAll();
    diagnosticProvider = undefined;
  }
  onboardingProvider = undefined;
}

// ─── Command Registration ────────────────────────────────────────────────────

function registerCommands(context: vscode.ExtensionContext): void {
  const commands: Array<[string, (...args: unknown[]) => unknown]> = [
    ["dantecode.selfUpdate", commandSelfUpdate],
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
      cancellable: false,
    },
    async () => {
      try {
        const { scanClaudeSkills, importSkills } = await import("@dantecode/skill-adapter");
        const scanned = await scanClaudeSkills(projectRoot);
        if (scanned.length === 0) {
          void vscode.window.showInformationMessage("DanteCode: No Claude skills found in project");
          return;
        }
        const result = await importSkills({ projectRoot, source: "claude" });
        void vscode.window.showInformationMessage(
          `DanteCode: Imported ${result.imported.length} skill(s), ${result.skipped.length} skipped`,
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

        // Push violations to diagnostics
        if (diagnosticProvider && score.violations.length > 0) {
          diagnosticProvider.clearAll();
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

  const terminal = vscode.window.createTerminal({
    name: "DanteCode GStack",
    cwd: projectRoot,
  });
  terminal.sendText("npm run typecheck && npm run lint && npm test");
  terminal.show();
  void vscode.window.showInformationMessage("DanteCode: GStack pipeline running in terminal");
}

async function commandSwitchModel(): Promise<void> {
  const models = [
    "grok/grok-3",
    "grok/grok-4-1-fast-reasoning",
    "anthropic/claude-sonnet-4-6",
    "openai/gpt-4o",
    "google/gemini-2.5-pro",
    "groq/llama-3.3-70b-versatile",
    "ollama/llama3",
  ];
  const selected = await vscode.window.showQuickPick(models, { placeHolder: "Select model" });
  if (selected && statusBarState) {
    updateStatusBar(statusBarState, selected, "none");
    void vscode.window.showInformationMessage(`DanteCode: Switched to ${selected}`);
  }
}

async function commandToggleSandbox(): Promise<void> {
  if (statusBarState) {
    const enabled = statusBarState.sandboxEnabled;
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
      void vscode.window.showInformationMessage("DanteCode: No lessons recorded for this project");
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: formatLessonsForPrompt(lessons),
      language: "markdown",
    });
    await vscode.window.showTextDocument(doc, { preview: true });
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

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DanteCode: Initializing project...",
      cancellable: false,
    },
    async () => {
      try {
        const dantecodeDir = path.join(projectRoot, ".dantecode");
        await mkdir(dantecodeDir, { recursive: true });
        await mkdir(path.join(dantecodeDir, "agents"), { recursive: true });
        await mkdir(path.join(dantecodeDir, "lessons"), { recursive: true });

        const statePath = path.join(dantecodeDir, "STATE.yaml");
        try {
          await readFile(statePath, "utf-8");
        } catch {
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
        }

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
    pendingDiffFilePath = undefined;
    pendingDiffNewContent = undefined;
    pendingDiffOldContent = undefined;
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
    pendingDiffFilePath = undefined;
    pendingDiffNewContent = undefined;
    pendingDiffOldContent = undefined;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Failed to revert diff — ${msg}`);
  }
}

async function commandSetupApiKeys(): Promise<void> {
  void vscode.commands.executeCommand("workbench.action.openSettings", "dantecode");
}

async function commandSelfUpdate(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }
  const terminal = vscode.window.createTerminal({
    name: "DanteCode Self-Update",
    cwd: projectRoot,
  });
  terminal.sendText("npx dantecode self-update --verbose");
  terminal.show();
  void vscode.window.showInformationMessage("DanteCode: Self-update started in terminal");
}

/**
 * Sets the pending diff for accept/reject commands. Called from the sidebar
 * when a diff hunk is emitted.
 */
export function setPendingDiff(filePath: string, oldContent: string, newContent: string): void {
  pendingDiffFilePath = filePath;
  pendingDiffOldContent = oldContent;
  pendingDiffNewContent = newContent;
}
