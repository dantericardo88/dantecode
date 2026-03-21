// ============================================================================
// @dantecode/dante-sandbox — NativeSandbox Tests
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { NativeSandbox } from "./native-sandbox.js";
import type { ExecutionRequest, ExecutionResult } from "./types.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

/** Build a minimal valid ExecutionRequest for tests. */
function makeRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    command: "echo hello",
    args: [],
    cwd: process.cwd(),
    env: {},
    taskType: "bash",
    actor: "agent",
    requestedMode: "auto",
    timeoutMs: 10_000,
    ...overrides,
  };
}

// ─── Basic Contract Tests ──────────────────────────────────────────────────────

describe("NativeSandbox — contract", () => {
  it("strategy is 'native'", () => {
    const sandbox = new NativeSandbox(process.cwd());
    expect(sandbox.strategy).toBe("native");
  });

  it("isAvailable() always returns true", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    await expect(sandbox.isAvailable()).resolves.toBe(true);
  });

  it("teardown() resolves without error", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    await expect(sandbox.teardown()).resolves.toBeUndefined();
  });
});

// ─── Seatbelt Profile Generation (macOS) ──────────────────────────────────────

describe("NativeSandbox — generateSeatbeltProfile", () => {
  it("read-only profile contains 'deny file-write*'", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const profile = sandbox.generateSeatbeltProfile("read-only", "/tmp");
    expect(profile).toContain("deny file-write*");
  });

  it("read-only profile contains 'deny network*'", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const profile = sandbox.generateSeatbeltProfile("read-only", "/tmp");
    expect(profile).toContain("deny network*");
  });

  it("workspace-write profile contains cwd in allow path", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const profile = sandbox.generateSeatbeltProfile("workspace-write", "/project");
    expect(profile).toContain('allow file-write* (subpath "/project")');
  });

  it("workspace-write profile denies network", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const profile = sandbox.generateSeatbeltProfile("workspace-write", "/project");
    expect(profile).toContain("deny network*");
  });

  it("full-access profile contains '(allow default)'", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const profile = sandbox.generateSeatbeltProfile("full-access", "/tmp");
    expect(profile).toContain("(allow default)");
  });

  it("full-access profile does NOT contain 'deny'", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const profile = sandbox.generateSeatbeltProfile("full-access", "/tmp");
    expect(profile).not.toContain("deny");
  });
});

// ─── Bwrap Args Generation (Linux) ────────────────────────────────────────────

describe("NativeSandbox — generateBwrapArgs", () => {
  it("read-only args contain --ro-bind and --unshare-net", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const args = sandbox.generateBwrapArgs("read-only", "/tmp");
    expect(args).toContain("--ro-bind");
    expect(args).toContain("--unshare-net");
  });

  it("workspace-write args contain --bind with cwd", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const args = sandbox.generateBwrapArgs("workspace-write", "/project");
    expect(args).toContain("--bind");
    // --bind cwd cwd: both the source and target are cwd
    const bindIdx = args.indexOf("--bind");
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    // Find the --bind that has /project as its argument (not the ro-bind /)
    const bindArgs = args.slice(bindIdx);
    expect(bindArgs).toContain("/project");
  });

  it("workspace-write args contain --unshare-net", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const args = sandbox.generateBwrapArgs("workspace-write", "/project");
    expect(args).toContain("--unshare-net");
  });

  it("full-access args contain --bind /", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const args = sandbox.generateBwrapArgs("full-access", "/tmp");
    // --bind / /
    const bindIdx = args.indexOf("--bind");
    expect(bindIdx).toBeGreaterThanOrEqual(0);
    expect(args[bindIdx + 1]).toBe("/");
    expect(args[bindIdx + 2]).toBe("/");
  });

  it("full-access args do NOT contain --unshare-net", () => {
    const sandbox = new NativeSandbox(process.cwd());
    const args = sandbox.generateBwrapArgs("full-access", "/tmp");
    expect(args).not.toContain("--unshare-net");
  });

  it("all modes include die-with-parent and /dev and /proc base args", () => {
    const sandbox = new NativeSandbox(process.cwd());
    for (const mode of ["read-only", "workspace-write", "full-access"] as const) {
      const args = sandbox.generateBwrapArgs(mode, "/tmp");
      expect(args).toContain("--die-with-parent");
      expect(args).toContain("--dev");
      expect(args).toContain("/dev");
      expect(args).toContain("--proc");
      expect(args).toContain("/proc");
    }
  });
});

// ─── execute() — fallback path (current platform) ─────────────────────────────

describe("NativeSandbox — execute() via executeFallback", () => {
  it("execute() returns an object with required result fields", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ command: "echo hello" });
    const result = await sandbox.execute(req);

    expect(result).toHaveProperty("requestId");
    expect(result).toHaveProperty("exitCode");
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
    expect(result).toHaveProperty("strategy");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("violations");
  });

  it("execute() with 'echo hello' sets stdout containing 'hello'", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ command: "echo hello", requestedMode: "off" });
    // Force fallback by using executeFallback directly
    const result: ExecutionResult = await (sandbox as unknown as { executeFallback(r: ExecutionRequest): Promise<ExecutionResult> }).executeFallback(req);
    expect(result.stdout).toContain("hello");
  });

  it("executeFallback returns exitCode 0 on success", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ command: process.platform === "win32" ? "exit 0" : "true" });
    const result: ExecutionResult = await (sandbox as unknown as { executeFallback(r: ExecutionRequest): Promise<ExecutionResult> }).executeFallback(req);
    expect(result.exitCode).toBe(0);
  });

  it("executeFallback returns non-zero exitCode on failure", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ command: "exit 42" });
    const result: ExecutionResult = await (sandbox as unknown as { executeFallback(r: ExecutionRequest): Promise<ExecutionResult> }).executeFallback(req);
    expect(result.exitCode).not.toBe(0);
  });

  it("execute() result has strategy: 'native'", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ command: "echo test" });
    const result = await sandbox.execute(req);
    expect(result.strategy).toBe("native");
  });

  it("execute() result has violations: []", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ command: "echo test" });
    const result = await sandbox.execute(req);
    expect(result.violations).toEqual([]);
  });

  it("execute() result requestId matches request.id", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ id: "00000000-0000-0000-0000-000000000042", command: "echo test" });
    const result = await sandbox.execute(req);
    expect(result.requestId).toBe("00000000-0000-0000-0000-000000000042");
  });

  it("execute() result durationMs is a non-negative number", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ command: "echo timing" });
    const result = await sandbox.execute(req);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("execute() result timedOut is false for fast commands", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const req = makeRequest({ command: "echo fast", timeoutMs: 10_000 });
    const result = await sandbox.execute(req);
    expect(result.timedOut).toBe(false);
  });
});

// ─── Platform-specific dispatch ────────────────────────────────────────────────

describe("NativeSandbox — platform dispatch", () => {
  it("dispatches to executeMacOS on darwin platform", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const macOSSpy = vi.spyOn(sandbox, "executeMacOS");
    macOSSpy.mockResolvedValue({
      requestId: "00000000-0000-0000-0000-000000000001",
      exitCode: 0,
      stdout: "mocked",
      stderr: "",
      durationMs: 1,
      timedOut: false,
      strategy: "native",
      sandboxed: true,
      violations: [],
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    try {
      const req = makeRequest();
      await sandbox.execute(req);
      expect(macOSSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      macOSSpy.mockRestore();
    }
  });

  it("dispatches to executeLinux on linux platform", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const linuxSpy = vi.spyOn(sandbox, "executeLinux");
    linuxSpy.mockResolvedValue({
      requestId: "00000000-0000-0000-0000-000000000001",
      exitCode: 0,
      stdout: "mocked",
      stderr: "",
      durationMs: 1,
      timedOut: false,
      strategy: "native",
      sandboxed: true,
      violations: [],
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      const req = makeRequest();
      await sandbox.execute(req);
      expect(linuxSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      linuxSpy.mockRestore();
    }
  });

  it("dispatches to executeFallback on win32 platform", async () => {
    const sandbox = new NativeSandbox(process.cwd());
    const fallbackSpy = vi.spyOn(sandbox, "executeFallback");
    fallbackSpy.mockResolvedValue({
      requestId: "00000000-0000-0000-0000-000000000001",
      exitCode: 0,
      stdout: "mocked",
      stderr: "",
      durationMs: 1,
      timedOut: false,
      strategy: "native",
      sandboxed: false,
      violations: [],
    });

    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    try {
      const req = makeRequest();
      await sandbox.execute(req);
      expect(fallbackSpy).toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      fallbackSpy.mockRestore();
    }
  });
});
