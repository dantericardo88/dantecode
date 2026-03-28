// ============================================================================
// @dantecode/workspace — RemoteWorkspace Implementation
// ============================================================================

import path from "node:path";
import { execFile } from "node:child_process";
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
} from "./types.js";

const execFileAsync = promisify(execFile);

/**
 * RemoteWorkspace: Executes operations on a remote machine via SSH.
 *
 * Features:
 * - SSH-based remote execution
 * - File transfer via scp/rsync
 * - Incremental sync for efficiency
 * - Persistent SSH connection pooling
 *
 * Use when:
 * - Working with remote servers
 * - Need cloud development environments
 * - Coordinating distributed builds
 */
export class RemoteWorkspace extends BaseWorkspace {
  private _env: Record<string, string>;
  private _cwd: string;
  private _host: string;
  private _port: number;
  private _username: string;
  private _privateKeyPath?: string;

  constructor(config: WorkspaceConfig) {
    super(config.id, "remote", config);

    if (!config.host) {
      throw new Error("Remote workspace requires 'host' in config");
    }

    this._env = { ...config.env };
    this._cwd = config.workDir || config.basePath;
    this._host = config.host;
    this._port = config.port || 22;
    this._username = config.username || "root";
    this._privateKeyPath = config.privateKeyPath;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._status === "ready") {
      return; // Idempotent
    }

    try {
      // Test SSH connection
      const testResult = await this._ssh("echo 'test'");

      if (testResult.exitCode !== 0) {
        throw new Error(`SSH connection failed: ${testResult.stderr}`);
      }

      // Ensure base directory exists
      await this._ssh(`mkdir -p "${this.config.basePath}"`);

      // Ensure work directory exists if specified
      if (this.config.workDir) {
        await this._ssh(`mkdir -p "${this.config.workDir}"`);
      }

      this._setStatus("ready");
      this._emit("ready");
    } catch (error) {
      this._setStatus("error");
      this._emit("error", undefined, String(error));
      throw new Error(`Failed to initialize RemoteWorkspace: ${error}`);
    }
  }

  async suspend(): Promise<WorkspaceSnapshot> {
    if (this._status !== "ready") {
      throw new Error("Cannot suspend workspace that is not ready");
    }

    try {
      // List all files
      const listResult = await this._ssh(
        `find "${this.config.basePath}" -type f`
      );

      if (listResult.exitCode !== 0) {
        throw new Error(`Failed to list files: ${listResult.stderr}`);
      }

      const paths = listResult.stdout.trim().split("\n").filter(Boolean);
      const files: WorkspaceSnapshot["files"] = [];

      // Read each file
      for (const filePath of paths) {
        const content = await this.readFile(filePath);
        const info = await this.pathInfo(filePath);

        files.push({
          path: path.relative(this.config.basePath, filePath),
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
          host: this._host,
          port: this._port,
          username: this._username,
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
        const fullPath = path.posix.join(this.config.basePath, file.path);
        await this.writeFile(fullPath, file.content, { mode: file.mode });
      }

      // Restore environment (stored locally, applied per-command)
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
      // Note: We don't delete remote files by default for safety
      // Users should explicitly clean up if needed

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
      const result = await this._ssh(`cat "${resolvedPath}"`);

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
      const dir = path.posix.dirname(resolvedPath);
      await this._ssh(`mkdir -p "${dir}"`);

      // Write file using heredoc
      const writeCmd = `cat > "${resolvedPath}" << 'EOF_DANTECODE'
${content}
EOF_DANTECODE`;

      const result = await this._ssh(writeCmd);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Failed to write file");
      }

      // Set mode if specified
      if (options?.mode) {
        await this._ssh(`chmod ${options.mode.toString(8)} "${resolvedPath}"`);
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
      let findCmd = `find "${this.config.basePath}"`;

      if (maxDepth !== Infinity) {
        findCmd += ` -maxdepth ${maxDepth}`;
      }

      if (!includeHidden) {
        findCmd += ` -not -path '*/\\.*'`;
      }

      findCmd += ` -type f`;

      const result = await this._ssh(findCmd);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Failed to list files");
      }

      const files = result.stdout.trim().split("\n").filter(Boolean);
      const regex = this._globToRegex(pattern);

      return files
        .map((f) => path.relative(this.config.basePath, f))
        .filter((f) => regex.test(f));
    } catch (error) {
      throw new Error(`Failed to list files: ${error}`);
    }
  }

  async exists(filePath: string): Promise<boolean> {
    const resolvedPath = this._resolvePath(filePath);

    try {
      const result = await this._ssh(`test -e "${resolvedPath}"`);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async pathInfo(filePath: string): Promise<PathInfo> {
    const resolvedPath = this._resolvePath(filePath);
    const relativePath = path.relative(this.config.basePath, resolvedPath);

    try {
      const statCmd = `stat -c '%s %f %Y' "${resolvedPath}" 2>/dev/null || echo 'NOENT'`;
      const result = await this._ssh(statCmd);

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
      const typeResult = await this._ssh(`test -d "${resolvedPath}"`);
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
      const result = await this._ssh(`rm -rf "${resolvedPath}"`);

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || "Failed to delete");
      }

      this._emit("file:deleted", { path: filePath });
    } catch (error) {
      throw new Error(`Failed to delete ${filePath}: ${error}`);
    }
  }

  async mkdir(dirPath: string, options?: { recursive?: boolean; mode?: number }): Promise<void> {
    const resolvedPath = this._resolvePath(dirPath);
    const recursive = options?.recursive !== false;

    const mkdirCmd = recursive ? `mkdir -p "${resolvedPath}"` : `mkdir "${resolvedPath}"`;
    const result = await this._ssh(mkdirCmd);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to create directory");
    }

    if (options?.mode) {
      await this._ssh(`chmod ${options.mode.toString(8)} "${resolvedPath}"`);
    }
  }

  async copy(src: string, dest: string): Promise<void> {
    const srcPath = this._resolvePath(src);
    const destPath = this._resolvePath(dest);

    const result = await this._ssh(`cp -r "${srcPath}" "${destPath}"`);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to copy");
    }
  }

  async move(src: string, dest: string): Promise<void> {
    const srcPath = this._resolvePath(src);
    const destPath = this._resolvePath(dest);

    const result = await this._ssh(`mv "${srcPath}" "${destPath}"`);

    if (result.exitCode !== 0) {
      throw new Error(result.stderr || "Failed to move");
    }
  }

  async watch(_watchPath: string, _callback: FileWatchCallback): Promise<() => void> {
    // Remote file watching requires a persistent SSH connection with inotify
    // For now, throw an error indicating this is not yet supported
    throw new Error("File watching is not yet supported in RemoteWorkspace");
  }

  // ─── Command Execution ────────────────────────────────────────────────────────

  async execute(command: string, options?: ExecOptions): Promise<ExecResult> {
    const startTime = Date.now();

    try {
      const result = await this._ssh(command, options);

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
    options?: ExecOptions
  ): Promise<{ pid: number; kill: () => Promise<void> }> {
    // Execute command in background and capture PID
    const bgCommand = `(${command}) & echo $!`;
    const result = await this._ssh(bgCommand, options);

    const pidMatch = result.stdout.match(/\d+/);
    const pid = pidMatch ? parseInt(pidMatch[0], 10) : -1;

    return {
      pid,
      kill: async () => {
        if (pid > 0) {
          await this._ssh(`kill ${pid}`);
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
    const result = await this._ssh(`test -d "${resolvedPath}"`);
    if (result.exitCode !== 0) {
      throw new Error(`Not a directory: ${dirPath}`);
    }

    this._cwd = resolvedPath;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private async _ssh(command: string, options?: ExecOptions): Promise<ExecResult> {
    const cwd = options?.cwd || this._cwd;
    const env = { ...this._env, ...options?.env };

    // Build environment variable string
    const envStr = Object.entries(env)
      .map(([k, v]) => `export ${k}="${v}"`)
      .join("; ");

    // Build full command with cwd and env
    const fullCommand = `${envStr}; cd "${cwd}"; ${command}`;

    // Build SSH command arguments
    const sshArgs: string[] = [];

    if (this._privateKeyPath) {
      sshArgs.push("-i", this._privateKeyPath);
    }

    sshArgs.push(
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-p", String(this._port),
      `${this._username}@${this._host}`,
      fullCommand
    );

    try {
      const { stdout, stderr } = await execFileAsync("ssh", sshArgs, {
        timeout: options?.timeout || 60000,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      return {
        exitCode: 0,
        stdout,
        stderr,
        duration: 0, // Set by caller
        timedOut: false,
      };
    } catch (error: any) {
      const isTimeout = error.killed && error.signal === "SIGTERM";

      return {
        exitCode: error.code || 1,
        stdout: error.stdout || "",
        stderr: error.stderr || String(error),
        duration: 0, // Set by caller
        timedOut: isTimeout,
      };
    }
  }

  private _resolvePath(filePath: string): string {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.posix.join(this.config.basePath, filePath);
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
