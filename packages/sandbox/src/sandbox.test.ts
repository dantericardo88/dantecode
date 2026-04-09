import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock child_process.execFile for SandboxExecutor.isAvailable()
// Mock dockerode for SandboxManager
// Mock @dantecode/core for audit logging
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("@dantecode/core", () => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("dockerode", () => {
  const MockDocker = vi.fn();
  return { default: MockDocker };
});

import { createDefaultSandboxSpec, SandboxExecutor } from "./executor.js";
import { LocalExecutor } from "./fallback.js";
import { SandboxManager } from "./container.js";
import { execFile, spawn } from "node:child_process";
import { appendAuditEvent } from "@dantecode/core";

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;
type DataListener = (chunk: Buffer) => void;
type CloseListener = (exitCode: number) => void;
type ErrorListener = (error: Error) => void;

// ---------------------------------------------------------------------------
// createDefaultSandboxSpec tests
// ---------------------------------------------------------------------------

describe("sandbox", () => {
  describe("createDefaultSandboxSpec", () => {
    it("creates spec with correct defaults", () => {
      const spec = createDefaultSandboxSpec("/project");

      expect(spec.image).toBe("ghcr.io/dantecode/sandbox:latest");
      expect(spec.workdir).toBe("/workspace");
      expect(spec.networkMode).toBe("none");
      expect(spec.memoryLimitMb).toBe(2048);
      expect(spec.cpuLimit).toBe(2);
      expect(spec.timeoutMs).toBe(300_000);
    });

    it("mounts project root at /workspace read-write", () => {
      const spec = createDefaultSandboxSpec("/my/project");

      expect(spec.mounts).toHaveLength(1);
      expect(spec.mounts[0]!.hostPath).toBe("/my/project");
      expect(spec.mounts[0]!.containerPath).toBe("/workspace");
      expect(spec.mounts[0]!.readonly).toBe(false);
    });

    it("has empty env by default", () => {
      const spec = createDefaultSandboxSpec("/project");
      expect(spec.env).toEqual({});
    });

    it("uses different host paths for different project roots", () => {
      const spec1 = createDefaultSandboxSpec("/project-a");
      const spec2 = createDefaultSandboxSpec("/project-b");

      expect(spec1.mounts[0]!.hostPath).toBe("/project-a");
      expect(spec2.mounts[0]!.hostPath).toBe("/project-b");
    });
  });

  // -------------------------------------------------------------------------
  // SandboxManager construction
  // -------------------------------------------------------------------------

  describe("SandboxManager", () => {
    it("constructs without throwing", () => {
      const spec = createDefaultSandboxSpec("/project");
      expect(() => new SandboxManager(spec)).not.toThrow();
    });

    it("getContainerId returns null before start", () => {
      const spec = createDefaultSandboxSpec("/project");
      const manager = new SandboxManager(spec);
      expect(manager.getContainerId()).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // SandboxExecutor.isAvailable (mocked execFile)
  // -------------------------------------------------------------------------

  describe("SandboxExecutor.isAvailable", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns true when docker info succeeds", async () => {
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, callback: ExecFileCallback) => {
          callback(null, "Docker version 24.0.0", "");
        },
      );

      const spec = createDefaultSandboxSpec("/project");
      const manager = new SandboxManager(spec);
      const executor = new SandboxExecutor(manager, "/project", appendAuditEvent);

      const available = await executor.isAvailable();
      expect(available).toBe(true);
      expect(execFile).toHaveBeenCalledWith(
        "docker",
        ["info"],
        expect.objectContaining({ timeout: 10_000 }),
        expect.anything(),
      );
    });

    it("returns false when docker info fails", async () => {
      (execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, callback: ExecFileCallback) => {
          callback(new Error("docker not found"), "", "");
        },
      );

      const spec = createDefaultSandboxSpec("/project");
      const manager = new SandboxManager(spec);
      const executor = new SandboxExecutor(manager, "/project", appendAuditEvent);

      const available = await executor.isAvailable();
      expect(available).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // LocalExecutor
  // -------------------------------------------------------------------------

  describe("LocalExecutor", () => {
    let originalPlatform: string;

    beforeEach(() => {
      vi.clearAllMocks();
      originalPlatform = process.platform;
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    });

    it("isAvailable always returns true", async () => {
      const mockAudit = vi.fn().mockResolvedValue(undefined);
      const executor = new LocalExecutor("/project", mockAudit as typeof appendAuditEvent);
      expect(await executor.isAvailable()).toBe(true);
    });

    // Helper: creates a mock child process that auto-fires events after spawn
    function createAutoMockChild(exitCode: number, stdout = "", stderr = "") {
      const mockStdout = { on: vi.fn() };
      const mockStderr = { on: vi.fn() };
      const child = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: vi.fn(),
        kill: vi.fn(),
      };

      // Auto-resolve after microtask queue flushes (so spawn listeners are registered)
      setTimeout(() => {
        const stdoutCb = mockStdout.on.mock.calls.find((c: unknown[]) => c[0] === "data")?.[1] as
          | DataListener
          | undefined;
        if (stdoutCb && stdout) stdoutCb(Buffer.from(stdout));

        const stderrCb = mockStderr.on.mock.calls.find((c: unknown[]) => c[0] === "data")?.[1] as
          | DataListener
          | undefined;
        if (stderrCb && stderr) stderrCb(Buffer.from(stderr));

        const closeCb = child.on.mock.calls.find((c: unknown[]) => c[0] === "close")?.[1] as
          | CloseListener
          | undefined;
        if (closeCb) closeCb(exitCode);
      }, 0);

      return child;
    }

    // Helper: creates a mock child that auto-fires an error event
    function createErrorMockChild(errorMsg: string) {
      const mockStdout = { on: vi.fn() };
      const mockStderr = { on: vi.fn() };
      const child = {
        stdout: mockStdout,
        stderr: mockStderr,
        on: vi.fn(),
        kill: vi.fn(),
      };

      setTimeout(() => {
        const errorCb = child.on.mock.calls.find((c: unknown[]) => c[0] === "error")?.[1] as
          | ErrorListener
          | undefined;
        if (errorCb) errorCb(new Error(errorMsg));
      }, 0);

      return child;
    }

    it("run executes a simple command via spawn", async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        createAutoMockChild(0, "hello\n"),
      );

      const mockAudit = vi.fn().mockResolvedValue(undefined);
      const executor = new LocalExecutor("/project", mockAudit as typeof appendAuditEvent);

      const result = await executor.run("echo hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
      expect(result.timedOut).toBe(false);
    });

    it("runBatch executes multiple commands", async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>)
        .mockReturnValueOnce(createAutoMockChild(0, "first\n"))
        .mockReturnValueOnce(createAutoMockChild(0, "second\n"));

      const mockAudit = vi.fn().mockResolvedValue(undefined);
      const executor = new LocalExecutor("/project", mockAudit as typeof appendAuditEvent);

      const results = await executor.runBatch(["echo first", "echo second"]);
      expect(results).toHaveLength(2);
      expect(results[0]!.exitCode).toBe(0);
      expect(results[1]!.exitCode).toBe(0);
    });

    it("logs audit events for command execution", async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        createAutoMockChild(0, "output\n"),
      );

      const mockAudit = vi.fn().mockResolvedValue(undefined);
      const executor = new LocalExecutor("/project", mockAudit as typeof appendAuditEvent);

      await executor.run("test command");

      // Should log start and complete audit events
      expect(mockAudit).toHaveBeenCalledTimes(2);
      const startCall = mockAudit.mock.calls[0]!;
      expect(startCall[0]).toBe("/project");
      expect(startCall[1].type).toBe("bash_execute");
      expect(startCall[1].payload.phase).toBe("start");

      const completeCall = mockAudit.mock.calls[1]!;
      expect(completeCall[1].payload.phase).toBe("complete");
    });

    it("handles command error event", async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        createErrorMockChild("ENOENT"),
      );

      const mockAudit = vi.fn().mockResolvedValue(undefined);
      const executor = new LocalExecutor("/project", mockAudit as typeof appendAuditEvent);

      const result = await executor.run("invalid-command");
      expect(result.exitCode).toBe(-1);
      expect(result.stderr).toContain("ENOENT");
    });

    it("swallows audit logging failures", async () => {
      (spawn as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        createAutoMockChild(0, "hello\n"),
      );

      const mockAudit = vi.fn().mockRejectedValue(new Error("audit failed"));
      const executor = new LocalExecutor("/project", mockAudit as typeof appendAuditEvent);

      // Should not throw even when audit fails
      const result = await executor.run("echo hello");
      expect(result.exitCode).toBe(0);
    });
  });
});
