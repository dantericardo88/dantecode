// ============================================================================
// @dantecode/workspace — Base Workspace Interface
// ============================================================================

import type {
  WorkspaceConfig,
  WorkspaceStatus,
  WorkspaceType,
  WorkspaceSnapshot,
  WorkspaceStats,
  WorkspaceEvent,
  ReadFileOptions,
  WriteFileOptions,
  ListFilesOptions,
  ExecOptions,
  ExecResult,
  FileWatchCallback,
  PathInfo,
} from "./types.js";

/**
 * Core Workspace interface that all implementations must satisfy.
 * Provides symmetrical API for local, remote, and container execution.
 *
 * Design principles from OpenHands:
 * - Symmetry: Same API across local/remote/container
 * - Lazy: Operations are lazy-loaded, resources allocated on-demand
 * - Observable: All operations emit events for monitoring
 * - Safe: All operations respect sandbox boundaries and permissions
 */
export interface Workspace {
  // ─── Identity ─────────────────────────────────────────────────────────────────

  readonly id: string;
  readonly type: WorkspaceType;
  readonly config: WorkspaceConfig;

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  /**
   * Initialize the workspace. Must be called before any operations.
   * Idempotent: safe to call multiple times.
   */
  initialize(): Promise<void>;

  /**
   * Get current workspace status.
   */
  getStatus(): WorkspaceStatus;

  /**
   * Suspend the workspace and capture a snapshot of its state.
   * The workspace can be resumed later from this snapshot.
   */
  suspend(): Promise<WorkspaceSnapshot>;

  /**
   * Resume the workspace from a previously captured snapshot.
   */
  resume(snapshot: WorkspaceSnapshot): Promise<void>;

  /**
   * Destroy the workspace and clean up all resources.
   * This operation is irreversible.
   */
  destroy(): Promise<void>;

  // ─── File Operations ──────────────────────────────────────────────────────────

  /**
   * Read a file from the workspace.
   * Paths are relative to workspace basePath unless absolute.
   */
  readFile(path: string, options?: ReadFileOptions): Promise<string>;

  /**
   * Write content to a file in the workspace.
   * Creates parent directories if they don't exist.
   */
  writeFile(path: string, content: string, options?: WriteFileOptions): Promise<void>;

  /**
   * List files matching a glob pattern.
   * Returns paths relative to workspace basePath.
   */
  listFiles(pattern: string, options?: ListFilesOptions): Promise<string[]>;

  /**
   * Check if a file or directory exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get detailed information about a path.
   */
  pathInfo(path: string): Promise<PathInfo>;

  /**
   * Delete a file or directory (recursive if directory).
   */
  delete(path: string): Promise<void>;

  /**
   * Create a directory (recursive by default).
   */
  mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;

  /**
   * Copy a file or directory.
   */
  copy(src: string, dest: string): Promise<void>;

  /**
   * Move/rename a file or directory.
   */
  move(src: string, dest: string): Promise<void>;

  /**
   * Watch a path for changes.
   * Returns an unwatch function to stop watching.
   */
  watch(path: string, callback: FileWatchCallback): Promise<() => void>;

  // ─── Command Execution ────────────────────────────────────────────────────────

  /**
   * Execute a command in the workspace.
   * Uses workspace-appropriate isolation (sandbox, container, SSH, etc).
   */
  execute(command: string, options?: ExecOptions): Promise<ExecResult>;

  /**
   * Execute a command in the background.
   * Returns a handle for later interaction.
   */
  executeBackground(
    command: string,
    options?: ExecOptions
  ): Promise<{ pid: number; kill: () => Promise<void> }>;

  // ─── Environment ──────────────────────────────────────────────────────────────

  /**
   * Get an environment variable value.
   */
  getEnv(key: string): Promise<string | undefined>;

  /**
   * Set an environment variable.
   * Changes persist for the workspace lifecycle.
   */
  setEnv(key: string, value: string): Promise<void>;

  /**
   * Delete an environment variable.
   */
  unsetEnv(key: string): Promise<void>;

  /**
   * Get all environment variables.
   */
  getEnvAll(): Promise<Record<string, string>>;

  /**
   * Set multiple environment variables at once.
   */
  setEnvBatch(env: Record<string, string>): Promise<void>;

  // ─── Working Directory ────────────────────────────────────────────────────────

  /**
   * Get current working directory.
   */
  getCwd(): Promise<string>;

  /**
   * Change working directory.
   */
  setCwd(path: string): Promise<void>;

  // ─── Stats & Monitoring ───────────────────────────────────────────────────────

  /**
   * Get workspace statistics and resource usage.
   */
  getStats(): Promise<WorkspaceStats>;

  /**
   * Subscribe to workspace events.
   * Returns an unsubscribe function.
   */
  on(callback: (event: WorkspaceEvent) => void): () => void;
}

/**
 * Abstract base class providing common workspace functionality.
 * Implementations should extend this and implement abstract methods.
 */
export abstract class BaseWorkspace implements Workspace {
  protected _status: WorkspaceStatus = "created";
  protected _eventListeners: Array<(event: WorkspaceEvent) => void> = [];
  protected _stats: WorkspaceStats;

  constructor(
    public readonly id: string,
    public readonly type: WorkspaceType,
    public readonly config: WorkspaceConfig
  ) {
    this._stats = this._initStats();
  }

  // ─── Abstract Methods (must be implemented) ───────────────────────────────────

  abstract initialize(): Promise<void>;
  abstract suspend(): Promise<WorkspaceSnapshot>;
  abstract resume(snapshot: WorkspaceSnapshot): Promise<void>;
  abstract destroy(): Promise<void>;

  abstract readFile(path: string, options?: ReadFileOptions): Promise<string>;
  abstract writeFile(path: string, content: string, options?: WriteFileOptions): Promise<void>;
  abstract listFiles(pattern: string, options?: ListFilesOptions): Promise<string[]>;
  abstract exists(path: string): Promise<boolean>;
  abstract pathInfo(path: string): Promise<PathInfo>;
  abstract delete(path: string): Promise<void>;
  abstract mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<void>;
  abstract copy(src: string, dest: string): Promise<void>;
  abstract move(src: string, dest: string): Promise<void>;
  abstract watch(path: string, callback: FileWatchCallback): Promise<() => void>;

  abstract execute(command: string, options?: ExecOptions): Promise<ExecResult>;
  abstract executeBackground(
    command: string,
    options?: ExecOptions
  ): Promise<{ pid: number; kill: () => Promise<void> }>;

  abstract getEnv(key: string): Promise<string | undefined>;
  abstract setEnv(key: string, value: string): Promise<void>;
  abstract unsetEnv(key: string): Promise<void>;
  abstract getEnvAll(): Promise<Record<string, string>>;
  abstract setEnvBatch(env: Record<string, string>): Promise<void>;

  abstract getCwd(): Promise<string>;
  abstract setCwd(path: string): Promise<void>;

  // ─── Concrete Implementations ─────────────────────────────────────────────────

  getStatus(): WorkspaceStatus {
    return this._status;
  }

  async getStats(): Promise<WorkspaceStats> {
    this._stats.lastAccessedAt = Date.now();
    this._stats.uptime = Date.now() - this._stats.createdAt;
    return { ...this._stats };
  }

  on(callback: (event: WorkspaceEvent) => void): () => void {
    this._eventListeners.push(callback);
    return () => {
      const index = this._eventListeners.indexOf(callback);
      if (index > -1) {
        this._eventListeners.splice(index, 1);
      }
    };
  }

  // ─── Protected Helpers ────────────────────────────────────────────────────────

  protected _emit(type: WorkspaceEvent["type"], data?: unknown, error?: string): void {
    const event: WorkspaceEvent = {
      type,
      workspaceId: this.id,
      timestamp: Date.now(),
      data,
      error,
    };

    for (const listener of this._eventListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(`Workspace event listener error:`, err);
      }
    }
  }

  protected _setStatus(status: WorkspaceStatus): void {
    const oldStatus = this._status;
    this._status = status;

    if (oldStatus !== status) {
      this._emit(status, { oldStatus, newStatus: status });
    }
  }

  protected _initStats(): WorkspaceStats {
    const now = Date.now();
    return {
      workspaceId: this.id,
      type: this.type,
      status: this._status,
      diskUsage: 0,
      fileCount: 0,
      createdAt: now,
      lastAccessedAt: now,
      uptime: 0,
      commandsExecuted: 0,
      filesRead: 0,
      filesWritten: 0,
    };
  }

  protected _incrementStat(stat: keyof Pick<WorkspaceStats, "commandsExecuted" | "filesRead" | "filesWritten">): void {
    (this._stats[stat] as number)++;
  }
}
