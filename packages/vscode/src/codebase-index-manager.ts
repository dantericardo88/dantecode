// ============================================================================
// packages/vscode/src/codebase-index-manager.ts
//
// VSCode-side orchestrator for the codebase semantic search index.
// Wraps @dantecode/core CodeIndex with:
//   - Lazy background initialization (non-blocking activate)
//   - Persistent index load on startup (survives session restart)
//   - Debounced incremental reindex on file save (300ms)
//   - State machine with callbacks for status bar integration
//   - Graceful TF-IDF fallback when no embedding provider configured
// ============================================================================

import * as vscode from "vscode";
import { RepoMapProvider, SymbolDefinitionLookup, semanticChunkFileAsync, BM25Index, rrfFusion, TFIDFVectorStore, extractNotebookChunks, isNotebookFile } from "@dantecode/codebase-index";
import type { IndexChunk, RankedChunk } from "@dantecode/codebase-index";
import type { CodeChunk } from "@dantecode/config-types";

/** Adapter: converts IndexChunk[] → CodeChunk[] for CodeIndex.buildIndex/incrementalUpdate */
async function semanticChunkAdapter(
  content: string,
  filePath: string,
  maxChunkLines: number,
): Promise<CodeChunk[]> {
  const chunks = await semanticChunkFileAsync(content, filePath, maxChunkLines);
  return chunks.map((chunk) => ({
    filePath: chunk.filePath,
    startLine: chunk.startLine ?? 1,
    endLine: chunk.endLine ?? 1,
    content: chunk.content,
    symbols: chunk.symbols ?? [],
  }));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type IndexState = "idle" | "indexing" | "ready" | "error";

export interface CodebaseIndexManagerOptions {
  projectRoot: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCodeIndex = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEmbeddingProvider = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCreateEmbeddingProvider = any;

// ── Manager ───────────────────────────────────────────────────────────────────

/**
 * CodebaseIndexManager — VSCode-side wrapper for @dantecode/core CodeIndex.
 *
 * Usage in extension.ts:
 *   const mgr = new CodebaseIndexManager(projectRoot);
 *   void mgr.initialize();          // background, non-blocking
 *   mgr.onStateChange(cb);          // hook into status bar
 *   // On file save:
 *   mgr.onFileSaved(fsPath);
 *   // On dispose:
 *   mgr.dispose();
 */
export class CodebaseIndexManager {
  private _state: IndexState = "idle";
  private _chunkCount = 0;
  private _codeIndex: AnyCodeIndex = null;
  private _embeddingProvider: AnyEmbeddingProvider = null;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _stateCallbacks: Array<(state: IndexState, count: number) => void> = [];
  private _bm25 = new BM25Index();
  private _tfidf = new TFIDFVectorStore();

  readonly repoMapProvider = new RepoMapProvider();
  readonly symbolDefLookup: SymbolDefinitionLookup;

  readonly projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.symbolDefLookup = new SymbolDefinitionLookup(() => this.getChunks());
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Initialize the index.
   * - Tries to load a saved index first (fast path, ~10ms).
   * - If no saved index (or force=true), fires buildIndex() in the background
   *   and returns immediately so activate() is never blocked.
   */
  async initialize(options?: { force?: boolean }): Promise<void> {
    this._state = "indexing";
    this._emitStateChange();

    try {
      const { CodeIndex, createEmbeddingProvider } = await import("@dantecode/core");
      this._codeIndex = new CodeIndex();
      this._embeddingProvider = this._buildEmbeddingProvider(createEmbeddingProvider);

      if (!options?.force) {
        const loaded = await (this._codeIndex as AnyCodeIndex).load(this.projectRoot);
        if (loaded) {
          this._chunkCount = (this._codeIndex as AnyCodeIndex).size as number;
          this._state = "ready";
          this._emitStateChange();
          return;
        }
      }

      // Fire-and-forget: background build — caller returns immediately
      void this._runBuild();
    } catch {
      this._state = "error";
      this._emitStateChange();
    }
  }

  /**
   * Critical bug fix: called by CompletionContextRetriever (via extension.ts)
   * to feed BM25 retrieval. Previously missing — caused BM25 to always return [].
   */
  getChunks(): Array<{ filePath: string; content: string }> {
    if (this._state !== "ready" || !this._codeIndex) return [];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    return (this._codeIndex.getChunks() as Array<{ filePath: string; content: string }>) ?? [];
  }

  /**
   * Return a compact FIM-ready repo map string (TTL-cached, 5 min).
   * Called by DanteCodeCompletionProvider on every completion cycle.
   */
  async getRepoMap(budgetTokens = 100): Promise<string> {
    return this.repoMapProvider.getMap(this.projectRoot, budgetTokens);
  }

  /**
   * Look up a symbol definition chunk by name.
   * Returns null if not found or index not ready.
   */
  lookupSymbol(name: string): IndexChunk | null {
    if (this._state !== "ready") return null;
    return this.symbolDefLookup.lookup(name);
  }

  /**
   * Semantic search. Returns empty array instantly when index is not ready.
   * Uses RRF fusion of TF-IDF + BM25 results for higher-quality ranking.
   */
  async search(query: string, limit = 8): Promise<unknown[]> {
    if (this._state !== "ready" || !this._codeIndex) {
      return [];
    }

    // TF-IDF results from CodeIndex
    const tfidfRaw = (this._codeIndex as AnyCodeIndex).search(query, limit * 2) as Array<{
      filePath: string;
      startLine?: number;
      endLine?: number;
      content: string;
      symbols?: string[];
    }>;
    const tfidfResults: RankedChunk[] = tfidfRaw.map((c) => ({
      key: `${c.filePath}:${c.startLine ?? 0}`,
      chunk: { filePath: c.filePath, startLine: c.startLine, endLine: c.endLine, content: c.content, symbols: c.symbols },
    }));

    // BM25 results
    const bm25Results = this._bm25.search(query, limit * 2);

    // TF-IDF vector store results
    const vectorResults: RankedChunk[] = this._tfidf.search(query, limit * 2).map((r) => ({
      key: r.key,
      chunk: r.chunk,
    }));

    // RRF fusion — produces de-duplicated, re-ranked list
    const fused = rrfFusion([tfidfResults, bm25Results, vectorResults]);
    return fused.slice(0, limit).map((r) => r.chunk);
  }

  /**
   * Called on vscode.workspace.onDidSaveTextDocument.
   * Debounced 300ms to coalesce rapid multi-file saves.
   */
  onFileSaved(fsPath: string): void {
    // Invalidate the repo map cache on every save so the next FIM completion
    // picks up updated file rankings.
    this.repoMapProvider.invalidate();

    // Remove stale BM25 and TF-IDF entries for this file before incremental reindex
    const relPath = fsPath.replace(/\\/g, "/");
    this._bm25.removeFile(relPath);
    this._tfidf.removeFile(relPath);

    // If this is a notebook, reindex it immediately
    if (isNotebookFile(fsPath)) {
      void this._reindexNotebook(fsPath);
    }

    if (this._state !== "ready") return;
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
    }
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      void this._runIncremental();
    }, 300);
  }

  /** Register a callback that fires on every state transition. */
  onStateChange(callback: (state: IndexState, count: number) => void): void {
    this._stateCallbacks.push(callback);
  }

  get currentState(): IndexState {
    return this._state;
  }

  get indexedChunkCount(): number {
    return this._chunkCount;
  }

  dispose(): void {
    if (this._debounceTimer !== null) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    this._stateCallbacks = [];
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async _runBuild(): Promise<void> {
    try {
      await (this._codeIndex as AnyCodeIndex).buildIndex(
        this.projectRoot,
        this._getConfig(),
        this._embeddingProvider,
        semanticChunkAdapter,
      );
      // Rebuild BM25 and TF-IDF indexes from all chunks
      this._bm25.clear();
      this._tfidf.clear();
      const chunks = this.getChunks();
      for (const c of chunks) {
        this._bm25.add(c as IndexChunk);
        this._tfidf.add(c as IndexChunk);
      }
      // Persist core index and update chunk count
      this._chunkCount = (this._codeIndex as AnyCodeIndex).size as number;
      await (this._codeIndex as AnyCodeIndex).save(this.projectRoot);
      this._state = "ready";
      // Notebook indexing is supplemental — fire-and-forget so the index is
      // immediately usable and test assertions don't race with filesystem walks
      void this._indexNotebooks();
    } catch {
      this._state = "error";
    } finally {
      this._emitStateChange();
    }
  }

  private async _runIncremental(): Promise<void> {
    if (!this._codeIndex) return;
    try {
      await (this._codeIndex as AnyCodeIndex).incrementalUpdate(
        this.projectRoot,
        this._getConfig(),
        this._embeddingProvider,
        semanticChunkAdapter,
      );
      this._chunkCount = (this._codeIndex as AnyCodeIndex).size as number;
      await (this._codeIndex as AnyCodeIndex).save(this.projectRoot);
      // State stays "ready" — no emit to avoid status bar flicker
    } catch {
      // Incremental failures are non-fatal; silently swallow
    }
  }

  private _buildEmbeddingProvider(
    createEmbeddingProvider: AnyCreateEmbeddingProvider,
  ): AnyEmbeddingProvider {
    try {
      const config = vscode.workspace.getConfiguration("dantecode");
      const providerName = config.get<string>("codebaseIndex.embeddingProvider", "none");
      switch (providerName) {
        case "openai":
          return createEmbeddingProvider("openai", {
            apiKey: process.env["OPENAI_API_KEY"] ?? "",
          }) as AnyEmbeddingProvider;
        case "google":
          return createEmbeddingProvider("google", {
            apiKey: process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"] ?? "",
          }) as AnyEmbeddingProvider;
        case "ollama":
          return createEmbeddingProvider("ollama", {}) as AnyEmbeddingProvider;
        default:
          return null;
      }
    } catch {
      return null; // Graceful degradation to TF-IDF
    }
  }

  private _getConfig(): Record<string, unknown> {
    const config = vscode.workspace.getConfiguration("dantecode");
    return {
      maxChunkLines: config.get<number>("codebaseIndex.maxChunkLines", 200),
    };
  }

  private async _indexNotebooks(): Promise<void> {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const IGNORE = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
    const notebooks: string[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 6 || notebooks.length >= 100) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (IGNORE.has(entry.name)) continue;
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(full, depth + 1);
          } else if (entry.name.endsWith(".ipynb") && notebooks.length < 100) {
            notebooks.push(full);
          }
        }
      } catch { /* ignore unreadable dirs */ }
    };

    await walk(this.projectRoot, 0);

    const rootNormalized = this.projectRoot.replace(/\\/g, "/");
    for (const nbPath of notebooks) {
      try {
        const content = await readFile(nbPath, "utf-8");
        const rel = nbPath.replace(/\\/g, "/").replace(rootNormalized + "/", "");
        const chunks = extractNotebookChunks(content, rel);
        for (const c of chunks) {
          this._bm25.add(c);
          this._tfidf.add(c);
        }
      } catch { /* skip unreadable notebooks */ }
    }
  }

  private async _reindexNotebook(fsPath: string): Promise<void> {
    const { readFile } = await import("node:fs/promises");
    try {
      const content = await readFile(fsPath, "utf-8");
      const rootNormalized = this.projectRoot.replace(/\\/g, "/");
      const rel = fsPath.replace(/\\/g, "/").replace(rootNormalized + "/", "");
      this._tfidf.removeFile(rel);
      this._bm25.removeFile(rel);
      const chunks = extractNotebookChunks(content, rel);
      for (const c of chunks) {
        this._bm25.add(c);
        this._tfidf.add(c);
      }
    } catch { /* skip */ }
  }

  private _emitStateChange(): void {
    for (const cb of this._stateCallbacks) {
      cb(this._state, this._chunkCount);
    }
  }
}
