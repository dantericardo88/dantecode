// ============================================================================
// @dantecode/dante-sandbox — Docker Isolation Layer
// Primary isolation backend. Wraps @dantecode/sandbox SandboxManager.
// ============================================================================

import {
  SandboxManager,
  SandboxExecutor,
  createDefaultSandboxSpec,
} from "@dantecode/sandbox";
import { appendAuditEvent } from "@dantecode/core";
import type { IsolationLayer, ExecutionRequest, ExecutionResult } from "./types.js";

export class DockerIsolationLayer implements IsolationLayer {
  readonly strategy = "docker" as const;

  private manager: SandboxManager | null = null;
  private executor: SandboxExecutor | null = null;
  private started = false;

  constructor(private readonly projectRoot: string) {}

  async isAvailable(): Promise<boolean> {
    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      await execFileAsync("docker", ["info"], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    await this.ensureStarted();
    if (!this.executor) throw new Error("DockerIsolationLayer: executor not initialized");

    const startMs = Date.now();
    const result = await this.executor.run(request.command, request.timeoutMs);

    return {
      requestId: request.id,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs ?? Date.now() - startMs,
      timedOut: result.timedOut,
      strategy: "docker",
      sandboxed: true,
      violations: [],
    };
  }

  async teardown(): Promise<void> {
    if (this.manager) {
      try { await this.manager.stop(); } catch { /* non-fatal */ }
      this.manager = null;
    }
    this.executor = null;
    this.started = false;
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    const spec = createDefaultSandboxSpec(this.projectRoot);
    this.manager = new SandboxManager(spec);
    await this.manager.start();
    this.executor = new SandboxExecutor(this.manager, this.projectRoot, appendAuditEvent);
    this.started = true;
  }
}
