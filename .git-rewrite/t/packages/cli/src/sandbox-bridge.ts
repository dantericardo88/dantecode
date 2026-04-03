// ============================================================================
// @dantecode/cli — Sandbox Bridge
// Bridges the CLI tool pipeline to the sandbox package for isolated command
// execution. Falls back to LocalExecutor when Docker is not available.
// ============================================================================

import { appendAuditEvent } from "@dantecode/core";
import {
  SandboxManager,
  SandboxExecutor,
  LocalExecutor,
  createDefaultSandboxSpec,
} from "@dantecode/sandbox";
import type { ToolResult } from "./tools.js";

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Bridge between the CLI tool pipeline and the sandbox package.
 * Manages container lifecycle (lazy start) and maps SandboxExecResult to ToolResult.
 */
export class SandboxBridge {
  private manager: SandboxManager | null = null;
  private executor: SandboxExecutor | LocalExecutor | null = null;
  private started = false;

  constructor(
    private readonly projectRoot: string,
    private readonly verbose: boolean = false,
  ) {}

  /**
   * Checks if Docker is available for sandbox execution.
   * Returns true if Docker is running, false otherwise.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const { execSync } = await import("node:child_process");
      execSync("docker info", { stdio: "ignore", timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lazily initializes the sandbox on first use.
   * If Docker is available, starts a container. Otherwise falls back to LocalExecutor.
   */
  private async ensureStarted(): Promise<void> {
    if (this.started) return;

    const dockerAvailable = await this.isAvailable();

    if (dockerAvailable) {
      const spec = createDefaultSandboxSpec(this.projectRoot);
      this.manager = new SandboxManager(spec);
      await this.manager.start();
      this.executor = new SandboxExecutor(this.manager, this.projectRoot, appendAuditEvent);
      if (this.verbose) {
        process.stdout.write(`${DIM}[sandbox: Docker container started]${RESET}\n`);
      }
    } else {
      this.executor = new LocalExecutor(this.projectRoot, appendAuditEvent);
      if (this.verbose) {
        process.stdout.write(
          `${DIM}[sandbox: Docker not available, using local fallback]${RESET}\n`,
        );
      }
    }

    this.started = true;
  }

  /**
   * Executes a command in the sandbox and returns a ToolResult.
   */
  async runInSandbox(command: string, timeoutMs: number = 120000): Promise<ToolResult> {
    await this.ensureStarted();

    if (!this.executor) {
      return { content: "Sandbox executor not initialized", isError: true };
    }

    const result = await this.executor.run(command, timeoutMs);

    const output = result.stdout + (result.stderr ? `\nstderr: ${result.stderr}` : "");

    if (result.timedOut) {
      return {
        content: `Command timed out after ${timeoutMs}ms.\n${output}`,
        isError: true,
      };
    }

    return {
      content: output || "(no output)",
      isError: result.exitCode !== 0,
    };
  }

  /**
   * Shuts down the sandbox container (if running).
   */
  async shutdown(): Promise<void> {
    if (this.manager) {
      try {
        await this.manager.stop();
        if (this.verbose) {
          process.stdout.write(`${DIM}[sandbox: container stopped]${RESET}\n`);
        }
      } catch {
        // Non-fatal: container may already be stopped
      }
      this.manager = null;
    }
    this.executor = null;
    this.started = false;
  }
}
