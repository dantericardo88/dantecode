// ============================================================================
// Playbook Memory — distilled strategy bullets from reasoning chains
// Stores successful/harmful approach patterns for cross-session reuse.
// Uses Jaccard similarity for matching relevant playbook entries.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { tokenize, jaccardSimilarity } from "./approach-memory.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single playbook entry containing distilled strategy bullets. */
export interface PlaybookEntry {
  /** Unique identifier */
  id: string;
  /** Strategy bullets distilled from reasoning chains */
  bullets: string[];
  /** Task description for Jaccard matching */
  taskSignature: string;
  /** Whether this approach was helpful or harmful */
  outcome: "helpful" | "harmful";
  /** Optional error signature for harmful approaches */
  errorSignature?: string;
  /** Session that produced this entry */
  sessionId: string;
  /** ISO timestamp of creation */
  timestamp: string;
}

/** Result from querying playbook memory with similarity score. */
export interface PlaybookQueryResult {
  entry: PlaybookEntry;
  similarity: number;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** Maximum records to keep before LRU eviction. */
const MAX_RECORDS = 500;

/** Minimum Jaccard similarity threshold for query results. */
const MIN_SIMILARITY = 0.3;

/** Maximum age in days before pruning. */
const PRUNE_AGE_DAYS = 30;

// ----------------------------------------------------------------------------
// PlaybookMemory
// ----------------------------------------------------------------------------

/**
 * Persistent playbook memory that stores distilled strategy bullets.
 * Records what approaches were helpful or harmful for cross-session reuse.
 * Uses token-level Jaccard similarity for matching relevant entries.
 */
export class PlaybookMemory {
  private entries: PlaybookEntry[] = [];
  private loaded = false;
  private filePath: string;

  constructor(projectRoot: string) {
    this.filePath = join(projectRoot, ".dantecode", "playbook-memory.json");
  }

  /** Load entries from disk. Idempotent — only loads once. */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const content = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        this.entries = parsed;
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
      this.entries = [];
    }
    this.loaded = true;
  }

  /** Save entries to disk. Creates directory if needed. Non-fatal errors. */
  async save(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(
        this.filePath,
        JSON.stringify(this.entries, null, 2),
        "utf-8",
      );
    } catch {
      // Non-fatal: inability to persist shouldn't break the agent
    }
  }

  /**
   * Add a new playbook entry.
   * Auto-generates id (randomUUID) and timestamp.
   * Triggers load if not yet loaded, then auto-saves.
   */
  async addEntry(
    entry: Omit<PlaybookEntry, "id" | "timestamp">,
  ): Promise<void> {
    await this.load();

    this.entries.push({
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    });

    // LRU eviction: remove oldest entries when over limit
    if (this.entries.length > MAX_RECORDS) {
      this.entries = this.entries.slice(-MAX_RECORDS);
    }

    await this.save();
  }

  /**
   * Query playbook entries similar to a task description.
   * Uses Jaccard similarity with a 0.3 minimum threshold.
   * Returns results sorted by similarity descending, limited to `limit`.
   */
  query(taskDescription: string, limit = 5): PlaybookQueryResult[] {
    const queryTokens = tokenize(taskDescription);
    if (queryTokens.size === 0) return [];

    return this.entries
      .map((entry) => ({
        entry,
        similarity: jaccardSimilarity(
          queryTokens,
          tokenize(entry.taskSignature),
        ),
      }))
      .filter((r) => r.similarity > MIN_SIMILARITY)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Format matching playbook entries for injection into the model prompt.
   * Helpful entries get "[+]" prefix, harmful entries get "[-] AVOID:" prefix.
   * Returns empty string if no matches found.
   */
  formatForPrompt(task: string, limit?: number): string {
    const results = this.query(task, limit);
    if (results.length === 0) return "";

    const lines: string[] = ["## Playbook (from past sessions)"];

    for (const { entry } of results) {
      for (const bullet of entry.bullets) {
        if (entry.outcome === "helpful") {
          lines.push(`[+] ${bullet}`);
        } else {
          lines.push(`[-] AVOID: ${bullet}`);
        }
      }
    }

    return lines.join("\n");
  }

  /** Returns a shallow copy of all entries. */
  getAll(): PlaybookEntry[] {
    return [...this.entries];
  }

  /** Number of stored entries. */
  get size(): number {
    return this.entries.length;
  }

  /** Clear all entries, mark as loaded, and save. */
  async clear(): Promise<void> {
    this.entries = [];
    this.loaded = true;
    await this.save();
  }

  /**
   * Remove entries older than 30 days.
   * Returns the count of removed entries.
   */
  prune(): number {
    const cutoff = Date.now() - PRUNE_AGE_DAYS * 24 * 60 * 60 * 1000;
    const before = this.entries.length;

    this.entries = this.entries.filter((entry) => {
      const entryTime = new Date(entry.timestamp).getTime();
      return entryTime >= cutoff;
    });

    return before - this.entries.length;
  }
}
