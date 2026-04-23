// ============================================================================
// packages/core/src/completion-telemetry/telemetry-store.ts
//
// Persists completion events to JSONL files under storeDir.
// Writes are async and best-effort — never throws, never blocks the hot path.
// ============================================================================

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CompletionEvent } from "./types.js";

const MAX_DAYS = 7;

export class CompletionTelemetryStore {
  private readonly _dir: string;
  private readonly _readFileFn: (path: string, encoding: "utf-8") => Promise<string>;

  constructor(
    storeDir: string,
    readFileFn?: (path: string, encoding: "utf-8") => Promise<string>,
  ) {
    this._dir = storeDir;
    this._readFileFn = readFileFn ?? readFile;
  }

  private _dateKey(offsetDays = 0): string {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return d.toISOString().slice(0, 10); // "2026-04-13"
  }

  private _filePath(offsetDays = 0): string {
    return join(this._dir, `completions-${this._dateKey(offsetDays)}.jsonl`);
  }

  /**
   * Appends a single completion event to today's JSONL file.
   * Creates the directory if it does not exist.
   * Never throws — all errors are silently swallowed.
   */
  async persist(event: CompletionEvent): Promise<void> {
    try {
      await mkdir(this._dir, { recursive: true });
      await appendFile(this._filePath(), JSON.stringify(event) + "\n");
    } catch {
      // Best-effort — never block the completion path
    }
  }

  /**
   * Reads events from the last `days` JSONL files.
   * Skips missing files and malformed lines.
   */
  async loadRecent(days: number): Promise<CompletionEvent[]> {
    const limit = Math.min(days, MAX_DAYS);
    const events: CompletionEvent[] = [];

    for (let i = 0; i < limit; i++) {
      try {
        const content = await this._readFileFn(this._filePath(i), "utf-8");
        for (const line of content.split("\n")) {
          const trimmed = line.trim();
          if (trimmed.length === 0) continue;
          try {
            events.push(JSON.parse(trimmed) as CompletionEvent);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // File does not exist — skip
      }
    }

    return events;
  }
}
