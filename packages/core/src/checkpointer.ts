// ============================================================================
// @dantecode/core — Event-Sourced Checkpointer
// LangGraph-style Checkpointer + OpenHands event-sourced state.
// Stores base_state.json + incremental event log directory.
// Resume = load base + replay only new events from last processed point.
// ============================================================================

import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  CheckpointReplaySummarySchema,
  CheckpointWorkspaceContextSchema,
  type CheckpointReplaySummary as RuntimeCheckpointReplaySummary,
  type CheckpointWorkspaceContext as RuntimeCheckpointWorkspaceContext,
  type ApplyReceipt,
} from "@dantecode/runtime-spine";

// ----------------------------------------------------------------------------
// Types — LangGraph-inspired
// ----------------------------------------------------------------------------

/** Base state snapshot (LangGraph Checkpoint equivalent). */
export interface Checkpoint {
  /** Format version. */
  v: number;
  /** Unique checkpoint ID. */
  id: string;
  /** ISO-8601 timestamp. */
  ts: string;
  /** Current execution step. */
  step: number;
  /** Channel values — the actual state. */
  channelValues: Record<string, unknown>;
  /** Monotonic version per channel for conflict detection. */
  channelVersions: Record<string, number>;
}

/** Metadata about how the checkpoint was created. */
export interface CheckpointMetadata {
  /** How the checkpoint originated. */
  source: "input" | "loop" | "update" | "fork";
  /** Execution step when created. */
  step: number;
  /** Parent checkpoint ID. */
  parentId?: string;
  /** Command that triggered the session. */
  triggerCommand?: string;
  /** Additional metadata. */
  extra?: Record<string, unknown>;
}

/** Wave 2 closure: Apply receipt metadata for event sourcing. */
export interface ApplyReceiptMetadata {
  /** Step that was applied. */
  stepId: string;
  /** Outcome state. */
  state: "success" | "failed" | "skipped";
  /** Command that triggered the apply. */
  triggerCommand?: string;
  /** Additional metadata. */
  extra?: Record<string, unknown>;
}

/** A single incremental write — stored separately from base state (LangGraph pattern). */
export interface PendingWrite {
  /** Task that produced this write. */
  taskId: string;
  /** Channel/key being written to. */
  channel: string;
  /** The value. */
  value: unknown;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

/** Complete checkpoint with metadata + pending writes (LangGraph CheckpointTuple). */
export interface CheckpointTuple {
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
  pendingWrites: PendingWrite[];
  parentId?: string;
  replaySummary?: CheckpointReplaySummary;
  workspaceContext?: CheckpointWorkspaceContext;
}

export type CheckpointReplaySummary = RuntimeCheckpointReplaySummary;
export type CheckpointWorkspaceContext = RuntimeCheckpointWorkspaceContext;

export interface CheckpointRuntimeEnvelope {
  replaySummary?: CheckpointReplaySummary;
  workspaceContext?: CheckpointWorkspaceContext;
}

/** An event in the event log (OpenHands-style). */
export interface CheckpointEvent {
  /** Unique event ID. */
  id: string;
  /** Sequential index in the log. */
  index: number;
  /** Event type. */
  kind: "checkpoint" | "write" | "error" | "action" | "observation";
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Source of the event. */
  source: "agent" | "user" | "system";
  /** Event payload. */
  data: unknown;
}

/** Options for listing checkpoints. */
export interface CheckpointListOptions {
  /** Return checkpoints before this ID (exclusive). */
  before?: string;
  /** Maximum number to return. */
  limit?: number;
  /** Filter by metadata fields. */
  filter?: Partial<CheckpointMetadata>;
}

/** Options for the EventSourcedCheckpointer constructor. */
export interface EventSourcedCheckpointerOptions {
  /** Base directory for checkpoints. Defaults to `.danteforge/checkpoints`. */
  baseDir?: string;
  /** Maximum events before compaction into new base state. Default: 100. */
  maxEventsBeforeCompaction?: number;
  /** Injectable file I/O. */
  writeFileFn?: (path: string, data: string) => Promise<void>;
  readFileFn?: (path: string) => Promise<string>;
  mkdirFn?: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
  readdirFn?: (path: string) => Promise<string[]>;
  unlinkFn?: (path: string) => Promise<void>;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const CHECKPOINT_FORMAT_VERSION = 1;
const BASE_STATE_FILE = "base_state.json";
const EVENTS_DIR = "events";
const DEFAULT_MAX_EVENTS = 100;

// ----------------------------------------------------------------------------
// EventSourcedCheckpointer
// ----------------------------------------------------------------------------

/**
 * Event-sourced checkpointer combining LangGraph's Checkpointer interface
 * with OpenHands' event-log persistence pattern.
 *
 * Directory structure:
 * ```
 * {baseDir}/{sessionId}/
 *   base_state.json              — Latest compacted state snapshot
 *   events/
 *     event-00000-{uuid}.json    — First event since last base state
 *     event-00001-{uuid}.json    — Second event
 *     ...
 * ```
 *
 * - `put()` creates a new checkpoint (writes base_state.json + checkpoint event)
 * - `putWrite()` appends an incremental write event (never rewrites base)
 * - `getTuple()` loads base + replays events to reconstruct state
 * - Auto-compaction after `maxEventsBeforeCompaction` events
 */
export class EventSourcedCheckpointer {
  private readonly baseDir: string;
  private readonly sessionId: string;
  private readonly maxEvents: number;
  private readonly writeFileFn: (p: string, d: string) => Promise<void>;
  private readonly readFileFn: (p: string) => Promise<string>;
  private readonly mkdirFn: (p: string, o: { recursive: boolean }) => Promise<string | undefined>;
  private readonly readdirFn: (p: string) => Promise<string[]>;
  private readonly unlinkFn: (p: string) => Promise<void>;

  /** In-memory index: event ID → index. */
  private eventIndex = new Map<string, number>();
  /** Next event index to write. */
  private nextEventIndex = 0;
  /** Current base checkpoint (loaded or created). */
  private currentCheckpoint: Checkpoint | null = null;
  /** Current metadata. */
  private currentMetadata: CheckpointMetadata | null = null;
  /** Pending writes since last base state. */
  private pendingWrites: PendingWrite[] = [];
  /** Replay/workspace envelope persisted with the current base state. */
  private currentRuntimeEnvelope: CheckpointRuntimeEnvelope = {};

  constructor(
    projectRoot: string,
    sessionId: string,
    options: EventSourcedCheckpointerOptions = {},
  ) {
    this.sessionId = sessionId;
    this.baseDir = options.baseDir ?? join(projectRoot, ".danteforge", "checkpoints");
    this.maxEvents = options.maxEventsBeforeCompaction ?? DEFAULT_MAX_EVENTS;
    this.writeFileFn = options.writeFileFn ?? ((p, d) => writeFile(p, d, "utf-8"));
    this.readFileFn = options.readFileFn ?? ((p) => readFile(p, "utf-8"));
    this.mkdirFn = options.mkdirFn ?? mkdir;
    this.readdirFn = options.readdirFn ?? ((p) => readdir(p).then((e) => e.map(String)));
    this.unlinkFn = options.unlinkFn ?? unlink;
  }

  // --------------------------------------------------------------------------
  // Public API — LangGraph Checkpointer interface
  // --------------------------------------------------------------------------

  /**
   * Creates a new checkpoint (base state snapshot).
   * Writes base_state.json and appends a checkpoint event to the log.
   * Returns the checkpoint ID.
   */
  async put(
    channelValues: Record<string, unknown>,
    metadata: CheckpointMetadata,
    channelVersions?: Record<string, number>,
    runtimeEnvelope: Omit<CheckpointRuntimeEnvelope, "replaySummary"> = {},
  ): Promise<string> {
    const id = randomUUID().slice(0, 12);
    const parentId = this.currentCheckpoint?.id;

    const checkpoint: Checkpoint = {
      v: CHECKPOINT_FORMAT_VERSION,
      id,
      ts: new Date().toISOString(),
      step: metadata.step,
      channelValues,
      channelVersions: channelVersions ?? this.bumpVersions(channelValues),
    };

    const fullMetadata: CheckpointMetadata = {
      ...metadata,
      parentId,
    };

    const replaySummary = this.buildReplaySummary(
      checkpoint,
      this.pendingWrites,
      this.nextEventIndex + 1,
    );

    this.currentCheckpoint = checkpoint;
    this.currentMetadata = fullMetadata;
    this.currentRuntimeEnvelope = {
      ...runtimeEnvelope,
      replaySummary,
    };

    // Write base state
    await this.writeBaseState(checkpoint, fullMetadata, this.currentRuntimeEnvelope);

    // Append checkpoint event to log
    await this.appendEvent({
      kind: "checkpoint",
      source: "system",
      data: { checkpointId: id, step: metadata.step },
    });

    return id;
  }

  /**
   * Stores an incremental write (LangGraph putWrites equivalent).
   * Appended as an event — never rewrites base_state.json.
   */
  async putWrite(write: PendingWrite): Promise<void> {
    // Skip if identical write already exists for this taskId + channel
    if (this.pendingWrites.some((w) => w.taskId === write.taskId && w.channel === write.channel)) {
      return;
    }

    this.pendingWrites.push(write);

    await this.appendEvent({
      kind: "write",
      source: "agent",
      data: write,
    });

    await this.refreshRuntimeEnvelope();

    // Auto-compaction check
    if (this.nextEventIndex >= this.maxEvents) {
      await this.compact();
    }
  }

  /**
   * Wave 2 closure: Stores an apply receipt for event sourcing.
   * Tracks actual apply state changes rather than just steps.
   */
  async putApplyReceipt(receipt: ApplyReceipt, metadata: ApplyReceiptMetadata): Promise<void> {
    // Deduplication: skip if a receipt for this stepId already exists
    // Prevent duplicate receipts for the same step
    if (
      this.pendingWrites.some(
        (w) => w.channel === "apply_receipt" && (w.value as ApplyReceipt).stepId === receipt.stepId,
      )
    ) {
      return;
    }

    const applyWrite: PendingWrite = {
      taskId: receipt.stepId,
      channel: "apply_receipt",
      value: receipt,
      timestamp: receipt.appliedAt,
    };

    this.pendingWrites.push(applyWrite);

    await this.appendEvent({
      kind: "action",
      source: "system",
      data: {
        receipt,
        metadata,
      },
    });

    await this.refreshRuntimeEnvelope();
  }

  /**
   * Loads the full checkpoint state: base_state + replay events.
   * Returns null if no session exists on disk.
   */
  async getTuple(): Promise<CheckpointTuple | null> {
    // If already loaded in memory, return current state
    if (this.currentCheckpoint && this.currentMetadata) {
      return {
        checkpoint: { ...this.currentCheckpoint },
        metadata: { ...this.currentMetadata },
        pendingWrites: [...this.pendingWrites],
        parentId: this.currentMetadata.parentId,
        replaySummary: this.currentRuntimeEnvelope.replaySummary,
        workspaceContext: this.currentRuntimeEnvelope.workspaceContext,
      };
    }

    // Load from disk
    return this.loadFromDisk();
  }

  /**
   * Async generator that lists checkpoints in reverse chronological order.
   * Yields CheckpointTuples matching the given options.
   */
  async *list(options: CheckpointListOptions = {}): AsyncGenerator<CheckpointTuple> {
    // Load the current checkpoint
    const tuple = await this.getTuple();
    if (!tuple) return;

    // Filter
    if (options.filter) {
      const f = options.filter;
      if (f.source && tuple.metadata.source !== f.source) return;
      if (f.step !== undefined && tuple.metadata.step !== f.step) return;
    }

    if (options.before && tuple.checkpoint.id >= options.before) return;

    yield tuple;
  }

  /** Returns the current session ID. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Returns the current checkpoint, or null. */
  getCurrentCheckpoint(): Checkpoint | null {
    return this.currentCheckpoint ? { ...this.currentCheckpoint } : null;
  }

  /** Returns the current event count since last base state. */
  getEventCount(): number {
    return this.nextEventIndex;
  }

  /** Returns all pending writes. */
  getPendingWrites(): PendingWrite[] {
    return [...this.pendingWrites];
  }

  // --------------------------------------------------------------------------
  // Resume — OpenHands-style load base + replay events
  // --------------------------------------------------------------------------

  /**
   * Resumes a session from disk.
   * Loads base_state.json, then replays all events from the event log directory.
   * Returns the number of events replayed, or 0 if no session found.
   */
  async resume(): Promise<number> {
    const tuple = await this.loadFromDisk();
    if (!tuple) return 0;

    this.currentCheckpoint = tuple.checkpoint;
    this.currentMetadata = tuple.metadata;
    this.pendingWrites = tuple.pendingWrites;
    this.currentRuntimeEnvelope = {
      replaySummary: tuple.replaySummary,
      workspaceContext: tuple.workspaceContext,
    };

    return this.nextEventIndex;
  }

  // --------------------------------------------------------------------------
  // Compaction — consolidate events into new base state
  // --------------------------------------------------------------------------

  /**
   * Compacts the event log into a new base state.
   * Merges all pending writes into channelValues, clears the event log,
   * and writes a fresh base_state.json.
   */
  async compact(): Promise<void> {
    if (!this.currentCheckpoint) return;

    // Merge pending writes into channel values
    for (const write of this.pendingWrites) {
      this.currentCheckpoint.channelValues[write.channel] = write.value;
      this.currentCheckpoint.channelVersions[write.channel] =
        (this.currentCheckpoint.channelVersions[write.channel] ?? 0) + 1;
    }

    this.currentCheckpoint.ts = new Date().toISOString();
    this.pendingWrites = [];

    // Write new base state
    this.currentRuntimeEnvelope = {
      ...this.currentRuntimeEnvelope,
      replaySummary: this.buildReplaySummary(this.currentCheckpoint, [], 0),
    };
    await this.writeBaseState(
      this.currentCheckpoint,
      this.currentMetadata!,
      this.currentRuntimeEnvelope,
    );

    // Clear event log
    await this.clearEventLog();
    this.nextEventIndex = 0;
    this.eventIndex.clear();
  }

  // --------------------------------------------------------------------------
  // Private — File I/O
  // --------------------------------------------------------------------------

  private sessionDir(): string {
    return join(this.baseDir, this.sessionId);
  }

  private eventsDir(): string {
    return join(this.sessionDir(), EVENTS_DIR);
  }

  private baseStatePath(): string {
    return join(this.sessionDir(), BASE_STATE_FILE);
  }

  private eventFilePath(index: number, eventId: string): string {
    const paddedIndex = String(index).padStart(5, "0");
    return join(this.eventsDir(), `event-${paddedIndex}-${eventId}.json`);
  }

  private async ensureDirs(): Promise<void> {
    await this.mkdirFn(this.eventsDir(), { recursive: true });
  }

  private async writeBaseState(
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    runtimeEnvelope: CheckpointRuntimeEnvelope = {},
  ): Promise<void> {
    await this.ensureDirs();
    const normalizedEnvelope = normalizeRuntimeEnvelope(runtimeEnvelope);
    const data = JSON.stringify({ checkpoint, metadata, ...normalizedEnvelope }, null, 2);
    await this.writeFileFn(this.baseStatePath(), data);
  }

  private async appendEvent(
    partial: Omit<CheckpointEvent, "id" | "index" | "timestamp">,
  ): Promise<CheckpointEvent> {
    await this.ensureDirs();

    const eventId = randomUUID().slice(0, 8);
    const event: CheckpointEvent = {
      id: eventId,
      index: this.nextEventIndex,
      timestamp: new Date().toISOString(),
      ...partial,
    };

    const filePath = this.eventFilePath(this.nextEventIndex, eventId);
    await this.writeFileFn(filePath, JSON.stringify(event, null, 2));

    this.eventIndex.set(eventId, this.nextEventIndex);
    this.nextEventIndex++;

    return event;
  }

  private async loadFromDisk(): Promise<CheckpointTuple | null> {
    try {
      const raw = await this.readFileFn(this.baseStatePath());
      const { checkpoint, metadata, replaySummary, workspaceContext } = JSON.parse(raw) as {
        checkpoint: Checkpoint;
        metadata: CheckpointMetadata;
        replaySummary?: unknown;
        workspaceContext?: unknown;
      };

      // Replay events from the event log
      const writes: PendingWrite[] = [];
      const events = await this.scanEventLog();

      for (const event of events) {
        if (event.kind === "write") {
          writes.push(event.data as PendingWrite);
        }
      }

      this.nextEventIndex = events.length;
      this.eventIndex.clear();
      for (const event of events) {
        this.eventIndex.set(event.id, event.index);
      }

      const normalizedReplaySummary = parseReplaySummary(replaySummary);
      const normalizedWorkspaceContext = parseWorkspaceContext(workspaceContext);
      const nextReplaySummary =
        normalizedReplaySummary ??
        this.buildReplaySummary(
          checkpoint,
          writes,
          events.length,
          events[events.length - 1]?.index,
        );
      this.currentRuntimeEnvelope = {
        replaySummary: nextReplaySummary,
        workspaceContext: normalizedWorkspaceContext,
      };

      return {
        checkpoint,
        metadata,
        pendingWrites: writes,
        parentId: metadata.parentId,
        replaySummary: nextReplaySummary,
        workspaceContext: normalizedWorkspaceContext,
      };
    } catch {
      return null;
    }
  }

  private async scanEventLog(): Promise<CheckpointEvent[]> {
    try {
      const files = await this.readdirFn(this.eventsDir());
      const eventFiles = files.filter((f) => f.startsWith("event-") && f.endsWith(".json")).sort(); // Lexicographic sort ensures order by padded index

      const events: CheckpointEvent[] = [];
      for (const file of eventFiles) {
        try {
          const raw = await this.readFileFn(join(this.eventsDir(), file));
          events.push(JSON.parse(raw) as CheckpointEvent);
        } catch {
          // Skip unreadable events
        }
      }

      return events;
    } catch {
      return [];
    }
  }

  private async clearEventLog(): Promise<void> {
    try {
      const files = await this.readdirFn(this.eventsDir());
      for (const file of files) {
        if (file.startsWith("event-") && file.endsWith(".json")) {
          await this.unlinkFn(join(this.eventsDir(), file));
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  private bumpVersions(channelValues: Record<string, unknown>): Record<string, number> {
    const versions: Record<string, number> = {};
    for (const key of Object.keys(channelValues)) {
      versions[key] = (this.currentCheckpoint?.channelVersions[key] ?? 0) + 1;
    }
    return versions;
  }

  private buildReplaySummary(
    checkpoint: Checkpoint,
    pendingWrites: PendingWrite[],
    eventCount: number,
    lastEventIndex = eventCount > 0 ? eventCount - 1 : undefined,
  ): CheckpointReplaySummary {
    const digest = hashCheckpointContent(
      JSON.stringify({
        checkpointId: checkpoint.id,
        step: checkpoint.step,
        channelValues: checkpoint.channelValues,
        channelVersions: checkpoint.channelVersions,
        pendingWrites,
        eventCount,
      }),
    );

    return {
      eventCount,
      pendingWriteCount: pendingWrites.length,
      digest,
      ...(typeof lastEventIndex === "number" ? { lastEventIndex } : {}),
    };
  }

  private async refreshRuntimeEnvelope(): Promise<void> {
    if (!this.currentCheckpoint || !this.currentMetadata) {
      return;
    }

    this.currentRuntimeEnvelope = {
      ...this.currentRuntimeEnvelope,
      replaySummary: this.buildReplaySummary(
        this.currentCheckpoint,
        this.pendingWrites,
        this.nextEventIndex,
      ),
    };
    await this.writeBaseState(
      this.currentCheckpoint,
      this.currentMetadata,
      this.currentRuntimeEnvelope,
    );
  }
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

/** SHA-256 hash of a string, returned as 16-char hex prefix. */
export function hashCheckpointContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 16);
}

function normalizeRuntimeEnvelope(
  runtimeEnvelope: CheckpointRuntimeEnvelope,
): CheckpointRuntimeEnvelope {
  return {
    replaySummary: parseReplaySummary(runtimeEnvelope.replaySummary),
    workspaceContext: parseWorkspaceContext(runtimeEnvelope.workspaceContext),
  };
}

function parseReplaySummary(value: unknown): CheckpointReplaySummary | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  const parsed = CheckpointReplaySummarySchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function parseWorkspaceContext(value: unknown): CheckpointWorkspaceContext | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }
  const parsed = CheckpointWorkspaceContextSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
