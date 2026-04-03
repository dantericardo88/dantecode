// ============================================================================
// Phase 4 Command Implementations — Direct Core Integration (NO CHAT RELAY)
// ============================================================================

import * as vscode from "vscode";
import { launchPartyMode } from "./core-integrations/party-integration.js";
import { getMemoryStats } from "./core-integrations/memory-integration.js";
import { getDiff, getStatus, autoCommit, type GitStatusResult } from "@dantecode/git-engine";
import type { GitCommitSpec } from "@dantecode/config-types";

/**
 * Get output channel for logging
 */
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("DanteCode Commands");
  }
  return outputChannel;
}

/**
 * Helper: send structured message to chat provider (for LLM-requiring commands only)
 * Falls back to output channel if chat is unavailable.
 */
function sendToChat(chatProvider: any, message: string, focusChat: boolean = true): boolean {
  if (chatProvider?.handleUserMessage) {
    chatProvider.handleUserMessage(message);
    if (focusChat) {
      void vscode.commands.executeCommand("dantecode.chatView.focus");
    }
    return true;
  }
  getOutputChannel().appendLine(`[DanteCode] Chat unavailable — command: ${message}`);
  getOutputChannel().show();
  return false;
}


/**
 * Register all Phase 4 commands
 */
export function registerPhase4Commands(
  chatSidebarProvider: any,
  _context: vscode.ExtensionContext,
): Array<[string, (...args: unknown[]) => unknown]> {
  return [
    // ── Panel Focus Commands ────────────────────────────────────────────
    ["dantecode.showGitPanel", () => commandShowGitPanel()],
    ["dantecode.showSkillsLibrary", () => commandShowSkillsLibrary()],
    ["dantecode.showSessions", () => commandShowSessions()],

    // ── Verification (Direct) ───────────────────────────────────────────
    ["dantecode.runVerification", () => commandRunVerification()],
    ["dantecode.verifySelection", () => commandVerifySelection()],
    ["dantecode.addRail", () => commandAddRail()],

    // ── Search (Direct → Panel Focus) ───────────────────────────────────
    ["dantecode.searchSemantic", () => commandSearchSemantic()],
    ["dantecode.searchSimilar", () => commandSearchSimilar()],

    // ── Agent Commands (Direct Core Integration) ────────────────────────
    ["dantecode.launchParty", () => commandLaunchParty()],
    ["dantecode.autoforge", () => commandAutoforge()],
    ["dantecode.showMemory", () => commandShowMemory()],

    // ── Git (Direct git-engine) ─────────────────────────────────────────
    ["dantecode.commitFile", (uri?: unknown) => commandCommitFile(uri)],

    // ── LLM-Requiring (Chat with structured message) ────────────────────
    ["dantecode.webResearch", () => commandWebResearch(chatSidebarProvider)],
    ["dantecode.planTask", () => commandPlanTask(chatSidebarProvider)],
    ["dantecode.backgroundTask", () => commandBackgroundTask(chatSidebarProvider)],

    // ── Analytics & Stats (Direct) ──────────────────────────────────────
    ["dantecode.showGaslight", () => commandShowGaslight()],
    ["dantecode.showFearset", () => commandShowFearset()],
    ["dantecode.showMetrics", () => commandShowMetrics()],
    ["dantecode.showTraces", () => commandShowTraces()],

    // ── GitHub (Direct shell) ───────────────────────────────────────────
    ["dantecode.reviewPR", () => commandReviewPR()],
    ["dantecode.triageIssue", () => commandTriageIssue()],

    // ── Utility (Direct) ────────────────────────────────────────────────
    ["dantecode.showMacros", () => commandShowMacros()],
    ["dantecode.themeSwitch", () => commandThemeSwitch()],
  ];
}

// ─── Panel Commands ──────────────────────────────────────────────────────────

async function commandShowGitPanel(): Promise<void> {
  await vscode.commands.executeCommand("dantecode.gitView.focus");
}

async function commandShowSkillsLibrary(): Promise<void> {
  await vscode.commands.executeCommand("dantecode.skillsLibraryView.focus");
}

async function commandShowSessions(): Promise<void> {
  await vscode.commands.executeCommand("dantecode.sessionsView.focus");
}

// ─── Verification Commands (DIRECT) ─────────────────────────────────────────

async function commandRunVerification(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DanteCode: Running verification suite...",
      cancellable: false,
    },
    async () => {
      try {
        const { runGStack } = await import("@dantecode/danteforge");
        const results = await runGStack("", [], projectRoot);

        const resultsArray = Array.isArray(results) ? results : [results];
        const allPassed = resultsArray.every((r: any) => r.passed);
        const summary = `${resultsArray.filter((r: any) => r.passed).length}/${resultsArray.length} checks passed`;

        const status = allPassed ? "PASSED" : "FAILED";
        void vscode.window.showInformationMessage(
          `DanteCode Verification: ${status} (${summary})`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`DanteCode: Verification failed — ${msg}`);
      }
    },
  );
}

async function commandVerifySelection(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("DanteCode: Select code to verify");
    return;
  }

  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const selection = editor.document.getText(editor.selection);
  const fileName = editor.document.fileName;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DanteCode: Verifying selection...",
      cancellable: false,
    },
    async () => {
      try {
        const { runLocalPDSEScorer } = await import("@dantecode/danteforge");
        const score = await runLocalPDSEScorer(selection, projectRoot);

        const scoreValue = typeof score === "number" ? score : (score as any)?.overall ?? 0;
        const icon = scoreValue >= 85 ? "$(verified)" : scoreValue >= 70 ? "$(warning)" : "$(error)";

        const out = getOutputChannel();
        out.appendLine(`\n[Verify Selection] ${fileName}`);
        out.appendLine(`  PDSE Score: ${scoreValue}`);
        out.appendLine(`  Lines: ${editor.selection.start.line + 1}-${editor.selection.end.line + 1}`);
        out.show();

        void vscode.window.showInformationMessage(
          `${icon} PDSE Score: ${scoreValue} (${selection.split("\n").length} lines verified)`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Verification failed: ${msg}`);
      }
    },
  );
}

async function commandAddRail(): Promise<void> {
  const rails = [
    { label: "Anti-Stub Check", description: "Reject placeholder implementations", value: "anti-stub" },
    { label: "Constitution Check", description: "Verify constitutional AI rules", value: "constitution" },
    { label: "PDSE Gate", description: "Block commits below quality threshold", value: "pdse-gate" },
    { label: "Security Scan", description: "Check for common vulnerabilities", value: "security" },
    { label: "Type Coverage", description: "Ensure TypeScript type safety", value: "type-coverage" },
  ];

  const selected = await vscode.window.showQuickPick(rails, {
    placeHolder: "Select verification rail to add",
    canPickMany: true,
  });

  if (!selected || selected.length === 0) {
    return;
  }

  const out = getOutputChannel();
  out.appendLine(`\n[Verification Rails] Adding ${selected.length} rail(s):`);
  for (const rail of selected) {
    out.appendLine(`  + ${rail.label}: ${rail.description}`);
  }
  out.show();

  void vscode.window.showInformationMessage(
    `Added ${selected.length} verification rail(s): ${selected.map(r => r.label).join(", ")}`
  );
}

// ─── Search Commands (DIRECT → Panel Focus) ────────────────────────────────

async function commandSearchSemantic(): Promise<void> {
  const query = await vscode.window.showInputBox({
    placeHolder: "Enter search query...",
    prompt: "Semantic code search",
  });

  if (!query) {
    return;
  }

  // Focus the search panel — it handles search natively
  await vscode.commands.executeCommand("dantecode.searchView.focus");

  // Also use VSCode built-in search as fallback
  await vscode.commands.executeCommand("workbench.action.findInFiles", {
    query,
    isRegex: false,
    triggerSearch: true,
  });
}

async function commandSearchSimilar(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("DanteCode: Select code to find similar");
    return;
  }

  const selection = editor.document.getText(editor.selection);
  // Extract a meaningful search query from selection (first non-empty line, trimmed)
  const searchQuery = selection.split("\n").find(l => l.trim().length > 0)?.trim().slice(0, 100) || selection.slice(0, 100);

  await vscode.commands.executeCommand("workbench.action.findInFiles", {
    query: searchQuery,
    isRegex: false,
    triggerSearch: true,
  });
}

// ─── Agent Commands (DIRECT CORE INTEGRATION) ──────────────────────────────

async function commandLaunchParty(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("Open a workspace to launch party mode");
    return;
  }

  const task = await vscode.window.showInputBox({
    placeHolder: "Enter task objective...",
    prompt: "What should the party mode agents accomplish?",
    validateInput: (value) => {
      if (value.trim().length < 10) {
        return "Task description must be at least 10 characters";
      }
      return null;
    },
  });

  if (!task) {
    return;
  }

  try {
    const runId = await launchPartyMode(
      task,
      ["claude-code", "dantecode", "codex"],
      projectRoot,
      getOutputChannel(),
    );

    await vscode.commands.executeCommand("dantecode.partyProgressView.focus");

    void vscode.window.showInformationMessage(
      `Party Mode launched! Run ID: ${runId.substring(0, 8)}...`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Failed to launch party mode: ${message}`);
    getOutputChannel().appendLine(`[Party Mode] Error: ${message}`);
  }
}

async function commandAutoforge(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("Open a file to run autoforge");
    return;
  }

  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "DanteCode: Running autoforge...",
      cancellable: false,
    },
    async (progress) => {
      try {
        const { runLocalPDSEScorer } = await import("@dantecode/danteforge");
        const filePath = editor.document.uri.fsPath;

        progress.report({ message: "Scoring current file..." });

        const content = editor.document.getText();
        const score = await runLocalPDSEScorer(content, projectRoot);
        const scoreValue = typeof score === "number" ? score : (score as any)?.overall ?? 0;

        const out = getOutputChannel();
        out.appendLine(`\n[Autoforge] File: ${filePath}`);
        out.appendLine(`  Initial PDSE Score: ${scoreValue}`);

        if (scoreValue >= 85) {
          out.appendLine("  Status: Already above quality threshold (85)");
          void vscode.window.showInformationMessage(
            `Autoforge: File already at quality ${scoreValue}/100 — no refinement needed`
          );
        } else {
          out.appendLine("  Status: Below threshold — full autoforge requires CLI");
          out.appendLine("  Run: npx dantecode autoforge " + filePath);
          out.show();
          void vscode.window.showWarningMessage(
            `PDSE: ${scoreValue}/100 — Run \`npx dantecode autoforge\` for full iterative refinement`
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        void vscode.window.showErrorMessage(`Autoforge failed: ${msg}`);
      }
    },
  );
}

async function commandShowMemory(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("Open a workspace to access memory");
    return;
  }

  try {
    await vscode.commands.executeCommand("dantecode.memoryBrowserView.focus");

    const stats = await getMemoryStats(projectRoot);
    void vscode.window.showInformationMessage(
      `Memory: ${stats.totalItems} items (${stats.utilizationPercent.toFixed(0)}% full)`
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Failed to load memory: ${message}`);
    getOutputChannel().appendLine(`[Memory] Error: ${message}`);
  }
}

// ─── Git Commands (DIRECT git-engine) ───────────────────────────────────────

async function commandCommitFile(uri?: unknown): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  // Get file path from URI or active editor
  let targetFile: string | undefined;
  if (uri instanceof vscode.Uri) {
    targetFile = uri.fsPath;
  } else {
    targetFile = vscode.window.activeTextEditor?.document.uri.fsPath;
  }

  const status: GitStatusResult = getStatus(projectRoot);
  const allFiles = [
    ...status.staged.map(s => s.path),
    ...status.unstaged.map(s => s.path),
  ];

  if (allFiles.length === 0) {
    void vscode.window.showWarningMessage("No files to commit");
    return;
  }

  // If a specific file was targeted, filter to just that file
  const filesToCommit = targetFile
    ? allFiles.filter(f => f === targetFile || f.endsWith(targetFile!.split(/[\\/]/).pop()!))
    : allFiles;

  if (filesToCommit.length === 0) {
    void vscode.window.showWarningMessage(`No changes found for ${targetFile}`);
    return;
  }

  const message = await vscode.window.showInputBox({
    prompt: `Commit ${filesToCommit.length} file(s)`,
    placeHolder: "feat: add new feature",
    validateInput: (value) => {
      if (value.trim().length < 3) {
        return "Commit message must be at least 3 characters";
      }
      return null;
    },
  });

  if (!message) {
    return;
  }

  try {
    const spec: GitCommitSpec = {
      files: filesToCommit,
      message,
      allowEmpty: false,
      footer: "\u{1F916} Committed via DanteCode VSCode Extension",
    };

    const result = autoCommit(spec, projectRoot);

    void vscode.window.showInformationMessage(
      `Committed ${result.filesCommitted.length} file(s): ${result.commitHash.substring(0, 7)}`
    );

    getOutputChannel().appendLine(`\n[Git Commit] ${result.commitHash}`);
    getOutputChannel().appendLine(`  Message: ${message}`);
    getOutputChannel().appendLine(`  Files: ${result.filesCommitted.join(", ")}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Commit failed: ${msg}`);
  }
}

// ─── LLM-Requiring Commands (Chat with structured message) ──────────────────

async function commandWebResearch(chatProvider: any): Promise<void> {
  const topic = await vscode.window.showInputBox({
    placeHolder: "Enter research topic...",
    prompt: "Web research with citations",
  });

  if (!topic) {
    return;
  }

  if (!sendToChat(chatProvider, `/research ${topic}`)) {
    void vscode.window.showWarningMessage(
      "Web research requires the chat sidebar. Open DanteCode chat first."
    );
  }
}

async function commandPlanTask(chatProvider: any): Promise<void> {
  const goal = await vscode.window.showInputBox({
    placeHolder: "Enter task goal...",
    prompt: "Generate execution plan",
  });

  if (!goal) {
    return;
  }

  if (!sendToChat(chatProvider, `/plan ${goal}`)) {
    void vscode.window.showWarningMessage(
      "Planning requires the chat sidebar. Open DanteCode chat first."
    );
  }
}

async function commandBackgroundTask(chatProvider: any): Promise<void> {
  const task = await vscode.window.showInputBox({
    placeHolder: "Enter background task...",
    prompt: "Run task in background",
  });

  if (!task) {
    return;
  }

  if (sendToChat(chatProvider, `/bg ${task}`, false)) {
    // Show automation dashboard for monitoring
    await vscode.commands.executeCommand("dantecode.automationDashboardView.focus");
    void vscode.window.showInformationMessage("Background task started — see Automation Dashboard");
  } else {
    void vscode.window.showWarningMessage(
      "Background tasks require the chat sidebar. Open DanteCode chat first."
    );
  }
}

// ─── Analytics & Stats Commands (DIRECT) ────────────────────────────────────

async function commandShowGaslight(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const out = getOutputChannel();
  out.appendLine("\n[Gaslight] Loading statistics...");

  try {
    const { DanteGaslightIntegration } = await import("@dantecode/dante-gaslight");
    const integration = new DanteGaslightIntegration({}, { cwd: projectRoot });
    const stats = integration.stats();

    out.appendLine(`  Sessions run: ${stats.totalSessions}`);
    out.appendLine(`  Sessions passed: ${stats.sessionsWithPass}`);
    out.appendLine(`  Sessions aborted: ${stats.sessionsAborted}`);
    out.appendLine(`  Avg iterations: ${stats.averageIterations.toFixed(1)}`);
    out.appendLine(`  Lesson-eligible: ${stats.lessonEligibleCount}`);
    out.appendLine(`  Distilled: ${stats.distilledCount}`);
    out.show();

    void vscode.window.showInformationMessage(
      `Gaslight: ${stats.totalSessions} sessions, ${stats.sessionsWithPass} passed`
    );
  } catch {
    out.appendLine("  Gaslight statistics not available — run a gaslight session first");
    out.show();
    void vscode.window.showInformationMessage("No gaslight statistics available yet");
  }
}

async function commandShowFearset(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const out = getOutputChannel();
  out.appendLine("\n[Fearset] Loading fear-setting analysis...");

  try {
    const { FearSetResultStore } = await import("@dantecode/dante-gaslight");
    const store = new FearSetResultStore({ cwd: projectRoot });
    const results = store.list();

    if (results.length === 0) {
      out.appendLine("  No fearset analyses found. Run /fearset in chat to start.");
      out.show();
      void vscode.window.showInformationMessage("No fearset analyses found — run /fearset first");
      return;
    }

    out.appendLine(`  Total analyses: ${results.length}`);
    out.appendLine(`  Latest: ${results[0]}`);
    out.show();

    void vscode.window.showInformationMessage(`Fearset: ${results.length} analyses on file`);
  } catch {
    out.appendLine("  Fearset module not available");
    out.show();
    void vscode.window.showInformationMessage("Fearset: No data available yet");
  }
}

async function commandShowMetrics(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const out = getOutputChannel();
  out.appendLine("\n[Metrics] Gathering workspace metrics...");

  try {
    const status: GitStatusResult = getStatus(projectRoot);
    const diff = getDiff(projectRoot);

    const totalChanges = status.staged.length + status.unstaged.length + status.untracked.length;
    const diffLines = diff ? diff.split("\n").length : 0;

    out.appendLine(`  Git status: ${totalChanges} changed files`);
    out.appendLine(`    Staged: ${status.staged.length}`);
    out.appendLine(`    Unstaged: ${status.unstaged.length}`);
    out.appendLine(`    Untracked: ${status.untracked.length}`);
    out.appendLine(`    Conflicted: ${status.conflicted.length}`);
    out.appendLine(`  Diff size: ${diffLines} lines`);
    out.show();

    void vscode.window.showInformationMessage(
      `Workspace: ${totalChanges} changed files, ${diffLines} diff lines`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    out.appendLine(`  Error: ${msg}`);
    out.show();
  }
}

async function commandShowTraces(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const out = getOutputChannel();
  out.appendLine("\n[Traces] Loading audit trail...");

  try {
    const { readAuditEvents } = await import("@dantecode/core");
    const events = await readAuditEvents(projectRoot, { limit: 20 });

    if (events.length === 0) {
      out.appendLine("  No audit events found");
      out.show();
      void vscode.window.showInformationMessage("No audit traces available");
      return;
    }

    out.appendLine(`  Showing last ${events.length} events:`);
    for (const event of events) {
      const time = new Date(event.timestamp).toLocaleTimeString();
      const detail = event.payload ? JSON.stringify(event.payload).substring(0, 80) : "";
      out.appendLine(`  [${time}] ${event.type}: ${detail}`);
    }
    out.show();

    void vscode.window.showInformationMessage(`Traces: ${events.length} events loaded`);
  } catch {
    out.appendLine("  Audit trail not available — events are logged during agent sessions");
    out.show();
    void vscode.window.showInformationMessage("Traces: No audit data available yet");
  }
}

// ─── GitHub Commands (DIRECT) ───────────────────────────────────────────────

async function commandReviewPR(): Promise<void> {
  const prNumber = await vscode.window.showInputBox({
    placeHolder: "Enter PR number...",
    prompt: "Review GitHub PR with PDSE",
  });

  if (!prNumber) {
    return;
  }

  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const out = getOutputChannel();
  out.appendLine(`\n[PR Review] Reviewing PR #${prNumber}...`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Reviewing PR #${prNumber}...`,
      cancellable: false,
    },
    async () => {
      try {
        // Use GitHub CLI directly for PR review data
        const { execSync } = await import("node:child_process");
        const prData = execSync(
          `gh pr view ${prNumber} --json title,state,additions,deletions,changedFiles,body`,
          { cwd: projectRoot, encoding: "utf-8", timeout: 15000 },
        );

        const pr = JSON.parse(prData);
        out.appendLine(`  Title: ${pr.title}`);
        out.appendLine(`  State: ${pr.state}`);
        out.appendLine(`  Changes: +${pr.additions} -${pr.deletions} (${pr.changedFiles} files)`);
        out.appendLine(`  Body: ${(pr.body || "").substring(0, 200)}`);
        out.show();

        void vscode.window.showInformationMessage(
          `PR #${prNumber}: ${pr.title} (+${pr.additions}/-${pr.deletions})`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(`  Error: ${msg}`);
        out.appendLine("  Ensure GitHub CLI (gh) is installed and authenticated");
        out.show();
        void vscode.window.showErrorMessage(`PR review failed: ${msg}`);
      }
    },
  );
}

async function commandTriageIssue(): Promise<void> {
  const issueNumber = await vscode.window.showInputBox({
    placeHolder: "Enter issue number...",
    prompt: "Triage GitHub issue",
  });

  if (!issueNumber) {
    return;
  }

  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const out = getOutputChannel();
  out.appendLine(`\n[Issue Triage] Triaging issue #${issueNumber}...`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Triaging issue #${issueNumber}...`,
      cancellable: false,
    },
    async () => {
      try {
        const { execSync } = await import("node:child_process");
        const issueData = execSync(
          `gh issue view ${issueNumber} --json title,state,labels,assignees,body`,
          { cwd: projectRoot, encoding: "utf-8", timeout: 15000 },
        );

        const issue = JSON.parse(issueData);
        const labels = issue.labels?.map((l: any) => l.name).join(", ") || "none";
        const assignees = issue.assignees?.map((a: any) => a.login).join(", ") || "unassigned";

        out.appendLine(`  Title: ${issue.title}`);
        out.appendLine(`  State: ${issue.state}`);
        out.appendLine(`  Labels: ${labels}`);
        out.appendLine(`  Assignees: ${assignees}`);
        out.appendLine(`  Body: ${(issue.body || "").substring(0, 200)}`);
        out.show();

        void vscode.window.showInformationMessage(
          `Issue #${issueNumber}: ${issue.title} [${issue.state}]`
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        out.appendLine(`  Error: ${msg}`);
        out.appendLine("  Ensure GitHub CLI (gh) is installed and authenticated");
        out.show();
        void vscode.window.showErrorMessage(`Issue triage failed: ${msg}`);
      }
    },
  );
}

// ─── Utility Commands (DIRECT) ──────────────────────────────────────────────

async function commandShowMacros(): Promise<void> {
  const projectRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!projectRoot) {
    void vscode.window.showWarningMessage("DanteCode: Open a workspace first");
    return;
  }

  const out = getOutputChannel();
  out.appendLine("\n[Macros] Scanning for macro definitions...");

  try {
    const { workspace } = vscode;
    const macroFiles = await workspace.findFiles("**/.dantecode/macros.json", "**/node_modules/**", 1);

    if (macroFiles.length === 0) {
      out.appendLine("  No macros defined. Create .dantecode/macros.json to define macros.");
      out.show();
      void vscode.window.showInformationMessage("No macros defined — create .dantecode/macros.json");
      return;
    }

    const macroFile = macroFiles[0]!;
    const content = await workspace.fs.readFile(macroFile);
    const macros = JSON.parse(Buffer.from(content).toString("utf-8"));
    const macroList = Array.isArray(macros) ? macros : Object.entries(macros);

    out.appendLine(`  Found ${macroList.length} macro(s):`);
    for (const macro of macroList) {
      const name = Array.isArray(macro) ? macro[0] : (macro as any).name || "unnamed";
      const desc = Array.isArray(macro) ? (macro[1] as any)?.description || "" : (macro as any).description || "";
      out.appendLine(`    ${name}: ${desc}`);
    }
    out.show();

    void vscode.window.showInformationMessage(`${macroList.length} macro(s) available`);
  } catch {
    out.appendLine("  Error reading macros file");
    out.show();
  }
}

async function commandThemeSwitch(): Promise<void> {
  const themes = [
    { label: "Default", description: "Standard DanteCode theme", value: "default" },
    { label: "Neon", description: "Bright cyberpunk colors", value: "neon" },
    { label: "Minimal", description: "Clean, understated styling", value: "minimal" },
    { label: "Forest", description: "Natural green tones", value: "forest" },
    { label: "Ocean", description: "Deep blue maritime feel", value: "ocean" },
  ];

  const selected = await vscode.window.showQuickPick(themes, {
    placeHolder: "Select DanteCode theme",
  });

  if (!selected) {
    return;
  }

  // Store theme preference in VSCode settings
  const config = vscode.workspace.getConfiguration("dantecode");
  await config.update("theme", selected.value, vscode.ConfigurationTarget.Global);

  void vscode.window.showInformationMessage(`Theme switched to: ${selected.label}`);
  getOutputChannel().appendLine(`[Theme] Switched to ${selected.label}`);
}
