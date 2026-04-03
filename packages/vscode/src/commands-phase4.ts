// ============================================================================
// Phase 4 Command Implementations — All remaining CLI commands
// ============================================================================

import * as vscode from "vscode";

/**
 * Register all Phase 4 commands
 */
export function registerPhase4Commands(
  chatSidebarProvider: any,
): Array<[string, (...args: unknown[]) => unknown]> {
  return [
    ["dantecode.showGitPanel", () => commandShowGitPanel()],
    ["dantecode.showSkillsLibrary", () => commandShowSkillsLibrary()],
    ["dantecode.showSessions", () => commandShowSessions()],
    ["dantecode.runVerification", () => commandRunVerification()],
    ["dantecode.searchSemantic", () => commandSearchSemantic(chatSidebarProvider)],
    ["dantecode.webResearch", () => commandWebResearch(chatSidebarProvider)],
    ["dantecode.launchParty", () => commandLaunchParty(chatSidebarProvider)],
    ["dantecode.backgroundTask", () => commandBackgroundTask(chatSidebarProvider)],
    ["dantecode.autoforge", () => commandAutoforge(chatSidebarProvider)],
    ["dantecode.planTask", () => commandPlanTask(chatSidebarProvider)],
    ["dantecode.showMemory", () => commandShowMemory(chatSidebarProvider)],
    ["dantecode.commitFile", (uri?: unknown) => commandCommitFile(chatSidebarProvider, uri)],
    ["dantecode.verifySelection", () => commandVerifySelection(chatSidebarProvider)],
    ["dantecode.addRail", () => commandAddRail(chatSidebarProvider)],
    ["dantecode.searchSimilar", () => commandSearchSimilar(chatSidebarProvider)],
    ["dantecode.showGaslight", () => commandShowGaslight(chatSidebarProvider)],
    ["dantecode.showFearset", () => commandShowFearset(chatSidebarProvider)],
    ["dantecode.showMetrics", () => commandShowMetrics(chatSidebarProvider)],
    ["dantecode.showTraces", () => commandShowTraces(chatSidebarProvider)],
    ["dantecode.reviewPR", () => commandReviewPR(chatSidebarProvider)],
    ["dantecode.triageIssue", () => commandTriageIssue(chatSidebarProvider)],
    ["dantecode.showMacros", () => commandShowMacros(chatSidebarProvider)],
    ["dantecode.themeSwitch", () => commandThemeSwitch(chatSidebarProvider)],
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

// ─── Verification Commands ───────────────────────────────────────────────────

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
        const results = await runGStack(projectRoot, []);

        // Aggregate results (handle both array and single result)
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

// ─── Search Commands ─────────────────────────────────────────────────────────

async function commandSearchSemantic(chatProvider: any): Promise<void> {
  const query = await vscode.window.showInputBox({
    placeHolder: "Enter search query...",
    prompt: "Semantic code search",
  });

  if (!query) {
    return;
  }

  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/search ${query}`);
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

async function commandWebResearch(chatProvider: any): Promise<void> {
  const topic = await vscode.window.showInputBox({
    placeHolder: "Enter research topic...",
    prompt: "Web research with citations",
  });

  if (!topic) {
    return;
  }

  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/research ${topic}`);
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

async function commandSearchSimilar(chatProvider: any): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("DanteCode: Select code to find similar");
    return;
  }

  const selection = editor.document.getText(editor.selection);
  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/search ${selection.slice(0, 100)}`);
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

// ─── Agent Commands ──────────────────────────────────────────────────────────

async function commandLaunchParty(chatProvider: any): Promise<void> {
  const task = await vscode.window.showInputBox({
    placeHolder: "Enter task description...",
    prompt: "Multi-agent party mode",
  });

  if (!task) {
    return;
  }

  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/party ${task}`);
    await vscode.commands.executeCommand("dantecode.chatView.focus");
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

  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/bg ${task}`);
    void vscode.window.showInformationMessage("DanteCode: Background task started");
  }
}

async function commandAutoforge(chatProvider: any): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showWarningMessage("DanteCode: Open a file to run autoforge");
    return;
  }

  if (chatProvider) {
    chatProvider.handleUserMessage?.("/autoforge");
    await vscode.commands.executeCommand("dantecode.chatView.focus");
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

  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/plan ${goal}`);
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

// ─── Memory Commands ─────────────────────────────────────────────────────────

async function commandShowMemory(chatProvider: any): Promise<void> {
  if (chatProvider) {
    chatProvider.handleUserMessage?.("/memory list");
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

// ─── Git Commands ────────────────────────────────────────────────────────────

async function commandCommitFile(chatProvider: any, uri?: unknown): Promise<void> {
  let filePath: string;

  if (uri instanceof vscode.Uri) {
    filePath = uri.fsPath;
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage("DanteCode: No active file to commit");
      return;
    }
    filePath = editor.document.uri.fsPath;
  }

  if (chatProvider) {
    chatProvider.handleUserMessage?.("/commit");
    void vscode.window.showInformationMessage(`DanteCode: Committing changes...`);
  }
}

// ─── Verification Commands (Selection) ───────────────────────────────────────

async function commandVerifySelection(chatProvider: any): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage("DanteCode: Select code to verify");
    return;
  }

  const selection = editor.document.getText(editor.selection);
  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/verify-output ${JSON.stringify({ code: selection })}`);
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

async function commandAddRail(chatProvider: any): Promise<void> {
  if (chatProvider) {
    chatProvider.handleUserMessage?.("/add-verification-rail");
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

// ─── Advanced Commands ───────────────────────────────────────────────────────

async function commandShowGaslight(chatProvider: any): Promise<void> {
  if (chatProvider) {
    chatProvider.handleUserMessage?.("/gaslight stats");
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

async function commandShowFearset(chatProvider: any): Promise<void> {
  if (chatProvider) {
    chatProvider.handleUserMessage?.("/fearset stats");
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

async function commandShowMetrics(chatProvider: any): Promise<void> {
  if (chatProvider) {
    chatProvider.handleUserMessage?.("/metrics");
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

async function commandShowTraces(chatProvider: any): Promise<void> {
  if (chatProvider) {
    chatProvider.handleUserMessage?.("/traces");
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

// ─── GitHub Commands ─────────────────────────────────────────────────────────

async function commandReviewPR(chatProvider: any): Promise<void> {
  const prNumber = await vscode.window.showInputBox({
    placeHolder: "Enter PR number...",
    prompt: "Review GitHub PR with PDSE",
  });

  if (!prNumber) {
    return;
  }

  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/review ${prNumber}`);
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

async function commandTriageIssue(chatProvider: any): Promise<void> {
  const issueNumber = await vscode.window.showInputBox({
    placeHolder: "Enter issue number...",
    prompt: "Triage GitHub issue",
  });

  if (!issueNumber) {
    return;
  }

  if (chatProvider) {
    chatProvider.handleUserMessage?.(`/triage ${issueNumber}`);
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

// ─── Utility Commands ────────────────────────────────────────────────────────

async function commandShowMacros(chatProvider: any): Promise<void> {
  if (chatProvider) {
    chatProvider.handleUserMessage?.("/macro list");
    await vscode.commands.executeCommand("dantecode.chatView.focus");
  }
}

async function commandThemeSwitch(chatProvider: any): Promise<void> {
  const themes = ["default", "neon", "minimal", "forest", "ocean"];
  const selected = await vscode.window.showQuickPick(themes, {
    placeHolder: "Select terminal theme",
  });

  if (selected && chatProvider) {
    chatProvider.handleUserMessage?.(`/theme ${selected}`);
  }
}
