// ============================================================================
// packages/vscode/src/inline-edit-provider.ts
//
// Inline Edit Mode (Cmd+I / Ctrl+I) for DanteCode.
// Select code → press Cmd+I → QuickInput prompt → AI streams replacement
// → inline diff decorations (green additions, red removals) → accept/reject.
// ============================================================================

import * as vscode from "vscode";
import type { CheckpointManager } from "./checkpoint-manager.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface InlineEdit {
  filePath: string;
  originalText: string;
  proposedText: string;
  range: vscode.Range;
  instruction: string;
}

// ── Decoration types ──────────────────────────────────────────────────────

function createAddedDecoration(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(0, 255, 0, 0.15)",
    isWholeLine: true,
  });
}

function createRemovedDecoration(): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: "rgba(255, 0, 0, 0.15)",
    textDecoration: "line-through",
    isWholeLine: true,
  });
}

// ── Diff computation ──────────────────────────────────────────────────────

/** Simple line-by-line diff: returns which lines are added/removed. */
function computeLineDiff(
  original: string,
  proposed: string,
): {
  addedLines: number[];
  removedLines: number[];
} {
  const origLines = original.split("\n");
  const propLines = proposed.split("\n");
  const origSet = new Set(origLines);
  const propSet = new Set(propLines);

  const addedLines: number[] = [];
  for (let i = 0; i < propLines.length; i++) {
    if (!origSet.has(propLines[i]!)) addedLines.push(i);
  }
  const removedLines: number[] = [];
  for (let i = 0; i < origLines.length; i++) {
    if (!propSet.has(origLines[i]!)) removedLines.push(i);
  }
  return { addedLines, removedLines };
}

// ── Provider ─────────────────────────────────────────────────────────────────

/**
 * InlineEditProvider — handles Cmd+I / Ctrl+I inline edit mode.
 *
 * Usage (in extension.ts after activate):
 *   const provider = new InlineEditProvider(context, checkpointManager, callModel);
 *   context.subscriptions.push(...provider.activate());
 */
interface CoreEdit {
  hunks: Array<{ id: string }>;
  hunkStatus: Map<string, "accepted" | "rejected" | "pending">;
}

export class InlineEditProvider {
  /** Decoration types allocated for the current pending diff */
  private addedDeco: vscode.TextEditorDecorationType | undefined;
  private removedDeco: vscode.TextEditorDecorationType | undefined;
  /** Resolve function for the accept/reject promise */
  private pendingResolve: ((verdict: "accept" | "reject") => void) | undefined;
  /** Status bar item shown while a diff review is pending */
  private _reviewStatusBar: vscode.StatusBarItem | undefined;
  /** Current hunk-level core edit (set during showInlineDiff) */
  _currentCoreEdit: CoreEdit | undefined;

  constructor(
    _context: vscode.ExtensionContext,
    private readonly checkpointManager: CheckpointManager | undefined,
    /**
     * Injected model caller — decoupled from the router so tests can mock it.
     * Returns the model's proposed replacement text.
     */
    private readonly callModel: (
      systemPrompt: string,
      userPrompt: string,
    ) => Promise<string>,
  ) {}

  /** Registers the inlineEdit command and cleanup listeners. Returns disposables. */
  activate(): vscode.Disposable[] {
    return [
      vscode.commands.registerCommand("dantecode.inlineEdit", () => {
        const editor = vscode.window.activeTextEditor;
        if (editor) void this.triggerInlineEdit(editor);
      }),
      vscode.commands.registerCommand("dantecode.acceptInlineEdit", () => {
        this.pendingResolve?.("accept");
      }),
      vscode.commands.registerCommand("dantecode.rejectInlineEdit", () => {
        this.pendingResolve?.("reject");
      }),
      vscode.commands.registerCommand("dantecode.partialAcceptInlineEdit", () => {
        this.partialAcceptFirstHunk();
      }),
      // Clean up decorations when the user switches files
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.clearDecorations();
      }),
    ];
  }

  /**
   * Accepts the first pending hunk and rejects all others.
   * No-op when there is no pending edit.
   */
  partialAcceptFirstHunk(): void {
    if (!this._currentCoreEdit) return;
    const { hunks, hunkStatus } = this._currentCoreEdit;
    let first = true;
    for (const hunk of hunks) {
      hunkStatus.set(hunk.id, first ? "accepted" : "rejected");
      first = false;
    }
    this.pendingResolve?.("accept");
  }

  /**
   * Main entry point: prompts the user for an instruction, calls the model,
   * shows a diff, waits for accept/reject.
   */
  async triggerInlineEdit(
    editor: vscode.TextEditor,
    prefillInstruction?: string,
  ): Promise<void> {
    const selection = editor.selection;
    const originalText = editor.document.getText(selection.isEmpty ? undefined : selection);
    const range = selection.isEmpty
      ? new vscode.Range(0, 0, editor.document.lineCount - 1, 0)
      : selection;

    const instruction = await vscode.window.showInputBox({
      prompt: "What should DanteCode do with this code?",
      placeHolder: "e.g. Add error handling, Optimize for performance, Convert to async/await",
      value: prefillInstruction ?? "",
    });
    if (!instruction) return;

    // Gather ±20 lines of surrounding context
    const startLine = Math.max(0, range.start.line - 20);
    const endLine = Math.min(editor.document.lineCount - 1, range.end.line + 20);
    const contextRange = new vscode.Range(startLine, 0, endLine, 0);
    const surroundingContext = editor.document.getText(contextRange);

    const system =
      "Apply the instruction to the code below. Return ONLY the replacement code, no explanation, no markdown fences.";
    const user = `Instruction: ${instruction}\n\nCode:\n${originalText}\n\nSurrounding context:\n${surroundingContext}`;

    let proposedText: string;
    try {
      proposedText = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "DanteCode: Generating edit…",
          cancellable: false,
        },
        () => this.callModel(system, user),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      void vscode.window.showErrorMessage(`DanteCode: Inline edit failed — ${msg}`);
      return;
    }

    const edit: InlineEdit = {
      filePath: editor.document.uri.fsPath,
      originalText,
      proposedText,
      range,
      instruction,
    };

    const verdict = await this.showInlineDiff(editor, originalText, proposedText, range);
    if (verdict === "accept") {
      await this.applyInlineEdit(edit, editor);
    } else {
      this.clearDecorations();
    }
  }

  /**
   * Shows a visual diff with green/red decorations and waits for the user
   * to accept or reject via the CodeLens action buttons.
   */
  async showInlineDiff(
    editor: vscode.TextEditor,
    original: string,
    proposed: string,
    range: vscode.Range,
  ): Promise<"accept" | "reject"> {
    this.clearDecorations();

    this.addedDeco = createAddedDecoration();
    this.removedDeco = createRemovedDecoration();

    const { addedLines, removedLines } = computeLineDiff(original, proposed);

    const addedRanges = addedLines.map(
      (l) => new vscode.Range(range.start.line + l, 0, range.start.line + l, 0),
    );
    const removedRanges = removedLines.map(
      (l) => new vscode.Range(range.start.line + l, 0, range.start.line + l, 0),
    );

    editor.setDecorations(this.addedDeco, addedRanges);
    editor.setDecorations(this.removedDeco, removedRanges);

    this._reviewStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
    this._reviewStatusBar.text = "$(check) Accept  $(x) Reject";
    this._reviewStatusBar.tooltip = "Accept or reject the inline edit";
    this._reviewStatusBar.show();

    return new Promise<"accept" | "reject">((resolve) => {
      this.pendingResolve = resolve;

      // Also offer Accept/Reject via information message as fallback
      void vscode.window
        .showInformationMessage(
          "DanteCode: Review the inline edit — accept or reject?",
          "✓ Accept",
          "✗ Reject",
        )
        ?.then((choice) => {
          if (choice === "✓ Accept") resolve("accept");
          else resolve("reject");
        });
    });
  }

  /**
   * Applies the accepted edit to the document and creates a checkpoint.
   */
  async applyInlineEdit(edit: InlineEdit, editor?: vscode.TextEditor): Promise<void> {
    this.clearDecorations();

    const targetEditor =
      editor ??
      vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === edit.filePath);

    if (!targetEditor) {
      void vscode.window.showErrorMessage("DanteCode: Cannot apply edit — editor not found");
      return;
    }

    // Create checkpoint before applying
    if (this.checkpointManager) {
      try {
        await this.checkpointManager.createCheckpoint({
          label: `inline-edit:${edit.instruction.slice(0, 40)}`,
          fileSnapshots: [{ filePath: edit.filePath, content: edit.originalText }],
        });
      } catch {
        // Checkpoint failure is non-fatal
      }
    }

    await targetEditor.edit((editBuilder) => {
      editBuilder.replace(edit.range, edit.proposedText);
    });

    void vscode.window.showInformationMessage("DanteCode: Inline edit applied ✓");
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private clearDecorations(): void {
    this.addedDeco?.dispose();
    this.removedDeco?.dispose();
    this.addedDeco = undefined;
    this.removedDeco = undefined;
    this.pendingResolve = undefined;
    this._reviewStatusBar?.hide();
    this._reviewStatusBar?.dispose();
    this._reviewStatusBar = undefined;
  }

  dispose(): void {
    this.clearDecorations();
  }
}
