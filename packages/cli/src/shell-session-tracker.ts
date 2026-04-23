// packages/cli/src/shell-session-tracker.ts
// Shell Session Tracker — captures working directory, environment, and command
// history for injection into AI context. Closes dim 13 gap vs Warp/Continue.dev
// which surface shell state as structured context to the model.
//
// Pattern: Continue.dev terminal integration — tracks command output, exit codes,
// working dir transitions, and env diffs. Zero external deps.

import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShellCommandRecord {
  /** Command with arguments as executed */
  command: string;
  /** Working directory when command ran */
  cwd: string;
  /** Exit code (0 = success) */
  exitCode: number;
  /** Trimmed stdout (first 2KB) */
  stdout: string;
  /** Trimmed stderr (first 1KB) */
  stderr: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** ISO timestamp */
  timestamp: string;
}

export interface ShellSessionSnapshot {
  /** Current working directory */
  cwd: string;
  /** Most recent commands (newest last) */
  history: ShellCommandRecord[];
  /** Environment variables that differ from process.env baseline */
  envDiff: Record<string, string | undefined>;
  /** Whether the last command failed */
  lastCommandFailed: boolean;
  capturedAt: string;
}

// ─── ShellSessionTracker ──────────────────────────────────────────────────────

export interface ShellSessionOptions {
  /** Max commands to keep in history */
  maxHistory?: number;
  /** Max stdout bytes to capture per command */
  maxStdoutBytes?: number;
  /** Max stderr bytes to capture per command */
  maxStderrBytes?: number;
  /** Baseline env (defaults to process.env at construction time) */
  baselineEnv?: NodeJS.ProcessEnv;
}

/**
 * Tracks shell session state: current working directory, command history,
 * environment variable changes, and exit codes.
 *
 * Integrates into the AI prompt via `formatForContext()`.
 */
export class ShellSessionTracker {
  private _cwd: string;
  private _history: ShellCommandRecord[] = [];
  private _envDiff: Record<string, string | undefined> = {};
  private _baselineEnv: NodeJS.ProcessEnv;
  private readonly _maxHistory: number;
  private readonly _maxStdout: number;
  private readonly _maxStderr: number;

  constructor(initialCwd?: string, options: ShellSessionOptions = {}) {
    this._cwd = initialCwd ? resolve(initialCwd) : process.cwd();
    this._maxHistory = options.maxHistory ?? 20;
    this._maxStdout = options.maxStdoutBytes ?? 2048;
    this._maxStderr = options.maxStderrBytes ?? 1024;
    this._baselineEnv = options.baselineEnv ?? { ...process.env };
  }

  /** Current working directory. */
  get cwd(): string { return this._cwd; }

  /** Change the tracked working directory. */
  chdir(newCwd: string): void {
    this._cwd = resolve(this._cwd, newCwd);
  }

  /**
   * Record a completed shell command and its result.
   * Called after each Bash tool execution.
   */
  record(
    command: string,
    opts: {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      durationMs?: number;
      cwd?: string;
    } = {},
  ): ShellCommandRecord {
    const rec: ShellCommandRecord = {
      command: command.slice(0, 500),  // cap command length
      cwd: opts.cwd ? resolve(opts.cwd) : this._cwd,
      exitCode: opts.exitCode ?? 0,
      stdout: this._truncate(opts.stdout ?? "", this._maxStdout),
      stderr: this._truncate(opts.stderr ?? "", this._maxStderr),
      durationMs: opts.durationMs ?? 0,
      timestamp: new Date().toISOString(),
    };

    this._history.push(rec);
    if (this._history.length > this._maxHistory) {
      this._history.shift();
    }

    // Detect cd commands — update tracked cwd
    const cdMatch = command.match(/^cd\s+(.+)$/);
    if (cdMatch && rec.exitCode === 0) {
      try {
        this.chdir(cdMatch[1]!.trim().replace(/^["']|["']$/g, ""));
      } catch { /* non-fatal */ }
    }

    return rec;
  }

  /**
   * Update tracked environment variable (e.g. from `export FOO=bar`).
   */
  setEnv(key: string, value: string | undefined): void {
    const baseline = this._baselineEnv[key];
    if (value === baseline) {
      delete this._envDiff[key];
    } else {
      this._envDiff[key] = value;
    }
  }

  /**
   * Parse and apply `export KEY=VALUE` patterns from command output.
   */
  parseExports(commandLine: string): void {
    const EXPORT_RE = /export\s+([A-Z_][A-Z0-9_]*)=["']?([^"'\s]*)["']?/g;
    let match: RegExpExecArray | null;
    while ((match = EXPORT_RE.exec(commandLine)) !== null) {
      this.setEnv(match[1]!, match[2] ?? "");
    }
  }

  /**
   * Get the current session snapshot.
   */
  snapshot(): ShellSessionSnapshot {
    const last = this._history[this._history.length - 1];
    return {
      cwd: this._cwd,
      history: [...this._history],
      envDiff: { ...this._envDiff },
      lastCommandFailed: last ? last.exitCode !== 0 : false,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Format shell session state as an AI context block.
   * Injects into the `@terminal` or `@shell` context slot.
   */
  formatForContext(maxCommands = 5): string {
    const snap = this.snapshot();
    const lines: string[] = ["## Shell Session"];

    lines.push(`**Working directory:** \`${snap.cwd}\``);

    if (Object.keys(snap.envDiff).length > 0) {
      lines.push("", "**Environment changes:**");
      for (const [key, val] of Object.entries(snap.envDiff)) {
        lines.push(`  - \`${key}=${val ?? "(unset)"}\``);
      }
    }

    const recentHistory = snap.history.slice(-maxCommands);
    if (recentHistory.length > 0) {
      lines.push("", "**Recent commands:**");
      for (const rec of recentHistory) {
        const statusIcon = rec.exitCode === 0 ? "✓" : `✗(${rec.exitCode})`;
        lines.push(`\`\`\`bash`);
        lines.push(`$ ${rec.command}  # ${statusIcon} ${rec.durationMs}ms`);
        if (rec.stdout) {
          const stdoutPreview = rec.stdout.split("\n").slice(0, 5).join("\n");
          lines.push(stdoutPreview);
        }
        if (rec.stderr && rec.exitCode !== 0) {
          lines.push(`[stderr] ${rec.stderr.split("\n")[0] ?? ""}`);
        }
        lines.push("```");
      }
    }

    if (snap.lastCommandFailed) {
      lines.push("", "⚠️  **Last command failed** — check stderr above before proceeding.");
    }

    return lines.join("\n");
  }

  /**
   * Get the last N commands as a compact summary for inclusion in tool calls.
   */
  getCompactHistory(n = 3): string {
    return this._history
      .slice(-n)
      .map((r) => `${r.exitCode === 0 ? "✓" : "✗"} ${r.command}`)
      .join("\n");
  }

  /**
   * Detect the current git branch and project root by running git commands.
   * Returns null if not in a git repo.
   */
  detectGitContext(): { branch: string; root: string } | null {
    try {
      const branch = execFileSync("git", ["branch", "--show-current"], {
        cwd: this._cwd,
        encoding: "utf-8",
        timeout: 2000,
      }).trim();
      const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: this._cwd,
        encoding: "utf-8",
        timeout: 2000,
      }).trim();
      return { branch, root };
    } catch {
      return null;
    }
  }

  /**
   * Clear command history (for new session or test isolation).
   */
  clearHistory(): void {
    this._history = [];
  }

  private _truncate(s: string, maxBytes: number): string {
    if (s.length <= maxBytes) return s.trim();
    return s.slice(0, maxBytes).trim() + "\n… (truncated)";
  }
}

// ─── Global Tracker ───────────────────────────────────────────────────────────

/** Global singleton tracker — wired into the Bash tool execution path. */
export const globalShellTracker = new ShellSessionTracker();

/**
 * Hook to call after every Bash tool execution.
 * Automatically records the command result and detects cwd changes.
 */
export function recordBashExecution(
  command: string,
  result: { stdout?: string; stderr?: string; exitCode?: number; durationMs?: number },
): void {
  globalShellTracker.record(command, result);
  globalShellTracker.parseExports(command);
}
