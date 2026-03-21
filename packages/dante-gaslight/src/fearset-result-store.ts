/**
 * fearset-result-store.ts
 *
 * Disk persistence for FearSetResult records.
 * Mirrors GaslightSessionStore exactly — one JSON file per result.
 *
 * Default location: <cwd>/.dantecode/fearset/results/<resultId>.json
 *
 * Features:
 * - save / load / has / list (newest-first by mtime)
 * - markDistilled — atomically sets distilledAt on disk (replay protection)
 * - cleanup — enforces a max-results cap (FIFO eviction of oldest)
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { FearSetResult } from "@dantecode/runtime-spine";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface FearSetResultStoreOptions {
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /** Results directory relative to cwd. Default: ".dantecode/fearset/results" */
  resultsDir?: string;
}

const DEFAULT_RESULTS_DIR = ".dantecode/fearset/results";

// ─── Store ────────────────────────────────────────────────────────────────────

export class FearSetResultStore {
  private readonly cwd: string;
  private readonly resultsDir: string;

  constructor(opts: FearSetResultStoreOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.resultsDir = opts.resultsDir ?? DEFAULT_RESULTS_DIR;
  }

  get dir(): string {
    return join(this.cwd, this.resultsDir);
  }

  private resultPath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  // ── Core operations ────────────────────────────────────────────────────────

  /** Persist a FearSetResult to disk. Creates the directory if absent. */
  save(result: FearSetResult): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
    writeFileSync(this.resultPath(result.id), JSON.stringify(result, null, 2), "utf-8");
  }

  /** Load a result by ID. Returns null if not found or corrupt. */
  load(id: string): FearSetResult | null {
    const path = this.resultPath(id);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as FearSetResult;
    } catch {
      return null;
    }
  }

  /** Check whether a result exists on disk. */
  has(id: string): boolean {
    return existsSync(this.resultPath(id));
  }

  /**
   * List all results, newest-first by file mtime.
   * Silently skips corrupt files.
   */
  list(): FearSetResult[] {
    if (!existsSync(this.dir)) return [];

    const entries = readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, mtime: statSync(join(this.dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);

    const results: FearSetResult[] = [];
    for (const { name } of entries) {
      try {
        results.push(JSON.parse(readFileSync(join(this.dir, name), "utf-8")) as FearSetResult);
      } catch {
        // corrupt — skip
      }
    }
    return results;
  }

  /**
   * Atomically set `distilledAt` on a persisted result.
   * This is replay protection — prevents the same result from being
   * distilled into the Skillbook twice across process restarts.
   * No-op if the result is not found on disk.
   */
  markDistilled(id: string): void {
    const result = this.load(id);
    if (!result) return;
    this.save({ ...result, distilledAt: new Date().toISOString() });
  }

  /**
   * Delete oldest results, keeping at most `maxResults`.
   * Operates by file mtime (oldest deleted first).
   * Returns the number of results deleted.
   */
  cleanup(maxResults: number): number {
    if (!existsSync(this.dir)) return 0;

    const entries = readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ name: f, mtime: statSync(join(this.dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime); // newest first

    const toDelete = entries.slice(maxResults);
    for (const { name } of toDelete) {
      try {
        unlinkSync(join(this.dir, name));
      } catch {
        // ignore deletion errors
      }
    }
    return toDelete.length;
  }
}
