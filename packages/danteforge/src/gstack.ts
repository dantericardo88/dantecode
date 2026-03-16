// ============================================================================
// @dantecode/danteforge — GStack (Guard Stack) Command Runner
// Executes a sequence of quality-gate commands (build, test, lint, etc.)
// and captures results with timing and exit codes.
// ============================================================================

import type { GStackCommand, GStackResult } from "@dantecode/config-types";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const WINDOWS_SHELL_BUILTINS = new Set([
  "assoc",
  "break",
  "call",
  "cd",
  "chdir",
  "cls",
  "color",
  "copy",
  "date",
  "del",
  "dir",
  "echo",
  "endlocal",
  "erase",
  "for",
  "ftype",
  "goto",
  "if",
  "md",
  "mkdir",
  "mklink",
  "move",
  "path",
  "pause",
  "popd",
  "prompt",
  "pushd",
  "rd",
  "rem",
  "ren",
  "rename",
  "rmdir",
  "set",
  "setlocal",
  "shift",
  "start",
  "time",
  "title",
  "type",
  "ver",
  "verify",
  "vol",
]);

// ----------------------------------------------------------------------------
// Single Command Runner
// ----------------------------------------------------------------------------

/**
 * Runs a single GStack command as a child process, capturing stdout, stderr,
 * exit code, and duration. Respects the command's timeout — kills the process
 * if it exceeds timeoutMs.
 *
 * @param command - The GStackCommand to execute
 * @param projectRoot - Working directory for the process
 * @returns GStackResult with captured output and pass/fail status
 */
export function runGStackSingle(
  command: GStackCommand,
  projectRoot: string,
): Promise<GStackResult> {
  return new Promise((resolvePromise) => {
    const startTime = Date.now();
    const cwd = resolve(projectRoot);

    // Verify working directory exists
    if (!existsSync(cwd)) {
      resolvePromise({
        command: command.command,
        exitCode: 1,
        stdout: "",
        stderr: `Working directory does not exist: ${cwd}`,
        durationMs: 0,
        passed: false,
      });
      return;
    }

    // Parse command into executable and arguments
    // Handle shell-like command strings by splitting on whitespace
    // but respecting quoted strings
    const parts = parseCommandString(command.command);
    const executable = parts[0];
    const args = parts.slice(1);

    if (!executable) {
      resolvePromise({
        command: command.command,
        exitCode: 1,
        stdout: "",
        stderr: `Empty command: ${command.command}`,
        durationMs: 0,
        passed: false,
      });
      return;
    }

    // Determine if we should use shell mode
    // Shell mode is needed for commands with pipes, redirects, or shell builtins
    const needsShell = shouldUseShell(command.command, executable);

    let child;
    if (needsShell) {
      // Run via shell for complex commands
      child = spawn(command.command, [], {
        cwd,
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    } else {
      child = spawn(executable, args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
    }

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let killed = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    // Set up timeout if specified
    if (command.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        // Give it 2 seconds to die gracefully, then SIGKILL
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGKILL");
          }
        }, 2000);
      }, command.timeoutMs);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("close", (exitCode: number | null) => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      const durationMs = Date.now() - startTime;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");

      const actualExitCode = killed ? 124 : (exitCode ?? 1); // 124 = timeout convention
      const passed = command.failureIsSoft ? true : actualExitCode === 0;

      if (killed) {
        resolvePromise({
          command: command.command,
          exitCode: 124,
          stdout,
          stderr: stderr + `\n[GStack] Process killed after ${command.timeoutMs}ms timeout`,
          durationMs,
          passed: command.failureIsSoft,
        });
      } else {
        resolvePromise({
          command: command.command,
          exitCode: actualExitCode,
          stdout,
          stderr,
          durationMs,
          passed,
        });
      }
    });

    child.on("error", (err: Error) => {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }

      const durationMs = Date.now() - startTime;
      resolvePromise({
        command: command.command,
        exitCode: 127, // command not found convention
        stdout: "",
        stderr: `Failed to spawn process: ${err.message}`,
        durationMs,
        passed: command.failureIsSoft,
      });
    });
  });
}

function shouldUseShell(command: string, executable: string): boolean {
  if (/[|><;&]/.test(command) || /\$\(/.test(command)) {
    return true;
  }

  if (process.platform !== "win32") {
    return false;
  }

  return WINDOWS_SHELL_BUILTINS.has(executable.toLowerCase());
}

// ----------------------------------------------------------------------------
// Sequential Multi-Command Runner
// ----------------------------------------------------------------------------

/**
 * Executes an array of GStack commands sequentially, collecting results.
 * Each command runs after the previous one completes. If a hard-failure
 * command fails, subsequent commands still execute (for full diagnostics).
 *
 * @param code - The code being tested (unused directly but included for context)
 * @param commands - Array of GStackCommand definitions
 * @param projectRoot - Working directory for all commands
 * @returns Array of GStackResult for each command
 */
export async function runGStack(
  _code: string,
  commands: GStackCommand[],
  projectRoot: string,
): Promise<GStackResult[]> {
  const results: GStackResult[] = [];

  for (const command of commands) {
    const result = await runGStackSingle(command, projectRoot);
    results.push(result);
  }

  return results;
}

// ----------------------------------------------------------------------------
// Command String Parser
// ----------------------------------------------------------------------------

/**
 * Parses a shell-like command string into an array of arguments,
 * respecting single quotes, double quotes, and backslash escapes.
 *
 * Examples:
 *   "npm run test" → ["npm", "run", "test"]
 *   "echo 'hello world'" → ["echo", "hello world"]
 *   'grep -r "some pattern" src/' → ["grep", "-r", "some pattern", "src/"]
 */
function parseCommandString(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === " " && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

// ----------------------------------------------------------------------------
// Utility: Check if all GStack results passed
// ----------------------------------------------------------------------------

/**
 * Returns true if every GStack result passed.
 */
export function allGStackPassed(results: GStackResult[]): boolean {
  return results.every((r) => r.passed);
}

/**
 * Returns a summary string of GStack results for logging.
 */
export function summarizeGStackResults(results: GStackResult[]): string {
  const lines: string[] = [];
  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    lines.push(`[${status}] ${result.command} (exit=${result.exitCode}, ${result.durationMs}ms)`);
    if (!result.passed && result.stderr.length > 0) {
      // Include first 5 lines of stderr for context
      const stderrLines = result.stderr.split("\n").slice(0, 5);
      for (const line of stderrLines) {
        lines.push(`  stderr: ${line}`);
      }
    }
  }
  return lines.join("\n");
}
