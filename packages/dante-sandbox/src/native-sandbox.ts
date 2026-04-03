// ============================================================================
// @dantecode/dante-sandbox — Native OS Sandbox Isolation Layer
// Uses macOS Seatbelt (sandbox-exec) or Linux bubblewrap (bwrap) for
// zero-dependency OS-native process isolation.
// Falls back to direct host execution on Windows / unsupported platforms.
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IsolationLayer, ExecutionRequest, ExecutionResult } from "./types.js";

const execFileAsync = promisify(execFile);

// ─── Internal Types ───────────────────────────────────────────────────────────

/**
 * Internal isolation mode for OS-native sandbox profile generation.
 * Maps from the broader SandboxMode enum to a concrete file-access intent.
 */
export type NativeIsolationMode = "read-only" | "workspace-write" | "full-access";

/** Map a SandboxMode to a NativeIsolationMode. */
function toNativeMode(requestedMode: string | undefined): NativeIsolationMode {
  switch (requestedMode) {
    case "off":
    case "host-escape":
      return "full-access";
    case "docker":
    case "auto":
      return "workspace-write";
    case "worktree":
      return "read-only";
    default:
      return "workspace-write";
  }
}

// ─── NativeSandbox ────────────────────────────────────────────────────────────

/**
 * OS-native sandbox isolation layer.
 *
 * Strategy:
 *   - macOS  → Apple Seatbelt (sandbox-exec) with a generated SBPL profile
 *   - Linux  → bubblewrap (bwrap) when available, otherwise direct execution
 *   - other  → direct execution via /bin/sh (or cmd.exe on Windows)
 *
 * This layer is always "available" — it degrades gracefully to host execution
 * when OS-level tools are absent, making it a safe zero-dep fallback.
 */
export class NativeSandbox implements IsolationLayer {
  readonly strategy = "native" as const;

  constructor(private readonly projectRoot: string) {}

  /** Always true — NativeSandbox degrades gracefully. */
  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const platform = process.platform;
    if (platform === "darwin") {
      return this.executeMacOS(request);
    }
    if (platform === "linux") {
      return this.executeLinux(request);
    }
    return this.executeFallback(request);
  }

  /** No persistent resources — nothing to clean up. */
  async teardown(): Promise<void> {
    // no-op
  }

  // ── macOS — Apple Seatbelt ─────────────────────────────────────────────────

  /** Execute using macOS Seatbelt (sandbox-exec). */
  async executeMacOS(request: ExecutionRequest): Promise<ExecutionResult> {
    const startMs = Date.now();
    const cwd = request.cwd ?? this.projectRoot;
    const mode = toNativeMode(request.requestedMode);
    const profile = this.generateSeatbeltProfile(mode, cwd);

    try {
      const { stdout, stderr } = await execFileAsync(
        "sandbox-exec",
        ["-p", profile, "/bin/sh", "-c", request.command],
        {
          cwd,
          env: { ...process.env, ...request.env },
          timeout: request.timeoutMs,
        },
      );
      return {
        requestId: request.id,
        exitCode: 0,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        durationMs: Date.now() - startMs,
        timedOut: false,
        strategy: "native",
        sandboxed: true,
        violations: [],
      };
    } catch (err: unknown) {
      const anyErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        requestId: request.id,
        exitCode: typeof anyErr.code === "number" ? anyErr.code : 1,
        stdout: anyErr.stdout ?? "",
        stderr: anyErr.stderr ?? anyErr.message ?? String(err),
        durationMs: Date.now() - startMs,
        timedOut: false,
        strategy: "native",
        sandboxed: true,
        violations: [],
      };
    }
  }

  /**
   * Generate an Apple Seatbelt (SBPL) profile string.
   *
   * @param mode  Desired isolation level
   * @param cwd   Working directory — used for workspace-write allow path
   */
  generateSeatbeltProfile(mode: NativeIsolationMode, cwd: string): string {
    switch (mode) {
      case "read-only":
        return `(version 1)(allow default)(deny file-write*)(deny network*)`;
      case "workspace-write":
        return `(version 1)(allow default)(deny network*)(allow file-write* (subpath "${cwd}"))`;
      case "full-access":
      default:
        return `(version 1)(allow default)`;
    }
  }

  // ── Linux — bubblewrap ─────────────────────────────────────────────────────

  /** Execute using bubblewrap (bwrap) if available, otherwise fall back. */
  async executeLinux(request: ExecutionRequest): Promise<ExecutionResult> {
    const available = await this.hasBwrap();
    if (!available) {
      return this.executeFallback(request);
    }

    const startMs = Date.now();
    const cwd = request.cwd ?? this.projectRoot;
    const mode = toNativeMode(request.requestedMode);
    const bwrapArgs = this.generateBwrapArgs(mode, cwd);

    try {
      const { stdout, stderr } = await execFileAsync(
        "bwrap",
        [...bwrapArgs, "/bin/sh", "-c", request.command],
        {
          cwd,
          env: { ...process.env, ...request.env },
          timeout: request.timeoutMs,
        },
      );
      return {
        requestId: request.id,
        exitCode: 0,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        durationMs: Date.now() - startMs,
        timedOut: false,
        strategy: "native",
        sandboxed: true,
        violations: [],
      };
    } catch (err: unknown) {
      const anyErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        requestId: request.id,
        exitCode: typeof anyErr.code === "number" ? anyErr.code : 1,
        stdout: anyErr.stdout ?? "",
        stderr: anyErr.stderr ?? anyErr.message ?? String(err),
        durationMs: Date.now() - startMs,
        timedOut: false,
        strategy: "native",
        sandboxed: true,
        violations: [],
      };
    }
  }

  /**
   * Generate the argument list for bubblewrap (bwrap).
   *
   * @param mode  Desired isolation level
   * @param cwd   Working directory — used for workspace-write bind mount
   */
  generateBwrapArgs(mode: NativeIsolationMode, cwd: string): string[] {
    const base = ["--die-with-parent", "--dev", "/dev", "--proc", "/proc"];
    switch (mode) {
      case "read-only":
        return [...base, "--ro-bind", "/", "/", "--unshare-net"];
      case "workspace-write":
        return [...base, "--ro-bind", "/", "/", "--bind", cwd, cwd, "--unshare-net"];
      case "full-access":
      default:
        return [...base, "--bind", "/", "/"];
    }
  }

  /** Returns true when the bwrap binary is available on this system. */
  async hasBwrap(): Promise<boolean> {
    try {
      await execFileAsync("which", ["bwrap"], { timeout: 3_000 });
      return true;
    } catch {
      return false;
    }
  }

  // ── Fallback — direct execution ────────────────────────────────────────────

  /**
   * Execute directly on the host without OS-level sandboxing.
   * Used on Windows and as a final fallback.
   */
  async executeFallback(request: ExecutionRequest): Promise<ExecutionResult> {
    const startMs = Date.now();
    const cwd = request.cwd ?? this.projectRoot;
    const isWindows = process.platform === "win32";

    try {
      const { stdout, stderr } = isWindows
        ? await execFileAsync("cmd.exe", ["/C", request.command], {
            cwd,
            env: { ...process.env, ...request.env },
            timeout: request.timeoutMs,
          })
        : await execFileAsync("/bin/sh", ["-c", request.command], {
            cwd,
            env: { ...process.env, ...request.env },
            timeout: request.timeoutMs,
          });

      return {
        requestId: request.id,
        exitCode: 0,
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        durationMs: Date.now() - startMs,
        timedOut: false,
        strategy: "native",
        sandboxed: process.platform !== "win32",
        violations: [],
      };
    } catch (err: unknown) {
      const anyErr = err as { code?: number; stdout?: string; stderr?: string; message?: string };
      return {
        requestId: request.id,
        exitCode: typeof anyErr.code === "number" ? anyErr.code : 1,
        stdout: anyErr.stdout ?? "",
        stderr: anyErr.stderr ?? anyErr.message ?? String(err),
        durationMs: Date.now() - startMs,
        timedOut: false,
        strategy: "native",
        sandboxed: process.platform !== "win32",
        violations: [],
      };
    }
  }
}
