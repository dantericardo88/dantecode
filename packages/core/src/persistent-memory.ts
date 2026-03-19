// ============================================================================
// Persistent Memory — hybrid cross-session context system
// Combines event-sourced persistence with Jaccard-similarity retrieval.
// No external embedding dependencies — uses token-level similarity from
// approach-memory for deduplication and search.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { tokenize, jaccardSimilarity } from "./approach-memory.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single memory entry persisted across sessions. */
export interface MemoryEntry {
  /** Unique identifier for this entry */
  id: string;
  /** The content/knowledge stored */
  content: string;
  /** Classification of what kind of memory this is */
  category: "fact" | "decision" | "error" | "strategy" | "context";
  /** Session that created this entry (optional) */
  sessionId?: string;
  /** ISO timestamp when the entry was first created */
  timestamp: string;
  /** Current relevance score (starts at 1.0, decays or is boosted) */
  relevanceScore: number;
  /** How many times this entry has been accessed/matched */
  accessCount: number;
  /** ISO timestamp of last access (used for LRU eviction) */
  lastAccessed: string;
  /** Freeform tags for filtering and grouping */
  tags: string[];
}

/** Options for searching memory entries. */
export interface MemorySearchOptions {
  /** Filter results to this category only */
  category?: MemoryEntry["category"];
  /** Filter results to this session only */
  sessionId?: string;
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum Jaccard similarity score to include (default: 0.1) */
  minRelevance?: number;
}

/** Result of a distill (compression) operation. */
export interface MemoryDistillResult {
  /** Number of entries kept as-is */
  kept: number;
  /** Number of entries removed entirely */
  removed: number;
  /** Number of entries merged (distilled) into others */
  distilled: number;
}

/** Configuration options for PersistentMemory. */
export interface PersistentMemoryOptions {
  /** Directory path for storage relative to project root. Default: ".dantecode" */
  storageDir?: string;
  /** Max entries before LRU eviction kicks in. Default: 1000 */
  maxEntries?: number;
  /** Jaccard threshold for duplicate detection during store(). Default: 0.8 */
  deduplicationThreshold?: number;
  /** Injectable filesystem functions for testing */
  fsFn?: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
  };
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Default storage subdirectory within the project root. */
const DEFAULT_STORAGE_DIR = ".dantecode";

/** Default maximum number of entries before eviction. */
const DEFAULT_MAX_ENTRIES = 1000;

/** Default Jaccard similarity threshold for considering entries as duplicates. */
const DEFAULT_DEDUP_THRESHOLD = 0.8;

/** Default number of search results to return. */
const DEFAULT_SEARCH_LIMIT = 10;

/** Default minimum similarity score for search results. */
const DEFAULT_MIN_RELEVANCE = 0.1;

/** Jaccard threshold for near-duplicate merging during distill(). */
const DISTILL_MERGE_THRESHOLD = 0.7;

/** Filename for the persistent memory JSON store. */
const STORAGE_FILENAME = "persistent-memory.json";

// ----------------------------------------------------------------------------
// PersistentMemory
// ----------------------------------------------------------------------------

/**
 * Hybrid persistent memory for cross-session context.
 *
 * Stores facts, decisions, errors, strategies, and context entries that
 * survive across agent sessions. Uses Jaccard token similarity for
 * deduplication during writes and relevance scoring during reads.
 *
 * Key features:
 * - **Deduplication**: Similar content is detected and merged on store()
 * - **LRU eviction**: Oldest entries are evicted when capacity is reached
 * - **Similarity search**: Query with natural language, get ranked results
 * - **Distillation**: Compress memory by merging near-duplicates
 * - **Session awareness**: Filter and resume by session ID
 * - **Prompt formatting**: Ready-to-inject formatted output for LLM context
 *
 * @example
 * ```ts
 * const memory = new PersistentMemory("/path/to/project");
 * await memory.load();
 * await memory.store("TypeScript strict mode enabled", "decision", ["config"]);
 * const results = await memory.search("typescript configuration");
 * ```
 */
export class PersistentMemory {
  /** In-memory store of all entries. */
  private entries: MemoryEntry[] = [];

  /** Whether the store has been loaded from disk. */
  private loaded = false;

  /** Absolute path to the JSON storage file. */
  private readonly filePath: string;

  /** Maximum entries before LRU eviction. */
  private readonly maxEntries: number;

  /** Jaccard threshold for duplicate detection on store(). */
  private readonly deduplicationThreshold: number;

  /** Filesystem functions (injectable for testing). */
  private readonly fs: {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
  };

  /**
   * Create a new PersistentMemory instance.
   *
   * @param projectRoot - Absolute path to the project root directory
   * @param options - Configuration options
   */
  constructor(projectRoot: string, options: PersistentMemoryOptions = {}) {
    const storageDir = options.storageDir ?? DEFAULT_STORAGE_DIR;
    this.filePath = join(projectRoot, storageDir, STORAGE_FILENAME);
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.deduplicationThreshold = options.deduplicationThreshold ?? DEFAULT_DEDUP_THRESHOLD;
    this.fs = options.fsFn ?? { readFile, writeFile, mkdir };
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  /**
   * Load entries from disk into memory.
   *
   * Safe to call multiple times — only reads on the first invocation.
   * If the storage file does not exist, starts with an empty store.
   */
  async load(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await this.fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw as string);
      if (Array.isArray(parsed)) {
        this.entries = parsed;
      }
    } catch {
      // File doesn't exist or is corrupt — start fresh
      this.entries = [];
    }

    this.loaded = true;
  }

  /**
   * Persist current entries to disk.
   *
   * Creates the storage directory if it does not exist.
   * Errors are silently swallowed — persistence should not break the agent.
   */
  async save(): Promise<void> {
    try {
      await this.fs.mkdir(dirname(this.filePath), { recursive: true });
      await this.fs.writeFile(
        this.filePath,
        JSON.stringify(this.entries, null, 2),
        "utf-8",
      );
    } catch {
      // Non-fatal: disk errors should not crash the agent
    }
  }

  // --------------------------------------------------------------------------
  // Core Operations
  // --------------------------------------------------------------------------

  /**
   * Store a new memory entry, or update an existing duplicate.
   *
   * Deduplication: If the content's Jaccard similarity to an existing entry
   * meets or exceeds the deduplication threshold, the existing entry's
   * accessCount and lastAccessed are updated instead of creating a new entry.
   *
   * LRU eviction: When the store exceeds maxEntries, the oldest entries
   * (by lastAccessed) are evicted to make room.
   *
   * @param content - The knowledge/fact/decision to store
   * @param category - Classification of the memory type
   * @param tags - Optional freeform tags for filtering
   * @param sessionId - Optional session identifier
   * @returns The stored or updated MemoryEntry
   */
  async store(
    content: string,
    category: MemoryEntry["category"],
    tags: string[] = [],
    sessionId?: string,
  ): Promise<MemoryEntry> {
    await this.load();

    const now = new Date().toISOString();
    const contentTokens = tokenize(content);

    // Check for duplicates — update existing entry if found
    for (const entry of this.entries) {
      const entryTokens = tokenize(entry.content);
      const similarity = jaccardSimilarity(contentTokens, entryTokens);

      if (similarity >= this.deduplicationThreshold) {
        // Existing entry is close enough — just bump access metadata
        entry.accessCount += 1;
        entry.lastAccessed = now;
        await this.save();
        return entry;
      }
    }

    // No duplicate found — create a new entry
    const entry: MemoryEntry = {
      id: randomUUID(),
      content,
      category,
      sessionId,
      timestamp: now,
      relevanceScore: 1.0,
      accessCount: 1,
      lastAccessed: now,
      tags,
    };

    this.entries.push(entry);

    // LRU eviction: if over capacity, remove the least-recently-accessed
    if (this.entries.length > this.maxEntries) {
      this.entries.sort(
        (a, b) => new Date(a.lastAccessed).getTime() - new Date(b.lastAccessed).getTime(),
      );
      this.entries = this.entries.slice(this.entries.length - this.maxEntries);
    }

    await this.save();
    return entry;
  }

  /**
   * Search memory entries by natural language query.
   *
   * Computes Jaccard similarity between the query tokens and each entry's
   * content tokens. Results are filtered by optional criteria and sorted
   * by descending similarity score.
   *
   * @param query - Natural language search query
   * @param options - Optional filters and limits
   * @returns Array of entries with their similarity scores, sorted by score desc
   */
  search(query: string, options: MemorySearchOptions = {}): Array<{ entry: MemoryEntry; score: number }> {
    const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;
    const minRelevance = options.minRelevance ?? DEFAULT_MIN_RELEVANCE;

    const queryTokens = tokenize(query);
    if (queryTokens.size === 0) return [];

    // Score all entries against the query
    let scored = this.entries
      .map((entry) => ({
        entry,
        score: jaccardSimilarity(queryTokens, tokenize(entry.content)),
      }))
      .filter((result) => result.score >= minRelevance);

    // Apply optional filters
    if (options.category) {
      scored = scored.filter((r) => r.entry.category === options.category);
    }
    if (options.sessionId) {
      scored = scored.filter((r) => r.entry.sessionId === options.sessionId);
    }

    // Sort by score descending and limit
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  /**
   * Distill (compress) the memory store.
   *
   * Performs two passes:
   * 1. **Merge pass**: Within each category, find near-duplicates
   *    (Jaccard >= 0.7) and merge them — keeping the higher-scored entry,
   *    combining tags, and incrementing accessCount.
   * 2. **Eviction pass**: If still over targetCount, evict entries with
   *    the lowest relevanceScore.
   *
   * @param targetCount - Desired maximum entries after distillation.
   *   Defaults to half of maxEntries.
   * @returns Summary of how many entries were kept, removed, and distilled
   */
  async distill(targetCount?: number): Promise<MemoryDistillResult> {
    await this.load();

    const target = targetCount ?? Math.floor(this.maxEntries / 2);
    let distilledCount = 0;

    // Group entries by category for targeted merging
    const categories: MemoryEntry["category"][] = [
      "fact",
      "decision",
      "error",
      "strategy",
      "context",
    ];

    for (const category of categories) {
      const categoryEntries = this.entries.filter((e) => e.category === category);
      const mergedIds = new Set<string>();

      for (let i = 0; i < categoryEntries.length; i++) {
        const entryI = categoryEntries[i]!;
        if (mergedIds.has(entryI.id)) continue;

        const tokensI = tokenize(entryI.content);

        for (let j = i + 1; j < categoryEntries.length; j++) {
          const entryJ = categoryEntries[j]!;
          if (mergedIds.has(entryJ.id)) continue;

          const tokensJ = tokenize(entryJ.content);
          const similarity = jaccardSimilarity(tokensI, tokensJ);

          if (similarity >= DISTILL_MERGE_THRESHOLD) {
            // Merge j into i — keep the one with higher relevanceScore
            const keeper = entryI;
            const absorbed = entryJ;

            // Keep the higher-scored entry as the primary
            if (absorbed.relevanceScore > keeper.relevanceScore) {
              keeper.relevanceScore = absorbed.relevanceScore;
              keeper.content = absorbed.content;
            }

            // Combine tags (deduplicated)
            const allTags = new Set([...keeper.tags, ...absorbed.tags]);
            keeper.tags = [...allTags];

            // Accumulate access count
            keeper.accessCount += absorbed.accessCount;

            // Keep the more recent lastAccessed
            if (new Date(absorbed.lastAccessed) > new Date(keeper.lastAccessed)) {
              keeper.lastAccessed = absorbed.lastAccessed;
            }

            mergedIds.add(absorbed.id);
            distilledCount++;
          }
        }
      }

      // Remove absorbed entries from the main store
      if (mergedIds.size > 0) {
        this.entries = this.entries.filter((e) => !mergedIds.has(e.id));
      }
    }

    // Eviction pass: if still over target, drop lowest-scored entries
    let removedCount = 0;
    if (this.entries.length > target) {
      this.entries.sort((a, b) => b.relevanceScore - a.relevanceScore);
      const evicted = this.entries.length - target;
      this.entries = this.entries.slice(0, target);
      removedCount = evicted;
    }

    await this.save();

    const keptCount = this.entries.length;
    return {
      kept: keptCount,
      removed: removedCount,
      distilled: distilledCount,
    };
  }

  // --------------------------------------------------------------------------
  // Session-Aware Queries
  // --------------------------------------------------------------------------

  /**
   * Get all entries that belong to a specific session.
   *
   * @param sessionId - The session identifier to filter by
   * @returns Array of entries from the given session, ordered by timestamp
   */
  getSessionEntries(sessionId: string): MemoryEntry[] {
    return this.entries
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  /**
   * Build a context string for resuming a session.
   *
   * Combines entries from the target session with the highest-scored entries
   * across all sessions, producing a formatted text block suitable for
   * injecting into a system prompt.
   *
   * @param sessionId - The session to resume
   * @param topK - Maximum total entries to include (default: 20)
   * @returns Formatted string summarizing the most relevant context
   */
  resumeSession(sessionId: string, topK = 20): string {
    // Get entries specific to this session
    const sessionEntries = this.getSessionEntries(sessionId);

    // Get the highest-scored entries across all sessions
    const globalTop = [...this.entries]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);

    // Merge and deduplicate (session entries first, then global)
    const seenIds = new Set<string>();
    const merged: MemoryEntry[] = [];

    for (const entry of sessionEntries) {
      if (!seenIds.has(entry.id) && merged.length < topK) {
        seenIds.add(entry.id);
        merged.push(entry);
      }
    }

    for (const entry of globalTop) {
      if (!seenIds.has(entry.id) && merged.length < topK) {
        seenIds.add(entry.id);
        merged.push(entry);
      }
    }

    if (merged.length === 0) {
      return "No memory entries found for this session.";
    }

    const lines = merged.map((e) => {
      const categoryTag = `[${e.category.toUpperCase()}]`;
      const tagsStr = e.tags.length > 0 ? ` (${e.tags.join(", ")})` : "";
      return `- ${categoryTag} ${e.content}${tagsStr}`;
    });

    return `Session memory (${merged.length} entries):\n${lines.join("\n")}`;
  }

  // --------------------------------------------------------------------------
  // Formatting
  // --------------------------------------------------------------------------

  /**
   * Format the top-K most relevant entries as bullet points for prompt injection.
   *
   * Entries are sorted by relevanceScore descending and formatted as a
   * compact bullet list with category tags.
   *
   * @param topK - Maximum number of entries to include (default: 10)
   * @returns Formatted string, or empty string if no entries exist
   */
  formatForPrompt(topK = 10): string {
    if (this.entries.length === 0) return "";

    const top = [...this.entries]
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, topK);

    const lines = top.map((e) => {
      const categoryTag = `[${e.category.toUpperCase()}]`;
      return `- ${categoryTag} ${e.content}`;
    });

    return lines.join("\n");
  }

  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------

  /**
   * Clear all entries and persist the empty store.
   */
  async clear(): Promise<void> {
    this.entries = [];
    this.loaded = true;
    await this.save();
  }

  /**
   * Get a shallow copy of all entries.
   *
   * Returns a copy to prevent external mutation of the internal store.
   *
   * @returns Array of all memory entries
   */
  getAll(): MemoryEntry[] {
    return [...this.entries];
  }

  /**
   * Get the current number of entries in the store.
   *
   * @returns Entry count
   */
  size(): number {
    return this.entries.length;
  }
}
