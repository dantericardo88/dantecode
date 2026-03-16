// ============================================================================
// DanteCode VS Code Extension — Main Entry Point
// Registers all commands, sidebar providers, inline completion, status bar,
// and diagnostics. Implements the full PRD D4.8 extension surface area.
// ============================================================================

import * as vscode from "vscode";
import type { GStackCommand, Lesson } from "@dantecode/config-types";
import { readOrInitializeState, initializeState, appendAuditEvent } from "@dantecode/core";
import {
  runLocalPDSEScorer,
  runGStack,
  summarizeGStackResults,
  allGStackPassed,
  queryLessons,
  formatLessonsForPrompt,
} from "@dantecode/danteforge";
import { importSkills } from "@dantecode/skill-adapter";

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
import { OnboardingProvider, FRONTIER_MODELS } from "./onboarding-provider.js";

// ─── Module-Level State ──────────────────────────────────────────────────────

let statusBarState: StatusBarState | undefined;
let chatSidebarProvider: ChatSidebarProvider | undefined;
let auditPanelProvider: AuditPanelProvider | undefined;
let completionProvider: DanteCodeCompletionProvider | undefined;
let diagnosticProvider: PDSEDiagnosticProvider | undefined;
let onboardingProvider: OnboardingProvider | undefined;

// ─── Activate ────────────────────────────────────────────────────────────────

/**
 * Extension activation entry point. Called by VS Code when the extension
 * activates (on startup finished, per activationEvents in package.json).
 *
 * Registers:
 * - Chat sidebar webview provider
 * - Audit log webview provider
 * - Inline completion provider
 * - Status bar item
 * - PDSE diagnostic collection
 * - All 11 commands from the package.json contributes
 *
 * @param context - The extension context provided by VS Code.
 */
export function activate(context: vscode.ExtensionContext): void {
  const extensionUri = context.extensionUri;

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

  // ── Inline completion provider ──
  completionProvider = new DanteCodeCompletionProvider();
  const completionRegistration = vscode.languages.registerInlineCompletionItemProvider(
    { pattern: "**" },
    completionProvider,
  );
  context.subscriptions.push(completionRegistration);

  // ── Status bar ──
  statusBarState = createStatusBar(context);

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

  // ── Output channel for logging ──
  const outputChannel = vscode.window.createOutputChannel("DanteCode");
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("DanteCode extension activated");

  // ── First-run onboarding ──
  if (!OnboardingProvider.hasOnboarded(context)) {
    void onboardingProvider.show();
  }
}

// ─── Deactivate ──────────────────────────────────────────────────────────────

/**
 * Extension deactivation entry point. Called by VS Code when the extension
 * is deactivated or the editor closes. Cleans up module-level state.
 */
export function deactivate(): void {
  statusBarState = undefined;
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

/**
 * Registers all DanteCode commands. Each command is connected to its
 * implementation function and added to the extension's subscriptions
 * for automatic disposal on deactivation.
 */
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

/**
 * Opens the DanteCode chat sidebar. If the sidebar is already visible,
 * focuses on it.
 */
async function commandOpenChat(): Promise<void> {
  await vscode.commands.executeCommand("dantecode.chatView.focus");
}

/**
 * Adds the currently active editor file to the chat context. If called
 * from the right-click context menu, uses the targeted file.
 */
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
    chatSidebarProvider.addFileToContext(filePath);
    void vscode.window.showInformationMessage(
      `DanteCode: Added "${getFileName(filePath)}" to context`,
    );
  }
}

/**
 * Imports Claude Code skills from the user's .claude/commands directory
 * into the DanteCode project as wrapped SKILL.dc.md files.
 */
async function commandImportClaudeSkills(): Promise<void> {
  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace folder first");
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
        const result = await importSkills({
          source: "claude",
          projectRoot,
          sessionId: `import-${Date.now()}`,
        });

        const parts: string[] = [];
        if (result.imported.length > 0) {
          parts.push(`Imported ${result.imported.length} skill(s): ${result.imported.join(", ")}`);
        }
        if (result.skipped.length > 0) {
          parts.push(
            `Skipped ${result.skipped.length}: ${result.skipped.map((s: { name: string; reason: string }) => `${s.name} (${s.reason})`).join("; ")}`,
          );
        }
        if (result.errors.length > 0) {
          parts.push(`Errors: ${result.errors.join("; ")}`);
        }

        if (parts.length === 0) {
          void vscode.window.showInformationMessage("DanteCode: No Claude skills found to import");
        } else {
          void vscode.window.showInformationMessage(`DanteCode: ${parts.join(". ")}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`DanteCode: Failed to import skills: ${message}`);
      }
    },
  );
}

/**
 * Runs the PDSE scorer on the currently active file and displays the
 * results as diagnostics in the Problems panel. Also updates the
 * status bar and chat sidebar with the score.
 */
async function commandRunPDSE(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("DanteCode: No active file to score");
    return;
  }

  const document = editor.document;
  const code = document.getText();
  const projectRoot = getProjectRoot() || "";

  if (statusBarState) {
    updateStatusBar(statusBarState, statusBarState.currentModel, "pending");
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DanteCode: Running PDSE score...",
      cancellable: false,
    },
    async () => {
      try {
        const score = runLocalPDSEScorer(code, projectRoot);

        // Update diagnostics in the Problems panel
        if (diagnosticProvider) {
          diagnosticProvider.updateDiagnostics(document.uri, score);
        }

        // Update status bar
        if (statusBarState) {
          const gateStatus = score.passedGate ? "passed" : "failed";
          updateStatusBar(statusBarState, statusBarState.currentModel, gateStatus);
        }

        // Send score to chat sidebar
        if (chatSidebarProvider) {
          chatSidebarProvider.sendPDSEScore(score);
        }

        // Log the PDSE gate event
        try {
          await appendAuditEvent(projectRoot, {
            sessionId: `pdse-${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: score.passedGate ? "pdse_gate_pass" : "pdse_gate_fail",
            payload: {
              file: document.uri.fsPath,
              overall: score.overall,
              completeness: score.completeness,
              correctness: score.correctness,
              clarity: score.clarity,
              consistency: score.consistency,
              violationCount: score.violations.length,
            },
            modelId: "pdse-local",
            projectRoot,
          });
        } catch {
          // Audit logging failure should not block the UI feedback
        }

        // Show result notification
        const status = score.passedGate ? "PASSED" : "FAILED";
        void vscode.window.showInformationMessage(
          `DanteCode PDSE: ${status} (score: ${score.overall}, violations: ${score.violations.length})`,
        );
      } catch (err: unknown) {
        if (statusBarState) {
          updateStatusBar(statusBarState, statusBarState.currentModel, "none");
        }

        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`DanteCode: PDSE scoring failed: ${message}`);
      }
    },
  );
}

/**
 * Runs the GStack quality assurance commands defined in the project's
 * STATE.yaml. Shows results in an output channel and notification.
 */
async function commandRunGStack(): Promise<void> {
  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace folder first");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DanteCode: Running GStack QA...",
      cancellable: false,
    },
    async () => {
      try {
        const state = await readOrInitializeState(projectRoot);
        const commands: GStackCommand[] = state.autoforge.gstackCommands;

        if (commands.length === 0) {
          void vscode.window.showInformationMessage(
            "DanteCode: No GStack commands configured. Add commands to autoforge.gstackCommands in STATE.yaml.",
          );
          return;
        }

        const results = await runGStack("", commands, projectRoot);
        const summary = summarizeGStackResults(results);
        const allPassed = allGStackPassed(results);

        // Show in output channel
        const outputChannel = vscode.window.createOutputChannel("DanteCode GStack");
        outputChannel.clear();
        outputChannel.appendLine("=== DanteCode GStack QA Results ===");
        outputChannel.appendLine("");
        outputChannel.appendLine(summary);
        outputChannel.appendLine("");
        outputChannel.appendLine(allPassed ? "All checks PASSED" : "Some checks FAILED");
        outputChannel.show(true);

        // Log audit event
        try {
          await appendAuditEvent(projectRoot, {
            sessionId: `gstack-${Date.now()}`,
            timestamp: new Date().toISOString(),
            type: allPassed ? "autoforge_success" : "autoforge_abort",
            payload: {
              commandCount: commands.length,
              passedCount: results.filter((r) => r.passed).length,
              failedCount: results.filter((r) => !r.passed).length,
              totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
            },
            modelId: "gstack",
            projectRoot,
          });
        } catch {
          // Audit logging failure should not block the UI feedback
        }

        // Show notification
        if (allPassed) {
          void vscode.window.showInformationMessage(
            `DanteCode GStack: All ${results.length} checks passed`,
          );
        } else {
          const failCount = results.filter((r) => !r.passed).length;
          void vscode.window.showWarningMessage(
            `DanteCode GStack: ${failCount} of ${results.length} checks failed`,
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`DanteCode: GStack failed: ${message}`);
      }
    },
  );
}

/**
 * Presents a quick-pick menu for the user to select a different model.
 * Updates the VS Code setting, status bar, and notifies the chat sidebar.
 */
async function commandSwitchModel(): Promise<void> {
  const models: vscode.QuickPickItem[] = FRONTIER_MODELS.map((m) => ({
    label: m.id,
    description: m.label,
    detail: m.provider === "ollama" ? "Run locally via Ollama" : `${m.provider} cloud API`,
  }));

  // Mark the current model
  const currentModel = statusBarState?.currentModel ?? "grok/grok-3";
  for (const model of models) {
    if (model.label === currentModel) {
      model.description = `${model.description ?? ""} (current)`;
    }
  }

  const picked = await vscode.window.showQuickPick(models, {
    placeHolder: "Select a model for DanteCode",
    title: "DanteCode: Switch Model",
  });

  if (!picked) {
    return;
  }

  const newModel = picked.label;

  // Update VS Code settings
  const config = vscode.workspace.getConfiguration("dantecode");
  await config.update("defaultModel", newModel, vscode.ConfigurationTarget.Global);

  // Update status bar
  if (statusBarState) {
    updateStatusBar(statusBarState, newModel, statusBarState.gateStatus);
  }

  // Clear the inline completion cache since model changed
  if (completionProvider) {
    completionProvider.clearCache();
  }

  void vscode.window.showInformationMessage(`DanteCode: Switched to ${newModel}`);
}

/**
 * Toggles the sandbox mode setting and updates the status bar.
 */
async function commandToggleSandbox(): Promise<void> {
  const config = vscode.workspace.getConfiguration("dantecode");
  const current = config.get<boolean>("sandboxEnabled", false);
  const next = !current;

  await config.update("sandboxEnabled", next, vscode.ConfigurationTarget.Global);

  if (statusBarState) {
    updateSandboxStatus(statusBarState, next);
  }

  void vscode.window.showInformationMessage(
    `DanteCode: Sandbox mode ${next ? "enabled" : "disabled"}`,
  );
}

/**
 * Shows the project's learned lessons in a quick-pick list. Lessons can
 * be reviewed and dismissed from here.
 */
async function commandShowLessons(): Promise<void> {
  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace folder first");
    return;
  }

  try {
    const lessons = await queryLessons({
      projectRoot,
      limit: 50,
    });

    if (lessons.length === 0) {
      void vscode.window.showInformationMessage(
        "DanteCode: No lessons recorded for this project yet",
      );
      return;
    }

    const items: vscode.QuickPickItem[] = lessons.map((lesson: Lesson) => ({
      label: `[${lesson.severity.toUpperCase()}] ${lesson.pattern}`,
      description: `(seen ${lesson.occurrences}x)`,
      detail: lesson.correction,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: "Project lessons learned from previous sessions",
      title: `DanteCode: ${lessons.length} Lessons`,
      canPickMany: false,
    });

    if (picked) {
      // Show the full lesson in a new editor tab as read-only text
      const formatted = formatLessonsForPrompt(lessons);
      const doc = await vscode.workspace.openTextDocument({
        content: formatted,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Failed to load lessons: ${message}`);
  }
}

/**
 * Initializes a new DanteCode project by creating the .dantecode/ directory
 * and STATE.yaml with default configuration. Shows a confirmation dialog
 * if the state already exists.
 */
async function commandInitProject(): Promise<void> {
  const projectRoot = getProjectRoot();
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace folder first");
    return;
  }

  try {
    // Check if STATE.yaml already exists
    let existingState = false;
    try {
      await readOrInitializeState(projectRoot);
      existingState = true;
    } catch {
      existingState = false;
    }

    if (existingState) {
      const choice = await vscode.window.showWarningMessage(
        "DanteCode: Project already initialized. Re-initialize with defaults?",
        "Re-initialize",
        "Cancel",
      );
      if (choice !== "Re-initialize") {
        return;
      }
    }

    await initializeState(projectRoot);

    void vscode.window.showInformationMessage(
      "DanteCode: Project initialized. Configuration written to .dantecode/STATE.yaml",
    );

    // Log the initialization as an audit event
    try {
      await appendAuditEvent(projectRoot, {
        sessionId: `init-${Date.now()}`,
        timestamp: new Date().toISOString(),
        type: "session_start",
        payload: { action: "project_init", projectRoot },
        modelId: "dantecode",
        projectRoot,
      });
    } catch {
      // Audit logging failure should not block project initialization
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`DanteCode: Failed to initialize project: ${message}`);
  }
}

/**
 * Accepts a pending diff hunk. In the current implementation, this applies
 * the active editor's pending diff and optionally commits the change.
 */
async function commandAcceptDiff(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("DanteCode: No active editor with diff");
    return;
  }

  const config = vscode.workspace.getConfiguration("dantecode");
  const autoCommit = config.get<boolean>("autoCommit", true);
  const projectRoot = getProjectRoot() || "";

  // Save the current file
  await editor.document.save();

  void vscode.window.showInformationMessage("DanteCode: Diff hunk accepted");

  // Log the accept event
  try {
    await appendAuditEvent(projectRoot, {
      sessionId: `diff-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "file_edit",
      payload: {
        action: "diff_accepted",
        file: editor.document.uri.fsPath,
        autoCommit,
      },
      modelId: "dantecode",
      projectRoot,
    });
  } catch {
    // Audit logging failure should not block diff acceptance
  }

  // If auto-commit is enabled, stage and commit the file
  if (autoCommit && projectRoot) {
    try {
      const terminal = vscode.window.createTerminal({
        name: "DanteCode Commit",
        cwd: projectRoot,
      });
      const relativePath = editor.document.uri.fsPath.replace(projectRoot, "");
      terminal.sendText(
        `git add "${relativePath}" && git commit -m "dantecode: accepted edit to ${getFileName(editor.document.uri.fsPath)}"`,
        true,
      );
      terminal.show(false);
    } catch {
      // Git commit failure is non-critical
    }
  }
}

/**
 * Rejects a pending diff hunk by reverting the active editor to its
 * last saved state.
 */
async function commandRejectDiff(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("DanteCode: No active editor with diff");
    return;
  }

  const projectRoot = getProjectRoot() || "";

  // Revert the document to its saved state
  await vscode.commands.executeCommand("workbench.action.files.revert");

  void vscode.window.showInformationMessage("DanteCode: Diff hunk rejected");

  // Log the rejection event
  try {
    await appendAuditEvent(projectRoot, {
      sessionId: `diff-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: "file_edit",
      payload: {
        action: "diff_rejected",
        file: editor.document.uri.fsPath,
      },
      modelId: "dantecode",
      projectRoot,
    });
  } catch {
    // Audit logging failure should not block diff rejection
  }
}

/**
 * Opens the API key setup / onboarding panel.
 */
async function commandSetupApiKeys(): Promise<void> {
  if (onboardingProvider) {
    await onboardingProvider.show();
  }
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Returns the first workspace folder's fsPath, or undefined if no folder is open.
 */
function getProjectRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}

/**
 * Extracts the file name from an absolute path, handling both forward
 * and backward slashes.
 */
function getFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? filePath;
}
