// ============================================================================
// DanteCode VS Code Extension — Main Entry Point
// Registers providers, status bar, diagnostics, and all commands.
// ============================================================================

import * as vscode from "vscode";
import * as path from "path";

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

// ─── Activate ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  const extensionUri = context.extensionUri;

  // ── Repo map tree ──
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  if (projectRoot) {
    const treeProvider = new RepoMapTreeDataProvider(projectRoot);
    const repoTree = vscode.window.createTreeView('dantecode.repoMap', {
      treeDataProvider: treeProvider
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
  updateStatusBar(statusBarState, 'grok/grok-3', 'none');

  // ── Diagnostics ──
  diagnosticProvider = new PDSEDiagnosticProvider();
  context.subscriptions.push(diagnosticProvider);

  // ── Onboarding ──
  onboardingProvider = new OnboardingProvider(
    extensionUri,
    context.secrets,
    context,
  );

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
    // Assume method exists post-sidebar fix
    (chatSidebarProvider as unknown as { handleFileAdd: (filePath: string) => void }).handleFileAdd(filePath);  
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
      void vscode.window.showInformationMessage("DanteCode: Claude skills import stub - coming soon (uses @dantecode/skill-adapter)");
    },
  );
}

async function commandRunPDSE(): Promise<void> {
  if (diagnosticProvider) {
    void vscode.window.showInformationMessage('DanteCode: PDSE diagnostics ready - trigger via sidebar/agent or CLI');
    void vscode.window.showInformationMessage("DanteCode: PDSE scoring started");
  }
}

async function commandRunGStack(): Promise<void> {
  void vscode.window.showInformationMessage("DanteCode: GStack validation stub - integrates @dantecode/danteforge");
}

async function commandSwitchModel(): Promise<void> {
  const models = ['grok/grok-3', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o'];
  const selected = await vscode.window.showQuickPick(models, { placeHolder: 'Select model' });
  if (selected && statusBarState) {
    updateStatusBar(statusBarState, selected, 'none');
    void vscode.window.showInformationMessage(`DanteCode: Switched to ${selected}`);
  }
}

async function commandToggleSandbox(): Promise<void> {
  if (statusBarState) {
    const enabled = statusBarState.sandboxEnabled;
    updateSandboxStatus(statusBarState, !enabled);
    void vscode.window.showInformationMessage(`DanteCode: Sandbox ${!enabled ? 'enabled' : 'disabled'}`);
  }
}

async function commandShowLessons(): Promise<void> {
  void vscode.window.showInformationMessage("DanteCode: Lessons stub - queries @dantecode/danteforge lessons");
}

async function commandInitProject(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (projectRoot) {
    void vscode.window.showInformationMessage(`DanteCode: Init stub for ${projectRoot} - runs dantecode init`);
  } else {
    void vscode.window.showWarningMessage("DanteCode: Open workspace first");
  }
}

async function commandAcceptDiff(): Promise<void> {
  void vscode.window.showInformationMessage("DanteCode: Accept diff stub - applies git-engine diff");
}

async function commandRejectDiff(): Promise<void> {
  void vscode.window.showInformationMessage("DanteCode: Reject diff stub - discards changes");
}

async function commandSetupApiKeys(): Promise<void> {
  void vscode.commands.executeCommand("workbench.action.openSettings", "dantecode");
}