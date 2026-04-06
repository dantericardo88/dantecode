// ============================================================================
// @dantecode/core — Platform-Native Sandbox
// OS-level restrictions beyond Docker.
// macOS: Seatbelt (sandbox-exec), Linux: Bubblewrap (bwrap), Windows: Job Objects
// Based on OpenAI Codex's sandboxing approach.
// ============================================================================

import { execFileSync } from "node:child_process";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SandboxMode =
  /** Read all, write within projectRoot, run local commands (default) */
  | "workspace-write"
  /** No writes, no shell execution */
  | "read-only"
  /** No restrictions */
  | "danger-full-access";

export interface PlatformSandboxConfig {
  mode: SandboxMode;
  projectRoot: string;
  /** Additional paths outside projectRoot that should also be writable */
  allowedExternalPaths?: string[];
}

export interface PlatformSandboxResult {
  available: boolean;
  platform: "macos-seatbelt" | "linux-bubblewrap" | "windows-job" | "none";
  /** How to wrap a command with the sandbox (array of command + args) */
  command?: string[];
  /** Why the platform sandbox is unavailable */
  reason?: string;
}

// ─── Platform Detection ───────────────────────────────────────────────────────

/**
 * Detect the available platform sandbox mechanism.
 *
 * macOS: checks for `sandbox-exec` (Seatbelt)
 * Linux: checks for `bwrap` (Bubblewrap)
 * Windows: always reports "windows-job" (CreateJobObject via spawn flags)
 */
export function detectPlatformSandbox(): PlatformSandboxResult {
  const platform = process.platform;

  if (platform === "darwin") {
    try {
      execFileSync("which", ["sandbox-exec"], { encoding: "utf8", stdio: "pipe" });
      return { available: true, platform: "macos-seatbelt" };
    } catch {
      return {
        available: false,
        platform: "none",
        reason: "sandbox-exec not found — install Xcode Command Line Tools",
      };
    }
  }

  if (platform === "linux") {
    try {
      execFileSync("which", ["bwrap"], { encoding: "utf8", stdio: "pipe" });
      return { available: true, platform: "linux-bubblewrap" };
    } catch {
      return {
        available: false,
        platform: "none",
        reason: "bwrap not found — install bubblewrap (apt: bubblewrap, dnf: bubblewrap)",
      };
    }
  }

  if (platform === "win32") {
    // Windows uses Job Objects applied via child_process spawn flags — always available
    return { available: true, platform: "windows-job" };
  }

  return {
    available: false,
    platform: "none",
    reason: `Unsupported platform: ${platform}`,
  };
}

// ─── Command Builder ──────────────────────────────────────────────────────────

/**
 * Wrap a command with the platform sandbox if available.
 *
 * Returns the original command unchanged when:
 * - sandbox.available is false
 * - platform is "windows-job" (Job Object is applied at spawn time, not as a wrapper)
 * - mode is "danger-full-access"
 */
export function buildSandboxedCommand(
  command: string,
  args: string[],
  config: PlatformSandboxConfig,
  sandbox: PlatformSandboxResult,
): { command: string; args: string[] } {
  if (!sandbox.available || config.mode === "danger-full-access") {
    return { command, args };
  }

  if (sandbox.platform === "macos-seatbelt") {
    const profile = getSandboxProfile(config);
    return {
      command: "sandbox-exec",
      args: ["-p", profile, command, ...args],
    };
  }

  if (sandbox.platform === "linux-bubblewrap") {
    const bwrapArgs = _buildBwrapArgs(config);
    return {
      command: "bwrap",
      args: [...bwrapArgs, command, ...args],
    };
  }

  // windows-job: no command-level wrapper — caller applies Job Object at spawn time
  return { command, args };
}

// ─── macOS Seatbelt Profile ───────────────────────────────────────────────────

/**
 * Build a macOS Seatbelt profile string.
 *
 * Allows:
 * - Network access (sysctl, DNS, TCP)
 * - Read from /
 * - Write only within projectRoot (and any allowedExternalPaths)
 *
 * In read-only mode, all writes are denied.
 */
export function getSandboxProfile(config: PlatformSandboxConfig): string {
  const { mode, projectRoot, allowedExternalPaths = [] } = config;

  if (mode === "danger-full-access") {
    return "(version 1)(allow default)";
  }

  const writableRoots = [projectRoot, ...allowedExternalPaths];

  // Build write-allow clauses for each writable root
  const writeAllowClauses =
    mode === "read-only"
      ? ""
      : writableRoots
          .map((p) => `(allow file-write* (subpath "${_escapeSeatbeltPath(p)}"))`)
          .join("\n");

  return [
    "(version 1)",
    // Deny all file-writes by default
    "(deny file-write*)",
    // Allow reading from anywhere
    "(allow file-read*)",
    // Allow process and networking operations
    "(allow process*)",
    "(allow network*)",
    "(allow sysctl*)",
    "(allow mach*)",
    "(allow signal)",
    "(allow ipc-posix*)",
    // Re-allow writes to writable roots
    writeAllowClauses,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Linux Bubblewrap Args ────────────────────────────────────────────────────

function _buildBwrapArgs(config: PlatformSandboxConfig): string[] {
  const { mode, projectRoot, allowedExternalPaths = [] } = config;
  const args: string[] = [];

  // Read-only bind of common system paths
  args.push("--ro-bind", "/usr", "/usr");
  args.push("--ro-bind", "/lib", "/lib");
  if (_pathExists("/lib64")) {
    args.push("--ro-bind", "/lib64", "/lib64");
  }
  args.push("--ro-bind", "/etc", "/etc");
  args.push("--ro-bind", "/bin", "/bin");
  if (_pathExists("/sbin")) {
    args.push("--ro-bind", "/sbin", "/sbin");
  }

  // Dev nodes
  args.push("--dev", "/dev");

  // Proc
  args.push("--proc", "/proc");

  // Tmp
  args.push("--tmpfs", "/tmp");

  if (mode === "read-only") {
    // Read-only bind of projectRoot
    args.push("--ro-bind", projectRoot, projectRoot);
  } else {
    // Read-write bind of projectRoot
    args.push("--bind", projectRoot, projectRoot);
    // Additional writable paths
    for (const extraPath of allowedExternalPaths) {
      args.push("--bind", extraPath, extraPath);
    }
  }

  // Allow network
  args.push("--share-net");

  return args;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _escapeSeatbeltPath(p: string): string {
  // Seatbelt profile strings use C-style escaping
  return p.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function _pathExists(p: string): boolean {
  try {
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    return existsSync(p);
  } catch {
    return false;
  }
}
