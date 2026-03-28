// ============================================================================
// @dantecode/workspace — LocalWorkspace Implementation
// ============================================================================

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { BaseWorkspace } from "./workspace.js";
import type {
  WorkspaceConfig,
  WorkspaceSnapshot,
  ReadFileOptions,
  WriteFileOptions,
  ListFilesOptions,
  ExecOptions,
  ExecResult,
  FileWatchCallback,
  PathInfo,
  FileChangeType,
} from "./types.js";

const execAsync = promisify(exec);

/**
 * LocalWorkspace: Executes operations on the local filesystem.
 *
 * Features:
 * - Direct filesystem access (fast, no overhead)
 * - Native command execution via child_process
 * - fs.watch for file change monitoring
 * - Snapshot support via file archiving
 *
 * Use when:
 * - Working in a trusted local environment
 * - Low latency is critical
 * - No isolation requirements
 */
export class LocalWorkspace extends BaseWorkspace {
  private _env: Record<string, string>;
  private _cwd: string;
  private _watchers: Map<string, fsSync.FSWatcher> = new Map();

  constructor(config: WorkspaceConfig) {
    super(config.id, "local", config);
    // Filter out undefined values from process.env
    const filteredEnv = Object.fromEntries(
      Object.entries(process.env).filter(([_, v]) => v !== undefined),
    ) as Record<string, string>;
    this._env = { ...filteredEnv, ...config.env };
    this._cwd = config.workDir || config.basePath;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._status === "ready") {
      return; // Idempotent
    }

    try {
      // Ensure base path exists
      await fs.mkdir(this.config.basePath, { recursive: true });

      // Ensure work dir exists if specified
      if (this.config.workDir) {
        await fs.mkdir(this.config.workDir, { recursive: true });
      }

      this._setStatus("ready");
      this._emit("ready");
    } catch (error) {
      this._setStatus("error");
      this._emit("error", undefined, String(error));
      throw new Error(`Failed to initialize LocalWorkspace: ${error}`);
    }
  }

  async suspend(): Promise<WorkspaceSnapshot> {
    if (this._status !== "ready") {
      throw new Error("Cannot suspend workspace that is not ready");
    }

    try {
      // Capture all files in workspace
      const files: WorkspaceSnapshot["files"] = [];
      const captureDir = async (dir: string) => {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(this.config.basePath, fullPath);

          if (entry.isDirectory()) {
            await captureDir(fullPath);
          } else if (entry.isFile()) {
            const content = await fs.readFile(fullPath, "utf-8");
            const stats = await fs.stat(fullPath);
            files.push({
              path: relativePath,
              content,
              mode: stats.mode,
            });
          }
        }
      };

      await captureDir(this.config.basePath);

      // Create snapshot
      const snapshot: WorkspaceSnapshot = {
        id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        workspaceId: this.id,
        timestamp: Date.now(),
        type: this.type,
        status: this._status,
        files,
        env: { ...this._env },
        cwd: this._cwd,
        metadata: this.config.metadata || {},
        checksum: "", // Will compute after
      };

      // Compute checksum
      snapshot.checksum = this._computeSnapshotChecksum(snapshot);

      // Update snapshot status before returning
      snapshot.status = "suspended";
      this._setStatus("suspended");
      this._emit("suspended", { snapshotId: snapshot.id });

      return snapshot;
    } catch (error) {
      this._emit("error", undefined, String(error));
      throw new Error(`Failed to suspend workspace: ${error}`);
    }
  }

  async resume(snapshot: WorkspaceSnapshot): Promise<void> {
    if (snapshot.workspaceId !== this.id) {
      throw new Error("Snapshot workspace ID does not match");
    }

    if (snapshot.type !== this.type) {
      throw new Error("Snapshot type does not match workspace type");
    }

    // Verify checksum
    const expectedChecksum = this._computeSnapshotChecksum(snapshot);
    if (snapshot.checksum !== expectedChecksum) {
      throw new Error("Snapshot checksum mismatch - data may be corrupted");
    }

    try {
      // Restore files
      for (const file of snapshot.files) {
        const fullPath = path.join(this.config.basePath, file.path);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, file.content, {
          mode: file.mode,
          encoding: "utf-8",
        });
      }

      // Restore environment
      this._env = { ...snapshot.env };

      // Restore cwd
      this._cwd = snapshot.cwd;

      this._setStatus("ready");
      this._emit("resumed", { snapshotId: snapshot.id });
    } catch (error) {
      this._emit("error", undefined, String(error));
      throw new Error(`Failed to resume workspace: ${error}`);
    }
  }

  async destroy(): Promise<void> {
    try {
      // Stop all watchers
      for (const watcher of this._watchers.values()) {
        watcher.close();
      }
      this._watchers.clear();

      // Note: We don't delete the basePath by default for safety
      // Users should explicitly clean up if needed

      this._setStatus("destroyed");
      this._emit("destroyed");
    } catch (error) {
      this._emit("error", undefined, String(error));
      throw new Error(`Failed to destroy workspace: ${error}`);
    }
  }

  // ─── File Operations ──────────────────────────────────────────────────────────

  async readFile(filePath: string, options?: ReadFileOptions): Promise<string> {
    const resolvedPath = this._resolvePath(filePath);
    try {
      const content = await fs.readFile(resolvedPath, {
        encoding: options?.encoding || "utf-8",
        flag: options?.flag,
      });
      this._incrementStat("filesRead");
      return content;
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`);
    }
  }

  async writeFile(filePath: string, content: string, options?: WriteFileOptions): Promise<void> {
    const resolvedPath = this._resolvePath(filePath);

    try {
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });

      await fs.writeFile(resolvedPath, content, {
        encoding: options?.encoding || "utf-8",
        mode: options?.mode,
        flag: options?.flag,
      });

      this._incrementStat("filesWritten");
      this._emit("file:changed", { path: filePath });
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error}`);
    }
  }

  async listFiles(pattern: string, options?: ListFilesOptions): Promise<string[]> {
    const {
      recursive = true,
      includeHidden = false,
      maxDepth = Infinity,
      ignorePatterns = [],
    } = options || {};

    const results: string[] = [];
    const regex = this._globToRegex(pattern);

    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > maxDepth) return;

      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.relative(this.config.basePath, fullPath);
          // Normalize path separators for regex matching
          const normalizedRelPath = relativePath.replace(/\\/g, "/");

          // Skip hidden files unless requested
          if (!includeHidden && entry.name.startsWith(".")) {
            continue;
          }

          // Check ignore patterns
          if (ignorePatterns.some((p) => relativePath.includes(p))) {
            continue;
          }

          if (entry.isDirectory() && recursive) {
            await walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            if (regex.test(normalizedRelPath)) {
              results.push(relativePath);
            }
          }
        }
      } catch (error) {
        // Ignore directories that can't be read
      }
    };

    await walk(this.config.basePath, 0);
    return results;
  }

  async exists(filePath: string): Promise<boolean> {
    const resolvedPath = this._resolvePath(filePath);
    try {
      await fs.access(resolvedPath);
      return true;
    } catch {
      return false;
    }
  }

  async pathInfo(filePath: string): Promise<PathInfo> {
    const resolvedPath = this._resolvePath(filePath);
    const relativePath = path.relative(this.config.basePath, resolvedPath);

    try {
      const stats = await fs.stat(resolvedPath);

      return {
        absolute: resolvedPath,
        relative: relativePath,
        exists: true,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        size: stats.size,
        mode: stats.mode,
        mtime: stats.mtime,
      };
    } catch {
      return {
        absolute: resolvedPath,
        relative: relativePath,
        exists: false,
        isDirectory: false,
        isFile: false,
      };
    }
  }

  async delete(filePath: string): Promise<void> {
    const resolvedPath = this._resolvePath(filePath);
    try {
      const stats = await fs.stat(resolvedPath);
      if (stats.isDirectory()) {
        await fs.rm(resolvedPath, { recursive: true, force: true });
      } else {
        await fs.unlink(resolvedPath);
      }
      this._emit("file:deleted", { path: filePath });
    } catch (error) {
      throw new Error(`Failed to delete ${filePath}: ${error}`);
    }
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
    const resolvedPath = this._resolvePath(dirPath);
    await fs.mkdir(resolvedPath, options);
  }

  async copy(src: string, dest: string): Promise<void> {
    const srcPath = this._resolvePath(src);
    const destPath = this._resolvePath(dest);

    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.copyFile(srcPath, destPath);
  }

  async move(src: string, dest: string): Promise<void> {
    const srcPath = this._resolvePath(src);
    const destPath = this._resolvePath(dest);

    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.rename(srcPath, destPath);
  }

  async watch(watchPath: string, callback: FileWatchCallback): Promise<() => void> {
    const resolvedPath = this._resolvePath(watchPath);

    if (this._watchers.has(resolvedPath)) {
      throw new Error(`Already watching path: ${watchPath}`);
    }

    const watcher = fsSync.watch(resolvedPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const fullPath = path.join(resolvedPath, filename);
      const relativePath = path.relative(this.config.basePath, fullPath);

      let changeType: FileChangeType = "modified";
      if (eventType === "rename") {
        // Check if file exists to determine if created or deleted
        try {
          fsSync.accessSync(fullPath);
          changeType = "created";
        } catch {
          changeType = "deleted";
        }
      }

      callback({
        type: changeType,
        path: relativePath,
        timestamp: Date.now(),
        workspaceId: this.id,
      });
    });

    this._watchers.set(resolvedPath, watcher);

    return () => {
      watcher.close();
      this._watchers.delete(resolvedPath);
    };
  }

  // ─── Command Execution ────────────────────────────────────────────────────────

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    const startTime = Date.now();
    const cwd = options?.cwd ? this._resolvePath(options.cwd) : this._cwd;
    const env = { ...this._env, ...options?.env };

    try {
      const execOptions: any = {
        cwd,
        env,
        timeout: options?.timeout,
        encoding: options?.encoding || "utf-8",
      };

      // Handle shell option properly
      if (options?.shell !== undefined) {
        if (typeof options.shell === "string") {
          execOptions.shell = options.shell;
        } else {
          execOptions.shell = options.shell;
        }
      } else {
        execOptions.shell = true;
      }

      const { stdout, stderr } = await execAsync(command, execOptions);

      this._incrementStat("commandsExecuted");
      this._emit("command:completed", { command, exitCode: 0 });

      return {
        exitCode: 0,
        stdout: String(stdout),
        stderr: String(stderr),
        duration: Date.now() - startTime,
        timedOut: false,
      };
    } catch (error: any) {
      const isTimeout = error.killed && error.signal === "SIGTERM";

      this._emit("command:completed", {
        command,
        exitCode: error.code || 1,
        error: String(error),
      });

      return {
        exitCode: error.code || 1,
        stdout: error.stdout || "",
        stderr: error.stderr || String(error),
        duration: Date.now() - startTime,
        timedOut: isTimeout,
      };
    }
  }

  async executeBackground(
    command: string,
    options?: ExecOptions,
  ): Promise<{ pid: number; kill: () => Promise<void> }> {
    const cwd = options?.cwd ? this._resolvePath(options.cwd) : this._cwd;
    const env = { ...this._env, ...options?.env };

    const execOptions: any = { cwd, env };

    // Handle shell option properly
    if (options?.shell !== undefined) {
      execOptions.shell = options.shell;
    } else {
      execOptions.shell = true;
    }

    const childProcess = exec(command, execOptions);

    if (!childProcess.pid) {
      throw new Error("Failed to start background process");
    }

    const pid = childProcess.pid;

    return {
      pid,
      kill: async () => {
        childProcess.kill();
      },
    };
  }

  // ─── Environment ──────────────────────────────────────────────────────────────

  async getEnv(key: string): Promise<string | undefined> {
    return this._env[key];
  }

  async setEnv(key: string, value: string): Promise<void> {
    this._env[key] = value;
    this._emit("env:changed", { key, value });
  }

  async unsetEnv(key: string): Promise<void> {
    delete this._env[key];
    this._emit("env:changed", { key, value: undefined });
  }

  async getEnvAll(): Promise<Record<string, string>> {
    return { ...this._env };
  }

  async setEnvBatch(env: Record<string, string>): Promise<void> {
    Object.assign(this._env, env);
    this._emit("env:changed", { batch: true, count: Object.keys(env).length });
  }

  // ─── Working Directory ────────────────────────────────────────────────────────

  async getCwd(): Promise<string> {
    return this._cwd;
  }

  async setCwd(dirPath: string): Promise<void> {
    const resolvedPath = this._resolvePath(dirPath);
    const stats = await fs.stat(resolvedPath);

    if (!stats.isDirectory()) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    this._cwd = resolvedPath;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private _resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.resolve(this.config.basePath, filePath);
  }

  private _globToRegex(pattern: string): RegExp {
    // Simple glob to regex conversion
    // ** -> match any depth
    // * -> match any characters except path separator
    // ? -> match single character

    // Normalize path separators to forward slashes
    const normalizedPattern = pattern.replace(/\\/g, "/");

    let regexStr = normalizedPattern
      .replace(/\*\*/g, "<!DOUBLESTAR!>")
      .replace(/\*/g, "[^/]*")
      .replace(/<!DOUBLESTAR!>/g, ".*")
      .replace(/\?/g, "[^/]")
      .replace(/\./g, "\\.");

    return new RegExp(`^${regexStr}$`);
  }

  private _computeSnapshotChecksum(snapshot: WorkspaceSnapshot): string {
    // Create deterministic checksum from snapshot data
    const data = JSON.stringify({
      workspaceId: snapshot.workspaceId,
      timestamp: snapshot.timestamp,
      files: snapshot.files.map((f) => ({
        path: f.path,
        content: f.content,
      })),
      env: snapshot.env,
      cwd: snapshot.cwd,
    });

    return createHash("sha256").update(data).digest("hex");
  }
}
