// ============================================================================
// packages/vscode/src/streaming-diff-provider.ts
//
// Real-time SEARCH/REPLACE block detection as model output streams.
// Decorates open editors with pending-removal highlights and registers
// CodeLens "Accept / Reject" buttons above each detected block.
//
// Usage:
//   1. Call feedChunk() for each streaming chunk from the model.
//   2. Call finalizeStream() when the response is complete → returns session.
//   3. User accepts/rejects blocks via CodeLens commands.
//   4. Call clearSession() to reset after the session is settled.
// ============================================================================

import * as vscode from "vscode";
import {
  parseSearchReplaceBlocks,
  MultiFileDiffSession,
  type SearchReplaceBlock,
} from "@dantecode/core";

// ── StreamParser ─────────────────────────────────────────────────────────────

/**
 * Accumulates streaming chunks and re-runs parseSearchReplaceBlocks on the
 * growing buffer. Uses a length cursor so each completed block is emitted
 * exactly once (no duplicates across chunks).
 */
class StreamParser {
  private _buf = "";
  private _knownCount = 0;

  feed(chunk: string): SearchReplaceBlock[] {
    this._buf += chunk;
    const { blocks } = parseSearchReplaceBlocks(this._buf);
    const newBlocks = blocks.slice(this._knownCount);
    this._knownCount = blocks.length;
    return newBlocks;
  }

  /** Return all completed blocks accumulated so far. */
  flush(): SearchReplaceBlock[] {
    const { blocks } = parseSearchReplaceBlocks(this._buf);
    return blocks;
  }

  reset(): void {
    this._buf = "";
    this._knownCount = 0;
  }
}

// ── StreamingDiffProvider ────────────────────────────────────────────────────

/**
 * VSCode extension component that bridges streaming model output to the
 * editor's decoration and CodeLens APIs.
 *
 * Implements vscode.CodeLensProvider so it can supply Accept/Reject lenses.
 */
export class StreamingDiffProvider implements vscode.CodeLensProvider {
  private readonly _parser = new StreamParser();
  private readonly _decorationTypes = new Map<string, vscode.TextEditorDecorationType>();
  private _session: MultiFileDiffSession | null = null;
  private _codeLenses: vscode.CodeLens[] = [];

  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  // Injected for testing; defaults use real vscode APIs
  private readonly _createDecorationType: (
    opts: vscode.DecorationRenderOptions,
  ) => vscode.TextEditorDecorationType;
  private readonly _getVisibleEditors: () => readonly vscode.TextEditor[];

  constructor(
    _context: vscode.ExtensionContext,
    opts?: {
      createDecorationType?: (
        opts: vscode.DecorationRenderOptions,
      ) => vscode.TextEditorDecorationType;
      getVisibleEditors?: () => readonly vscode.TextEditor[];
    },
  ) {
    this._createDecorationType =
      opts?.createDecorationType ??
      ((o) => vscode.window.createTextEditorDecorationType(o));
    this._getVisibleEditors =
      opts?.getVisibleEditors ?? (() => vscode.window.visibleTextEditors);
  }

  // ── CodeLensProvider ───────────────────────────────────────────────────────

  provideCodeLenses(): vscode.CodeLens[] {
    return this._codeLenses;
  }

  // ── Streaming API ──────────────────────────────────────────────────────────

  /**
   * Feed one streaming chunk from the model.
   * Returns any SEARCH/REPLACE blocks newly completed by this chunk.
   * Each new block triggers editor decorations and a CodeLens pair.
   */
  feedChunk(chunk: string): SearchReplaceBlock[] {
    const newBlocks = this._parser.feed(chunk);
    for (const block of newBlocks) {
      this._registerBlock(block);
    }
    if (newBlocks.length > 0) {
      this._onDidChangeCodeLenses.fire();
    }
    return newBlocks;
  }

  /**
   * Call when the model response is fully received.
   * Creates a MultiFileDiffSession from all parsed blocks and resets the parser.
   * Returns null if no SEARCH/REPLACE blocks were found.
   */
  finalizeStream(): MultiFileDiffSession | null {
    const blocks = this._parser.flush();
    this._parser.reset();
    if (blocks.length === 0) return null;
    this._session = new MultiFileDiffSession(blocks);
    return this._session;
  }

  get activeSession(): MultiFileDiffSession | null {
    return this._session;
  }

  /**
   * Clear all decorations, CodeLenses, and the active session.
   * Call after the session is fully settled (all blocks accepted/rejected).
   */
  clearSession(): void {
    this._clearDecorations();
    this._session = null;
    this._codeLenses = [];
    this._onDidChangeCodeLenses.fire();
  }

  dispose(): void {
    this._clearDecorations();
    this._onDidChangeCodeLenses.dispose();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Locate the editor that has `block.filePath` open, apply a removed-line
   * decoration to matching lines, and register Accept/Reject CodeLenses.
   */
  private _registerBlock(block: SearchReplaceBlock): void {
    const blockIndex = this._codeLenses.length / 2; // 2 lenses per block

    // Find matching editor
    const editor = this._findEditorForFile(block.filePath);

    if (editor) {
      const range = this._findSearchRange(editor.document, block.searchContent);
      if (range) {
        // Create and store a decoration type for this block
        const decorationKey = `block-${blockIndex}`;
        const decorationType = this._createDecorationType({
          backgroundColor: new vscode.ThemeColor("diffEditor.removedLineBackground"),
          isWholeLine: true,
        });
        this._decorationTypes.set(decorationKey, decorationType);
        editor.setDecorations(decorationType, [range]);

        // Add two CodeLenses at the start of the matched range
        const lensRange = new vscode.Range(range.start, range.start);
        this._codeLenses.push(
          new vscode.CodeLens(lensRange, {
            title: "$(check) Accept",
            command: "dantecode.acceptDiffBlock",
            arguments: [block.filePath, blockIndex],
          }),
          new vscode.CodeLens(lensRange, {
            title: "$(x) Reject",
            command: "dantecode.rejectDiffBlock",
            arguments: [block.filePath, blockIndex],
          }),
        );
        return;
      }
    }

    // No open editor for this file — still add CodeLenses at line 0
    const fallbackRange = new vscode.Range(
      new vscode.Position(0, 0),
      new vscode.Position(0, 0),
    );
    this._codeLenses.push(
      new vscode.CodeLens(fallbackRange, {
        title: "$(check) Accept",
        command: "dantecode.acceptDiffBlock",
        arguments: [block.filePath, blockIndex],
      }),
      new vscode.CodeLens(fallbackRange, {
        title: "$(x) Reject",
        command: "dantecode.rejectDiffBlock",
        arguments: [block.filePath, blockIndex],
      }),
    );
  }

  private _findEditorForFile(filePath: string): vscode.TextEditor | undefined {
    const normalizedTarget = filePath.replace(/\\/g, "/").toLowerCase();
    return this._getVisibleEditors().find((e) => {
      const editorPath = e.document.uri.fsPath.replace(/\\/g, "/").toLowerCase();
      return editorPath.endsWith(normalizedTarget) || editorPath === normalizedTarget;
    });
  }

  private _findSearchRange(
    document: vscode.TextDocument,
    searchContent: string,
  ): vscode.Range | undefined {
    const text = document.getText();
    const idx = text.indexOf(searchContent);
    if (idx === -1) return undefined;
    return new vscode.Range(document.positionAt(idx), document.positionAt(idx + searchContent.length));
  }

  private _clearDecorations(): void {
    for (const dt of this._decorationTypes.values()) {
      dt.dispose();
    }
    this._decorationTypes.clear();
  }
}

// ── Batch apply ───────────────────────────────────────────────────────────────

/**
 * Applies a list of SearchReplaceBlock objects to their respective files.
 * Groups blocks by filePath, reads each file once, applies all blocks in order,
 * and writes the result back. Returns applied file paths and any failures.
 */
export async function batchApplySearchReplace(
  blocks: SearchReplaceBlock[],
  _projectRoot: string,
): Promise<{ applied: string[]; failed: Array<{ path: string; error?: unknown }> }> {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { applySearchReplaceBlock } = await import("@dantecode/core");

  const byFile = new Map<string, SearchReplaceBlock[]>();
  for (const block of blocks) {
    const list = byFile.get(block.filePath) ?? [];
    list.push(block);
    byFile.set(block.filePath, list);
  }

  const applied: string[] = [];
  const failed: Array<{ path: string; error?: unknown }> = [];

  await Promise.all(
    [...byFile.entries()].map(async ([filePath, fileBlocks]) => {
      try {
        let content = await readFile(filePath, "utf-8") as string;
        for (const block of fileBlocks) {
          const result = applySearchReplaceBlock(content, block);
          if (result.matched) content = result.updatedContent ?? content;
        }
        await writeFile(filePath, content, "utf-8");
        applied.push(filePath);
      } catch (error) {
        failed.push({ path: filePath, error });
      }
    }),
  );

  return { applied, failed };
}
