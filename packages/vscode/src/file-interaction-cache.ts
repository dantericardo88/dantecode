// packages/vscode/src/file-interaction-cache.ts
// Twinny-harvested: file interaction relevance scoring for FIM context.
// Pattern: twinnydotdev/twinny src/extension/providers/completion.ts (lines 486-629)
// Tracks which files the user interacts with most to surface high-quality
// cross-file context without requiring explicit @mention.

import * as path from "node:path";

export interface FileInteractionRecord {
  uri: string;
  /** Absolute path, normalized */
  filePath: string;
  fileName: string;
  /** Recency-weighted interaction count */
  relevanceScore: number;
  /** Line numbers the user edited/navigated to */
  activeLines: number[];
  lastInteractionMs: number;
}

export interface RelevantDocument {
  uri: string;
  filePath: string;
  fileName: string;
  relevanceScore: number;
  /** Window of active lines for context extraction */
  activeLines: number[];
}

interface CacheOptions {
  /** Max files to track (LRU eviction above this) */
  maxFiles?: number;
  /** Active-line window size around interaction point */
  lineWindow?: number;
  /** Decay rate per minute (score *= (1 - decayRate) per minute elapsed) */
  decayRatePerMin?: number;
}

const DEFAULTS: Required<CacheOptions> = {
  maxFiles: 50,
  lineWindow: 100,
  decayRatePerMin: 0.002,
};

// Files matching these patterns are excluded from context
const EXCLUDED_PATTERNS = [
  /\.git\//,
  /node_modules\//,
  /dist\//,
  /\.min\.(js|css)$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
];

export class FileInteractionCache {
  private readonly _records = new Map<string, FileInteractionRecord>();
  private readonly _opts: Required<CacheOptions>;

  constructor(opts: CacheOptions = {}) {
    this._opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Record a user interaction with a file at a specific line.
   * Call this from vscode.workspace.onDidChangeTextDocument and
   * vscode.window.onDidChangeActiveTextEditor.
   */
  recordInteraction(uri: string, filePath: string, line: number): void {
    if (this._isExcluded(filePath)) return;

    const now = Date.now();
    const existing = this._records.get(uri);

    if (existing) {
      // Decay old score before adding new interaction
      const minutesElapsed = (now - existing.lastInteractionMs) / 60_000;
      const decayed = existing.relevanceScore * Math.pow(1 - this._opts.decayRatePerMin, minutesElapsed);
      existing.relevanceScore = decayed + 1;
      existing.lastInteractionMs = now;
      // Keep only the last lineWindow active lines, deduplicated
      if (!existing.activeLines.includes(line)) {
        existing.activeLines.push(line);
        if (existing.activeLines.length > this._opts.lineWindow) {
          existing.activeLines.shift();
        }
      }
    } else {
      // Evict lowest-scoring entry if at capacity
      if (this._records.size >= this._opts.maxFiles) {
        this._evictLowest();
      }
      this._records.set(uri, {
        uri,
        filePath: path.normalize(filePath),
        fileName: path.basename(filePath),
        relevanceScore: 1,
        activeLines: [line],
        lastInteractionMs: now,
      });
    }
  }

  /**
   * Returns top N files by relevance score, excluding the current file.
   * Applies time-decay to scores before sorting.
   */
  getRelevantDocuments(currentUri: string, limit = 3): RelevantDocument[] {
    const now = Date.now();
    const results: Array<FileInteractionRecord & { decayedScore: number }> = [];

    for (const [uri, record] of this._records) {
      if (uri === currentUri) continue;
      const minutesElapsed = (now - record.lastInteractionMs) / 60_000;
      const decayedScore = record.relevanceScore * Math.pow(1 - this._opts.decayRatePerMin, minutesElapsed);
      if (decayedScore > 0.01) {
        results.push({ ...record, decayedScore });
      }
    }

    results.sort((a, b) => b.decayedScore - a.decayedScore);

    return results.slice(0, limit).map(({ uri, filePath, fileName, activeLines, decayedScore }) => ({
      uri,
      filePath,
      fileName,
      relevanceScore: decayedScore,
      activeLines,
    }));
  }

  /** Remove a file from the cache (e.g., when deleted) */
  remove(uri: string): void {
    this._records.delete(uri);
  }

  /** Clear all records */
  clear(): void {
    this._records.clear();
  }

  /** Number of tracked files */
  get size(): number {
    return this._records.size;
  }

  private _isExcluded(filePath: string): boolean {
    return EXCLUDED_PATTERNS.some((p) => p.test(filePath.replace(/\\/g, "/")));
  }

  private _evictLowest(): void {
    let lowestUri = "";
    let lowestScore = Infinity;
    for (const [uri, record] of this._records) {
      if (record.relevanceScore < lowestScore) {
        lowestScore = record.relevanceScore;
        lowestUri = uri;
      }
    }
    if (lowestUri) this._records.delete(lowestUri);
  }
}

/** Module-level singleton for use across VSCode extension lifetime */
export const globalInteractionCache = new FileInteractionCache();
