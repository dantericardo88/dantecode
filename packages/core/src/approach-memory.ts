// ============================================================================
// Persistent Approach Memory — tracks tried strategies across sessions
// Inspired by Aider's approach tracking + OpenHands persistent context.
// Persists to .dantecode/approach-memory.json for cross-session learning.
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/** A single recorded approach attempt. */
export interface ApproachRecord {
  /** Description of the approach/strategy tried */
  description: string;
  /** What happened */
  outcome: "success" | "failed" | "partial";
  /** Optional error signature for failed approaches */
  errorSignature?: string;
  /** Number of tool calls used */
  toolCalls: number;
  /** ISO timestamp */
  timestamp: string;
  /** Session ID where this was recorded */
  sessionId?: string;
}

/** Options for querying approach memory. */
export interface ApproachQueryOptions {
  /** Only return records matching this outcome */
  outcome?: "success" | "failed" | "partial";
  /** Maximum records to return */
  limit?: number;
}

/** Maximum records to keep before LRU eviction. */
const MAX_RECORDS = 500;

/**
 * Persistent approach memory that survives across sessions.
 * Records what strategies were tried and their outcomes.
 * Uses token-level Jaccard similarity for matching similar tasks.
 */
export class ApproachMemory {
  private records: ApproachRecord[] = [];
  private loaded = false;
  private filePath: string;

  constructor(projectRoot: string) {
    this.filePath = join(projectRoot, ".dantecode", "approach-memory.json");
  }

  /** Load records from disk. Idempotent — only loads once. */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const content = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        this.records = parsed;
      }
    } catch {
      // File doesn't exist or is invalid — start fresh
      this.records = [];
    }
    this.loaded = true;
  }

  /** Save records to disk. Creates directory if needed. */
  async save(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(this.records, null, 2), "utf-8");
    } catch {
      // Non-fatal: inability to persist shouldn't break the agent
    }
  }

  /** Record a new approach attempt. */
  async record(entry: Omit<ApproachRecord, "timestamp">): Promise<void> {
    await this.load();
    this.records.push({
      ...entry,
      timestamp: new Date().toISOString(),
    });

    // LRU eviction: remove oldest records when over limit
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }

    await this.save();
  }

  /** Find approaches similar to a given description using Jaccard token similarity. */
  async findSimilar(description: string, limit = 5): Promise<ApproachRecord[]> {
    await this.load();

    const queryTokens = tokenize(description);
    if (queryTokens.size === 0) return [];

    const scored = this.records
      .map((record) => ({
        record,
        similarity: jaccardSimilarity(queryTokens, tokenize(record.description)),
      }))
      .filter((s) => s.similarity > 0.15) // minimum relevance threshold
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return scored.map((s) => s.record);
  }

  /** Get failed approaches for a task description. */
  async getFailedApproaches(description: string, limit = 5): Promise<ApproachRecord[]> {
    const similar = await this.findSimilar(description, limit * 2);
    return similar.filter((r) => r.outcome === "failed").slice(0, limit);
  }

  /** Get all records, optionally filtered. */
  async getAll(options?: ApproachQueryOptions): Promise<ApproachRecord[]> {
    await this.load();
    let results = [...this.records];
    if (options?.outcome) {
      results = results.filter((r) => r.outcome === options.outcome);
    }
    if (options?.limit) {
      results = results.slice(-options.limit);
    }
    return results;
  }

  /** Clear all records. */
  async clear(): Promise<void> {
    this.records = [];
    this.loaded = true;
    await this.save();
  }

  /** Number of stored records. */
  get size(): number {
    return this.records.length;
  }
}

// ----------------------------------------------------------------------------
// Similarity helpers
// ----------------------------------------------------------------------------

/** Tokenize a string into a set of normalized words. */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

/** Compute Jaccard similarity between two token sets. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }

  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Format approach records for injection into the model prompt.
 */
export function formatApproachesForPrompt(records: ApproachRecord[]): string {
  if (records.length === 0) return "";

  return records
    .map((r) => {
      const icon = r.outcome === "success" ? "+" : r.outcome === "failed" ? "-" : "~";
      const error = r.errorSignature ? ` (error: ${r.errorSignature})` : "";
      return `[${icon}] ${r.description}${error}`;
    })
    .join("\n");
}
