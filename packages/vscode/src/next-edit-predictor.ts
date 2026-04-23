// ============================================================================
// packages/vscode/src/next-edit-predictor.ts
// Next-Edit Prediction Phase 2: heuristic prediction + idle pre-fetch.
// Harvest: arXiv 2025 (Cursor Tab), Tabby "warm context", Continue.dev cursor cache.
// ============================================================================

import * as vscode from "vscode";
import type { EditHistoryTracker } from "./edit-history-tracker.js";

export interface NextEditPrediction {
  filePath: string;
  line: number;
  character: number;
  confidence: number; // 0.0–1.0
  strategy:
    | "adjacent-line"
    | "column-repeat"
    | "file-oscillation"
    | "import-declaration"
    | "ml-model"
    | "none";
}

interface ModelRouter {
  nextEditModelId: string;
  ollamaUrl: string;
  specDecodeAvailable?: boolean;
  draftModelId?: string | null;
}

const NONE_PREDICTION: NextEditPrediction = {
  filePath: "",
  line: 0,
  character: 0,
  confidence: 0,
  strategy: "none",
};

/**
 * Predicts where the user will edit next based on edit history patterns.
 * Harvested from arXiv 2025 next-edit paper (Cursor Tab approach) + Tabby warm context.
 *
 * Strategy priority (highest confidence wins):
 *   1. adjacent-line (0.85) — block fill pattern
 *   2. column-repeat (0.75) — vertical alignment pattern
 *   3. file-oscillation (0.70) — test↔impl pair editing
 *   4. import-declaration (0.65) — new import → predict usage site
 */
export class NextEditPredictor implements vscode.Disposable {
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _idleCallback: ((pred: NextEditPrediction) => void) | null = null;
  private _idleMs = 500;
  private _disposed = false;
  private _lastPrediction: NextEditPrediction | null = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _fetchFn: typeof globalThis.fetch;

  constructor(
    private readonly _history: EditHistoryTracker,
    fetchFn?: typeof globalThis.fetch,
  ) {
    this._fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Call Ollama to predict the next edit location using ML.
   * Uses last 5 edits from history. Returns null on any failure.
   */
  async predictWithModel(
    edits: Array<{ filePath: string; range: { startLine: number }; oldText?: string; newText?: string; timestamp?: number; changeType?: string }>,
    currentContext: string,
    ollamaUrl: string,
    modelId: string,
  ): Promise<NextEditPrediction | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 200);
    try {
      const last5 = edits.slice(-5);
      const historyStr = last5.map((e) => `${e.filePath}:${e.range.startLine}`).join(", ");
      const prompt = `EDIT_HISTORY: ${historyStr}\nCONTEXT: ${currentContext}\nPredict the next edit location as JSON: {"filePath":"...","startLine":N,"endLine":N,"confidence":0.0}`;

      const resp = await this._fetchFn(`${ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelId, prompt, stream: false }),
        signal: controller.signal,
      });

      if (!resp.ok) return null;
      const data = (await resp.json()) as { response: string };
      let raw = data.response.trim();
      // Handle ```json...``` wrapper
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      }
      const parsed = JSON.parse(raw) as { filePath?: string; startLine?: number; endLine?: number; confidence?: number };
      if (typeof parsed.startLine !== "number") return null;

      return {
        filePath: parsed.filePath ?? "",
        line: parsed.startLine,
        character: 0,
        confidence: Math.min(1.0, Math.max(0.0, parsed.confidence ?? 0)),
        strategy: "ml-model",
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Returns the best prediction — heuristic immediately, upgraded to ML after 150ms debounce.
   * When modelRouter is omitted, returns heuristic only.
   */
  async predictBest(
    currentFilePath: string,
    currentLine: number,
    currentChar: number,
    modelRouter?: ModelRouter,
  ): Promise<NextEditPrediction> {
    const heuristic = this._computePrediction(currentFilePath, currentLine, currentChar);

    if (!modelRouter) {
      return Promise.resolve(heuristic);
    }

    return new Promise<NextEditPrediction>((resolve) => {
      if (this._debounceTimer !== null) clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(async () => {
        this._debounceTimer = null;
        if (this._disposed) { resolve(heuristic); return; }
        const edits = [...(this._history.getRecent?.(5) ?? [])];
        const mlResult = await this.predictWithModel(
          edits,
          `${currentFilePath}:${currentLine}`,
          modelRouter.ollamaUrl,
          modelRouter.nextEditModelId,
        );
        if (mlResult !== null && mlResult.confidence >= 0.70) {
          resolve(mlResult);
        } else {
          resolve(heuristic);
        }
      }, 150);
    });
  }

  /**
   * Predicts the next edit location from current cursor + edit history.
   * Also resets the idle watcher timer.
   */
  predict(
    currentFilePath: string,
    currentLine: number,
    currentChar: number,
  ): NextEditPrediction {
    const result = this._computePrediction(currentFilePath, currentLine, currentChar);
    this._lastPrediction = result;
    this._resetIdleTimer();
    return result;
  }

  private _computePrediction(
    currentFilePath: string,
    currentLine: number,
    currentChar: number,
  ): NextEditPrediction {

    // 1. Adjacent-line pattern
    const adjacentRun = this._history.getAdjacentLinePattern();
    if (adjacentRun && adjacentRun.length >= 3) {
      const last = adjacentRun[adjacentRun.length - 1]!;
      const isAscending = last.range.startLine > adjacentRun[0]!.range.startLine;
      const nextLine = isAscending
        ? last.range.startLine + 1
        : last.range.startLine - 1;
      if (nextLine >= 0) {
        return {
          filePath: last.filePath,
          line: nextLine,
          character: last.range.startChar,
          confidence: 0.85,
          strategy: "adjacent-line",
        };
      }
    }

    // 2. Column-repeat pattern
    const colPattern = this._history.getColumnPattern();
    if (colPattern) {
      const recent = this._history.getRecent(1);
      const lastEdit = recent[0];
      if (lastEdit) {
        return {
          filePath: lastEdit.filePath,
          line: lastEdit.range.startLine + 1,
          character: colPattern.column,
          confidence: 0.75,
          strategy: "column-repeat",
        };
      }
    }

    // 3. File-oscillation pattern
    const filePair = this._history.getFilePairPattern();
    if (filePair) {
      // If currently in fileA, predict fileB; if in fileB, predict fileA
      const targetFile =
        currentFilePath === filePair.fileA ? filePair.fileB : filePair.fileA;
      // Predict same line/char in other file (best guess without loading it)
      return {
        filePath: targetFile,
        line: currentLine,
        character: currentChar,
        confidence: 0.70,
        strategy: "file-oscillation",
      };
    }

    // 4. Import-declaration pattern
    const recentEdits = this._history.getRecent(1);
    if (recentEdits.length > 0) {
      const lastEdit = recentEdits[0]!;
      if (/^import\s/.test(lastEdit.newText.trimStart())) {
        // Predict the cursor will move down to the usage site (heuristic: +10 lines)
        return {
          filePath: lastEdit.filePath,
          line: Math.max(0, lastEdit.range.startLine + 10),
          character: 0,
          confidence: 0.65,
          strategy: "import-declaration",
        };
      }
    }

    return { ...NONE_PREDICTION, filePath: currentFilePath };
  }

  /**
   * Start the idle watcher. When the user pauses for `idleMs` without
   * a new predict() call, fires onPrediction if confidence ≥ 0.65.
   *
   * This implements the Tabby "warm context" speculative pre-fetch pattern:
   * during idle gaps, predict next edit location and pre-fetch completions,
   * so when cursor arrives there TTFB ≈ 0ms.
   *
   * The watcher is reset on every predict() call.
   */
  startIdleWatcher(
    idleMs: number,
    onPrediction: (pred: NextEditPrediction) => void,
  ): void {
    this._idleMs = idleMs;
    this._idleCallback = onPrediction;
    // Timer will be started on the next predict() call
  }

  /**
   * Stop the idle watcher without disposing the predictor.
   */
  stopIdleWatcher(): void {
    this._clearIdleTimer();
    this._idleCallback = null;
  }

  private _resetIdleTimer(): void {
    this._clearIdleTimer();
    if (!this._idleCallback || this._disposed) return;

    const callback = this._idleCallback;
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (this._disposed) return;
      // Re-compute prediction using last known position (or active editor if available)
      let pred: NextEditPrediction;
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        const pos = activeEditor.selection.active;
        pred = this._computePrediction(activeEditor.document.uri.fsPath, pos.line, pos.character);
      } else if (this._lastPrediction) {
        pred = this._lastPrediction;
      } else {
        return;
      }
      if (pred.confidence >= 0.65) {
        callback(pred);
      }
    }, this._idleMs);
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  dispose(): void {
    this._disposed = true;
    this._clearIdleTimer();
    this._idleCallback = null;
  }
}
