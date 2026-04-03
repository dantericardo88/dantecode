// ============================================================================
// @dantecode/core — Autoforge Session Checkpoint
// Periodic state serialization for /autoforge and /party long-running sessions.
// Persists worktree state, lessons delta, current step, and PDSE scores
// every CHECKPOINT_INTERVAL_MS (default 15 minutes).
// ============================================================================

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Serializable snapshot of an autoforge/party session. */
export interface AutoforgeSessionSnapshot {
  /** Unique checkpoint ID. */
  id: string;
  /** ISO-8601 timestamp when the checkpoint was created. */
  createdAt: string;
  /** Human-readable label. */
  label: string;
  /** The command that initiated the session (e.g. "/autoforge --self-improve"). */
  triggerCommand: string;
  /** Current iteration/step number within the session. */
  currentStep: number;
  /** Total elapsed milliseconds since session start. */
  elapsedMs: number;
  /** PDSE scores captured at this checkpoint. */
  pdseScores: PdseCheckpointEntry[];
  /** Worktree branches active during party mode (empty for autoforge). */
  worktreeBranches: string[];
  /** Delta of lessons learned since last checkpoint. */
  lessonsDelta: string[];
  /** Hash of the target file content at this checkpoint. */
  targetFileHash?: string;
  /** Path to the target file. */
  targetFilePath?: string;
  /** Session metadata (model config, flags, etc.). */
  metadata: Record<string, unknown>;
}

/** PDSE score entry within a checkpoint. */
export interface PdseCheckpointEntry {
  filePath: string;
  overall: number;
  passedGate: boolean;
  iteration: number;
}

/** Persisted checkpoint file format. */
export interface AutoforgeCheckpointFile {
  version: 2;
  sessionId: string;
  startedAt: string;
  checkpoints: AutoforgeSessionSnapshot[];
}

/** Options for creating a new checkpoint. */
export interface CreateAutoforgeCheckpointOptions {
  label?: string;
  triggerCommand: string;
  currentStep: number;
  elapsedMs: number;
  pdseScores?: PdseCheckpointEntry[];
  worktreeBranches?: string[];
  lessonsDelta?: string[];
  targetFilePath?: string;
  targetFileContent?: string;
  metadata?: Record<string, unknown>;
}

/** Options for the AutoforgeCheckpointManager constructor. */
export interface AutoforgeCheckpointManagerOptions {
  /** Directory to store checkpoint files. Defaults to `.dantecode/autoforge-checkpoints`. */
  checkpointDir?: string;
  /** Maximum number of checkpoints to keep per session. Defaults to 50. */
  maxCheckpoints?: number;
  /** Interval in milliseconds between periodic checkpoints. Defaults to 900_000 (15 min). */
  intervalMs?: number;
  /** Injectable file I/O for testing. */
  writeFileFn?: (path: string, data: string) => Promise<void>;
  readFileFn?: (path: string) => Promise<string>;
  mkdirFn?: (path: string, opts: { recursive: boolean }) => Promise<string | undefined>;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const DEFAULT_CHECKPOINT_INTERVAL_MS = 900_000; // 15 minutes
const DEFAULT_MAX_CHECKPOINTS = 50;

// ----------------------------------------------------------------------------
// AutoforgeCheckpointManager
// ----------------------------------------------------------------------------

/**
 * Manages checkpoint serialization for long-running /autoforge and /party
 * sessions. Supports:
 * - Periodic automatic checkpointing via `startPeriodicCheckpoints()`
 * - Manual checkpoint creation via `createCheckpoint()`
 * - Resume from last checkpoint via `loadSession()` + `getLatestCheckpoint()`
 * - Before/after hash auditing via `verifyFileIntegrity()`
 */
export class AutoforgeCheckpointManager {
  private readonly checkpointDir: string;
  private readonly maxCheckpoints: number;
  private readonly intervalMs: number;
  private readonly writeFileFn: (path: string, data: string) => Promise<void>;
  private readonly readFileFn: (path: string) => Promise<string>;
  private readonly mkdirFn: (
    path: string,
    opts: { recursive: boolean },
  ) => Promise<string | undefined>;
  private checkpoints: AutoforgeSessionSnapshot[] = [];
  private sessionId: string;
  private startedAt: string;
  private periodicTimer: ReturnType<typeof setInterval> | null = null;
  private pendingCheckpointFn: (() => CreateAutoforgeCheckpointOptions) | null = null;

  constructor(
    projectRoot: string,
    sessionId: string,
    options: AutoforgeCheckpointManagerOptions = {},
  ) {
    this.sessionId = sessionId;
    this.startedAt = new Date().toISOString();
    this.checkpointDir =
      options.checkpointDir ?? join(projectRoot, ".dantecode", "autoforge-checkpoints");
    this.maxCheckpoints = options.maxCheckpoints ?? DEFAULT_MAX_CHECKPOINTS;
    this.intervalMs = options.intervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS;
    this.writeFileFn = options.writeFileFn ?? ((p, d) => writeFile(p, d, "utf-8"));
    this.readFileFn = options.readFileFn ?? ((p) => readFile(p, "utf-8"));
    this.mkdirFn = options.mkdirFn ?? mkdir;
  }

  /** Creates a checkpoint and persists it to disk. */
  async createCheckpoint(
    options: CreateAutoforgeCheckpointOptions,
  ): Promise<AutoforgeSessionSnapshot> {
    const snapshot: AutoforgeSessionSnapshot = {
      id: randomUUID().slice(0, 8),
      createdAt: new Date().toISOString(),
      label: options.label ?? `step-${options.currentStep}`,
      triggerCommand: options.triggerCommand,
      currentStep: options.currentStep,
      elapsedMs: options.elapsedMs,
      pdseScores: options.pdseScores ?? [],
      worktreeBranches: options.worktreeBranches ?? [],
      lessonsDelta: options.lessonsDelta ?? [],
      targetFilePath: options.targetFilePath,
      targetFileHash: options.targetFileContent
        ? hashContent(options.targetFileContent)
        : undefined,
      metadata: options.metadata ?? {},
    };

    this.checkpoints.push(snapshot);

    // Trim to maxCheckpoints (keep latest)
    if (this.checkpoints.length > this.maxCheckpoints) {
      this.checkpoints = this.checkpoints.slice(-this.maxCheckpoints);
    }

    await this.persistToDisk();
    return snapshot;
  }

  /** Returns the latest checkpoint, or null if none exist. */
  getLatestCheckpoint(): AutoforgeSessionSnapshot | null {
    return this.checkpoints.length > 0 ? this.checkpoints[this.checkpoints.length - 1]! : null;
  }

  /** Returns all checkpoints for this session. */
  listCheckpoints(): AutoforgeSessionSnapshot[] {
    return [...this.checkpoints];
  }

  /** Returns the session ID. */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Loads a previously persisted session from disk.
   * Returns the number of checkpoints loaded, or 0 if none found.
   */
  async loadSession(sessionId?: string): Promise<number> {
    const id = sessionId ?? this.sessionId;
    const filePath = this.getSessionPath(id);

    try {
      const raw = await this.readFileFn(filePath);
      const data = JSON.parse(raw) as AutoforgeCheckpointFile;

      if (data.version !== 2 || !Array.isArray(data.checkpoints)) {
        return 0;
      }

      this.sessionId = data.sessionId;
      this.startedAt = data.startedAt;
      this.checkpoints = data.checkpoints;
      return this.checkpoints.length;
    } catch {
      return 0;
    }
  }

  /**
   * Verifies that a file has not been modified since the last checkpoint.
   * Returns an object with `matches` (boolean) and both hashes.
   */
  verifyFileIntegrity(
    filePath: string,
    currentContent: string,
  ): { matches: boolean; checkpointHash: string | undefined; currentHash: string } {
    const currentHash = hashContent(currentContent);

    // Find the latest checkpoint that references this file
    const relevantCheckpoint = [...this.checkpoints]
      .reverse()
      .find((cp) => cp.targetFilePath === filePath);

    return {
      matches: relevantCheckpoint?.targetFileHash === currentHash,
      checkpointHash: relevantCheckpoint?.targetFileHash,
      currentHash,
    };
  }

  /**
   * Starts periodic checkpointing. The `checkpointFn` is called every
   * `intervalMs` to produce checkpoint options, which are then persisted.
   */
  startPeriodicCheckpoints(checkpointFn: () => CreateAutoforgeCheckpointOptions): void {
    this.stopPeriodicCheckpoints();
    this.pendingCheckpointFn = checkpointFn;

    this.periodicTimer = setInterval(() => {
      if (this.pendingCheckpointFn) {
        void this.createCheckpoint(this.pendingCheckpointFn());
      }
    }, this.intervalMs);
  }

  /** Stops periodic checkpointing. */
  stopPeriodicCheckpoints(): void {
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = null;
    }
    this.pendingCheckpointFn = null;
  }

  /** Returns whether periodic checkpointing is active. */
  isPeriodicActive(): boolean {
    return this.periodicTimer !== null;
  }

  // --------------------------------------------------------------------------
  // Persistence
  // --------------------------------------------------------------------------

  private getSessionPath(sessionId: string): string {
    return join(this.checkpointDir, `${sessionId}.json`);
  }

  private async persistToDisk(): Promise<void> {
    const filePath = this.getSessionPath(this.sessionId);
    await this.mkdirFn(dirname(filePath), { recursive: true });

    const data: AutoforgeCheckpointFile = {
      version: 2,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      checkpoints: this.checkpoints,
    };

    await this.writeFileFn(filePath, JSON.stringify(data, null, 2));
  }
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

/** SHA-256 hash of a string, returned as hex. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
