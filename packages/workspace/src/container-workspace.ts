// ============================================================================
// @dantecode/workspace — ContainerWorkspace Implementation
// ============================================================================

import path from "node:path";
import { createHash } from "node:crypto";
import { BaseWorkspace } from "./workspace.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - dante-sandbox types not available during build
import { DanteSandbox, sandboxRun } from "@dantecode/dante-sandbox";
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
} from "./types.js";

/**
 * ContainerWorkspace: Executes operations in an isolated container via DanteSandbox.
 *
 * Features:
 * - Full isolation via Docker/container runtime
 * - Integrated with DanteSandbox security policies
 * - Volume mounting for file access
 * - Resource limits and controls
 *
 * Use when:
 * - Executing untrusted code
 * - Need strict resource limits
 * - Require complete environment isolation
 */
export class ContainerWorkspace extends BaseWorkspace {
  private _env: Record<string, string>;
  private _cwd: string;
  private _containerName: string;
  private _image: string;

  constructor(config: WorkspaceConfig) {
    super(config.id, "container", config);

    if (!config.image) {
      throw new Error("Container workspace requires 'image' in config");
    }

    this._env = { ...config.env };
    this._cwd = config.workDir || "/workspace";
    this._containerName = config.containerName || `dantecode-ws-${config.id}`;
    this._image = config.image;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._status === "ready") {
      return; // Idempotent
    }

    try {
      // Check if DanteSandbox is available
      const engine = DanteSandbox.getEngine();
      if (!engine) {
        throw new Error("DanteSandbox not initialized");
      }

      // Verify Docker strategy is available
      const testResult = await sandboxRun("echo 'test'", {
        strategy: "docker",
        cwd: this._cwd,
        env: this._env,
      });

      if (testResult.exitCode !== 0) {
        throw new Error("Docker strategy not available");
      }

      this._setStatus("ready");
      this._emit("ready");
    } catch (error) {
      this._setStatus("error");
      this._emit("error", undefined, String(error));
      throw new Error(`Failed to initialize ContainerWorkspace: ${error}`);
    }
  }

  async suspend(): Promise<WorkspaceSnapshot> {
    if (this._status !== "ready") {
      throw new Error("Cannot suspend workspace that is not ready");
    }

    try {
      // List all files in workspace
      const listResult = await this._executeContainer(`find ${this._cwd} -type f -o -type d`, {});

      if (listResult.exitCode !== 0) {
        throw new Error(`Failed to list files: ${listResult.stderr}`);
      }

      const paths = listResult.stdout.trim().split("\n").filter(Boolean);
      const files: WorkspaceSnapshot["files"] = [];

      // Read each file
      for (const filePath of paths) {
        const isDir = await this._isDirectory(filePath);
        if (isDir) continue;

        const content = await this.readFile(filePath);
        const info = await this.pathInfo(filePath);

        files.push({
          path: path.relative(this._cwd, filePath),
          content,
          mode: info.mode,
        });
      }

      const snapshot: WorkspaceSnapshot = {
        id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        workspaceId: this.id,
        timestamp: Date.now(),
        type: this.type,
        status: this._status,
        files,
        env: { ...this._env },
        cwd: this._cwd,
        metadata: {
          ...this.config.metadata,
          containerName: this._containerName,
          image: this._image,
        },
        checksum: "",
      };

      snapshot.checksum = this._computeSnapshotChecksum(snapshot);

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

    // Verify checksum
    const expectedChecksum = this._computeSnapshotChecksum(snapshot);
    if (snapshot.checksum !== expectedChecksum) {
      throw new Error("Snapshot checksum mismatch - data may be corrupted");
    }

    try {
      // Ensure workspace is initialized
      if (this._status !== "ready") {
        await this.initialize();
      }

      // Restore files
      for (const file of snapshot.files) {
        const fullPath = path.join(this._cwd, file.path);
        await this.writeFile(fullPath, file.content, { mode: file.mode });
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
      // Container cleanup is handled by DanteSandbox
      // We just mark ourselves as destroyed
      this._setStatus("destroyed");
      this._emit("destroyed");
    } catch (error) {
      this._emit("error", undefined, String(error));
      throw new Error(`Failed to destroy workspace: ${error}`);
    }
  }

  // ─── File Operations ──────────────────────────────────────────────────────────

  async readFile(filePath: string, _options?: ReadFileOptions): Promise<string> {
    const resolvedPath = this._resolvePath(filePath);

    try {
      const result = await this._executeContainer(`cat "${resolvedPath}"`, {} as ExecOptions);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Failed to read file");
      }

      this._incrementStat("filesRead");
      return result.stdout;
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error}`);
    }
  }

  async writeFile(filePath: string, content: string, options?: WriteFileOptions): Promise<void> {
    const resolvedPath = this._resolvePath(filePath);

    try {
      // Create parent directory
      const dir = path.dirname(resolvedPath);
      await this._executeContainer(`mkdir -p "${dir}"`, {} as ExecOptions);

      // Write file using heredoc to handle special characters
      const writeCmd = `cat > "${resolvedPath}" << 'EOF_DANTECODE'
${content}
EOF_DANTECODE`;

      const result = await this._executeContainer(writeCmd, {} as ExecOptions);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Failed to write file");
      }

      // Set mode if specified
      if (options?.mode) {
        await this._executeContainer(
          `chmod ${options.mode.toString(8)} "${resolvedPath}"`,
          {} as ExecOptions,
        );
      }

      this._incrementStat("filesWritten");
      this._emit("file:changed", { path: filePath });
    } catch (error) {
      throw new Error(`Failed to write file ${filePath}: ${error}`);
    }
  }

  async listFiles(pattern: string, _options?: ListFilesOptions): Promise<string[]> {
    const { includeHidden = false, maxDepth = Infinity } = _options || {};

    try {
      let findCmd = `find ${this._cwd}`;

      if (maxDepth !== Infinity) {
        findCmd += ` -maxdepth ${maxDepth}`;
      }

      if (!includeHidden) {
        findCmd += ` -not -path '*/\\.*'`;
      }

      findCmd += ` -type f`;

      const result = await this._executeContainer(findCmd, {} as ExecOptions);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Failed to list files");
      }

      const files = result.stdout.trim().split("\n").filter(Boolean);
      const regex = this._globToRegex(pattern);

      return files.map((f) => path.relative(this._cwd, f)).filter((f) => regex.test(f));
    } catch (error) {
      throw new Error(`Failed to list files: ${error}`);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const resolvedPath = this._resolvePath(filePath);

    try {
      const result = await this._executeContainer(`test -e "${resolvedPath}"`, {});
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async pathInfo(filePath: string): Promise<PathInfo> {
    const resolvedPath = this._resolvePath(filePath);
    const relativePath = path.relative(this._cwd, resolvedPath);

    try {
      const statCmd = `stat -c '%s %f %Y' "${resolvedPath}" 2>/dev/null || echo 'NOENT'`;
      const result = await this._executeContainer(statCmd, {});

      if (result.stdout.trim() === "NOENT") {
        return {
          absolute: resolvedPath,
          relative: relativePath,
          exists: false,
          isDirectory: false,
          isFile: false,
        };
      }

      const [size, modeHex, mtimeUnix] = result.stdout.trim().split(" ");
      const mode = parseInt(modeHex || "0", 16);

      // Check if file or directory
      const typeResult = await this._executeContainer(
        `test -d "${resolvedPath}"`,
        {} as ExecOptions,
      );
      const isDirectory = typeResult.exitCode === 0;

      return {
        absolute: resolvedPath,
        relative: relativePath,
        exists: true,
        isDirectory,
        isFile: !isDirectory,
        size: parseInt(size || "0", 10),
        mode,
        mtime: new Date(parseInt(mtimeUnix || "0", 10) * 1000),
      };
    } catch (error) {
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
      const result = await this._executeContainer(`rm -rf "${resolvedPath}"`, {} as ExecOptions);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Failed to delete");
      }

      this._emit("file:deleted", { path: filePath });
    } catch (error) {
      throw new Error(`Failed to delete ${filePath}: ${error}`);
    }
  }

  async mkdir(dirPath: string, _options?: { recursive?: boolean; mode?: number }): Promise<void> {
    const resolvedPath = this._resolvePath(dirPath);
    const recursive = _options?.recursive !== false;

    const mkdirCmd = recursive ? `mkdir -p "${resolvedPath}"` : `mkdir "${resolvedPath}"`;
    const result = await this._executeContainer(mkdirCmd, {} as ExecOptions);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to create directory");
    }

    if (_options?.mode) {
      await this._executeContainer(
        `chmod ${_options.mode.toString(8)} "${resolvedPath}"`,
        {} as ExecOptions,
      );
    }
  }

  async copy(src: string, dest: string): Promise<void> {
    const srcPath = this._resolvePath(src);
    const destPath = this._resolvePath(dest);

    const result = await this._executeContainer(
      `cp -r "${srcPath}" "${destPath}"`,
      {} as ExecOptions,
    );

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to copy");
    }
  }

  async move(src: string, dest: string): Promise<void> {
    const srcPath = this._resolvePath(src);
    const destPath = this._resolvePath(dest);

    const result = await this._executeContainer(`mv "${srcPath}" "${destPath}"`, {} as ExecOptions);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to move");
    }
  }

  async watch(_watchPath: string, _callback: FileWatchCallback): Promise<() => void> {
    // Container file watching requires a long-running process
    // For now, throw an error indicating this is not yet supported
    // A full implementation would use inotify-tools or similar in the container
    throw new Error("File watching is not yet supported in ContainerWorkspace");
  }

  // ─── Command Execution ────────────────────────────────────────────────────────

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    const startTime = Date.now();

    try {
      const result = await this._executeContainer(command, (options || {}) as ExecOptions);

      this._incrementStat("commandsExecuted");
      this._emit("command:completed", { command, exitCode: result.exitCode });

      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      this._emit("command:completed", {
        command,
        exitCode: 1,
        error: String(error),
      });

      throw error;
    }
  }

  async executeBackground(
    command: string,
    options?: ExecOptions,
  ): Promise<{ pid: number; kill: () => Promise<void> }> {
    // Background execution in containers requires process tracking
    // This is a simplified implementation - production would need more sophisticated handling
    const bgCommand = `(${command}) &`;
    const result = await this._executeContainer(bgCommand, (options || {}) as ExecOptions);

    // Extract PID from echo $! output
    const pidMatch = result.stdout.match(/\d+/);
    const pid = pidMatch ? parseInt(pidMatch[0], 10) : -1;

    return {
      pid,
      kill: async () => {
        if (pid > 0) {
          await this._executeContainer(`kill ${pid}`, {});
        }
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

    // Verify directory exists
    const isDir = await this._isDirectory(resolvedPath);
    if (!isDir) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    this._cwd = resolvedPath;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private async _executeContainer(command: string, options: ExecOptions): Promise<ExecResult> {
    const result = await sandboxRun(command, {
      strategy: "docker",
      cwd: options.cwd || this._cwd,
      env: { ...this._env, ...(options.env || {}) },
      timeout: options.timeout,
      taskType: "workspace",
      sessionId: this.id,
    });

    return {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration: result.duration || 0,
      timedOut: result.timedOut || false,
    };
  }

  private _resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.posix.join(this._cwd, filePath);
  }

  private async _isDirectory(dirPath: string): Promise<boolean> {
    try {
      const result = await this._executeContainer(`test -d "${dirPath}"`, {});
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  private _globToRegex(pattern: string): RegExp {
    let regexStr = pattern
      .replace(/\*\*/g, "<!DOUBLESTAR!>")
      .replace(/\*/g, "[^/]*")
      .replace(/<!DOUBLESTAR!>/g, ".*")
      .replace(/\?/g, ".")
      .replace(/\./g, "\\.");

    return new RegExp(`^${regexStr}$`);
  }

  private _computeSnapshotChecksum(snapshot: WorkspaceSnapshot): string {
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
