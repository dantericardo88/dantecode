/**
 * durable-event-store.ts
 *
 * Append-only event store with JSONL persistence.
 * Pattern source: OpenHands EventStoreABC with search and filtering.
 *
 * Storage format: .dantecode/events/<sessionId>.jsonl
 * Each line is a complete JSON object with monotonic ID.
 */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { RuntimeEvent } from "@dantecode/runtime-spine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * DurableEventStore interface
 *
 * Append-only event store with search and filtering capabilities.
 */
export interface DurableEventStore {
  /**
   * Append an event to the store.
   * @returns Monotonic event ID (starts at 1)
   */
  append(event: RuntimeEvent): Promise<number>;

  /**
   * Search for events matching the filter.
   * Returns an async iterable for streaming results.
   */
  search(filter: EventFilter): AsyncIterable<StoredEvent>;

  /**
   * Get a single event by ID.
   * @throws {Error} if event not found
   */
  getEvent(id: number): Promise<StoredEvent>;

  /**
   * Get the latest event ID in the store.
   * @returns Latest ID, or 0 if store is empty
   */
  getLatestId(): Promise<number>;

  /**
   * Get all events for a specific run ID.
   * Convenience method equivalent to search({ runId }).
   */
  getEventsForRun(runId: string): AsyncIterable<StoredEvent>;

  /**
   * Flush any pending writes to disk.
   */
  flush(): Promise<void>;
}

/**
 * Filter for searching events
 */
export interface EventFilter {
  /** Filter by task/run ID */
  runId?: string;
  /** Filter by event kind (single or array) */
  kind?: string | string[];
  /** Return events after this ID (exclusive) */
  afterId?: number;
  /** Return events before this ID (exclusive) */
  beforeId?: number;
  /** Maximum number of results to return */
  limit?: number;
}

/**
 * Stored event with monotonic ID
 */
export interface StoredEvent extends RuntimeEvent {
  /** Monotonic event ID (starts at 1) */
  id: number;
}

// ---------------------------------------------------------------------------
// JsonlEventStore
// ---------------------------------------------------------------------------

/**
 * JsonlEventStore
 *
 * JSONL-based event store implementation with atomic append and streaming search.
 *
 * Features:
 * - Atomic append with fs.appendFile
 * - Monotonic ID assignment starting from 1
 * - One complete JSON object per line
 * - Corrupted lines are skipped during search with warning
 * - Async iterator for streaming results
 *
 * @example
 * ```ts
 * const store = new JsonlEventStore("session-123");
 * const id = await store.append({
 *   at: new Date().toISOString(),
 *   kind: "run.tool.completed",
 *   taskId: "task-456",
 *   payload: { tool: "bash", duration: 125 }
 * });
 *
 * // Search with filters
 * for await (const event of store.search({ kind: "run.tool.completed" })) {
 *   console.log(event);
 * }
 * ```
 */
export class JsonlEventStore implements DurableEventStore {
  private readonly filePath: string;
  private nextId: number = 1;
  private initialized: boolean = false;

  /**
   * Create a new JSONL event store.
   *
   * @param sessionId - Session ID for this store
   * @param basePath - Base directory for event storage (default: .dantecode/events)
   */
  constructor(
    private readonly sessionId: string,
    basePath?: string,
  ) {
    const base = basePath ?? resolve(process.cwd(), ".dantecode", "events");
    this.filePath = resolve(base, `${sessionId}.jsonl`);
  }

  /**
   * Initialize the store by ensuring directory exists and reading latest ID.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    // If file exists, read latest ID
    if (existsSync(this.filePath)) {
      const latestId = await this.getLatestId();
      this.nextId = latestId + 1;
    }

    this.initialized = true;
  }

  /**
   * Append an event to the store with atomic write.
   *
   * @returns Monotonic event ID
   */
  async append(event: RuntimeEvent): Promise<number> {
    await this.initialize();

    const id = this.nextId++;
    const stored: StoredEvent = { ...event, id };
    const line = JSON.stringify(stored) + "\n";

    await appendFile(this.filePath, line, "utf-8");

    return id;
  }

  /**
   * Search for events matching the filter.
   *
   * Returns an async iterable for memory-efficient streaming.
   * Corrupted lines are logged and skipped.
   */
  async *search(filter: EventFilter): AsyncIterable<StoredEvent> {
    await this.initialize();

    if (!existsSync(this.filePath)) {
      return; // Empty store
    }

    const stream = createReadStream(this.filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    const kindFilter = Array.isArray(filter.kind)
      ? filter.kind
      : filter.kind
        ? [filter.kind]
        : undefined;
    let count = 0;

    for await (const line of rl) {
      if (!line.trim()) continue;

      let event: StoredEvent;
      try {
        event = JSON.parse(line) as StoredEvent;
      } catch (err) {
        // Skip corrupted line with warning
        console.warn(`[JsonlEventStore] Skipping corrupted line: ${line.slice(0, 100)}`);
        continue;
      }

      // Apply filters
      if (filter.runId && event.taskId !== filter.runId) continue;
      if (kindFilter && !kindFilter.includes(event.kind)) continue;
      if (filter.afterId !== undefined && event.id <= filter.afterId) continue;
      if (filter.beforeId !== undefined && event.id >= filter.beforeId) continue;

      yield event;

      count++;
      if (filter.limit !== undefined && count >= filter.limit) break;
    }
  }

  /**
   * Get a single event by ID.
   *
   * @throws {Error} if event not found
   */
  async getEvent(id: number): Promise<StoredEvent> {
    await this.initialize();

    for await (const event of this.search({})) {
      if (event.id === id) return event;
    }

    throw new Error(`Event with id ${id} not found in store ${this.sessionId}`);
  }

  /**
   * Get the latest event ID in the store.
   *
   * @returns Latest ID, or 0 if store is empty
   */
  async getLatestId(): Promise<number> {
    if (!existsSync(this.filePath)) return 0;

    // Read file and find last valid line
    const content = await readFile(this.filePath, "utf-8");
    const lines = content.trim().split("\n");

    // Read backwards to find last valid event
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]?.trim();
      if (!line) continue;

      try {
        const event = JSON.parse(line) as StoredEvent;
        if (typeof event.id === "number") {
          return event.id;
        }
      } catch {
        // Skip corrupted line
      }
    }

    return 0;
  }

  /**
   * Get all events for a specific run ID.
   */
  async *getEventsForRun(runId: string): AsyncIterable<StoredEvent> {
    yield* this.search({ runId });
  }

  /**
   * Flush any pending writes to disk.
   *
   * Note: fs.appendFile is already atomic and buffered by Node.js,
   * so this is a no-op for JSONL stores. Included for interface compliance.
   */
  async flush(): Promise<void> {
    // No-op: appendFile is already atomic
  }

  /**
   * Get the file path for this store.
   * Useful for debugging and testing.
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Get the session ID for this store.
   */
  getSessionId(): string {
    return this.sessionId;
  }
}
