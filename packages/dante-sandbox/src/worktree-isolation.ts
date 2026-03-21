// ============================================================================
// @dantecode/dante-sandbox — Worktree Isolation Layer
// Git-native fallback isolation. Creates a temporary worktree per session,
// runs commands inside it, and cleans up on teardown.
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { IsolationLayer, ExecutionRequest, ExecutionResult } from "./types.js";

const execFileAsync = promisify(execFile);

export class WorktreeIsolationLayer implements IsolationLayer {
  readonly strategy = "worktree" as const;

  private worktreePath: string | null = null;
  private readonly worktreeBase: string;

  constructor(private readonly projectRoot: string) {
    this.worktreeBase = join(projectRoot, ".dante-sandbox-worktrees");
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync("git", ["worktree", "list"], {
        cwd: this.projectRoot,
        timeout: 3_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const cwd = await this.ensureWorktree();
    const startMs = Date.now();

    return new Promise<ExecutionResult>((resolve) => {
      const isWindows = process.platform === "win32";
      const shell = isWindows ? "cmd" : "sh";
      const shellFlag = isWindows ? "/c" : "-c";

      const child = spawn(shell, [shellFlag, request.command], {
        cwd: request.cwd ?? cwd,
        env: { ...process.env, ...request.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = request.timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, request.timeoutMs)
        : null;

      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        resolve({
          requestId: request.id,
          exitCode: code ?? 1,
          stdout,
          stderr,
          durationMs: Date.now() - startMs,
          timedOut,
          strategy: "worktree",
          sandboxed: true,
          violations: [],
        });
      });

      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        resolve({
          requestId: request.id,
          exitCode: -1,
          stdout: "",
          stderr: err.message,
          durationMs: Date.now() - startMs,
          timedOut: false,
          strategy: "worktree",
          sandboxed: true,
          violations: [],
        });
      });
    });
  }

  async teardown(): Promise<void> {
    if (!this.worktreePath) return;
    const wt = this.worktreePath;
    this.worktreePath = null;
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", wt], {
        cwd: this.projectRoot,
        timeout: 10_000,
      });
    } catch {
      // Best-effort: try fs removal
      try { await rm(wt, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  private async ensureWorktree(): Promise<string> {
    if (this.worktreePath) return this.worktreePath;

    await mkdir(this.worktreeBase, { recursive: true });
    const id = randomUUID().slice(0, 8);
    const path = join(this.worktreeBase, `wt-${id}`);

    await execFileAsync(
      "git",
      ["worktree", "add", "--detach", path],
      { cwd: this.projectRoot, timeout: 15_000 },
    );

    this.worktreePath = path;
    return path;
  }
}
