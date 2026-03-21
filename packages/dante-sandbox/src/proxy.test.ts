// ============================================================================
// @dantecode/dante-sandbox — Execution Proxy Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { ExecutionProxy, toToolResult } from "./execution-proxy.js";
import { SandboxEngine } from "./sandbox-engine.js";
import { permissiveGate } from "./danteforge-gate.js";
import { noopAuditSink } from "./audit-log.js";
import type { IsolationLayer, ExecutionRequest, ExecutionResult } from "./types.js";
import { randomUUID } from "node:crypto";

// ─── Mock Isolation Layer ─────────────────────────────────────────────────────

// Use "host" strategy so the engine's selectStrategy() (which always falls back to host) finds it
function makeMockLayer(exitCode = 0): IsolationLayer {
  return {
    strategy: "host" as const,
    isAvailable: async () => true,
    execute: async (req: ExecutionRequest): Promise<ExecutionResult> => ({
      requestId: req.id,
      exitCode,
      stdout: `mock output: ${req.command}`,
      stderr: exitCode !== 0 ? "mock error" : "",
      durationMs: 1,
      timedOut: false,
      strategy: "host",
      sandboxed: true,
      violations: [],
    }),
    teardown: async () => {},
  };
}

function makeEngine(exitCode = 0): SandboxEngine {
  const engine = new SandboxEngine({
    gateFn: permissiveGate,
    auditSink: noopAuditSink,
    config: { mode: "auto", allowHostEscape: true },
  });
  engine.registerLayer(makeMockLayer(exitCode));
  return engine;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ExecutionProxy.run", () => {
  it("executes a command and returns a result", async () => {
    const proxy = new ExecutionProxy(makeEngine());
    const result = await proxy.run("echo hello", { taskType: "bash" });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("echo hello");
    expect(result.sandboxed).toBe(true);
  });

  it("populates requestId on result", async () => {
    const proxy = new ExecutionProxy(makeEngine());
    const result = await proxy.run("ls");
    expect(result.requestId).toBeTruthy();
  });

  it("applies taskType from options", async () => {
    const proxy = new ExecutionProxy(makeEngine());
    // git-read is trusted class → low risk
    const result = await proxy.run("git status", { taskType: "git-read" });
    expect(result.exitCode).toBe(0);
  });
});

describe("ExecutionProxy.runSync", () => {
  it("returns stdout on success", async () => {
    const proxy = new ExecutionProxy(makeEngine(0));
    const stdout = await proxy.runSync("echo hello");
    expect(stdout).toContain("echo hello");
  });

  it("throws on non-zero exit", async () => {
    const proxy = new ExecutionProxy(makeEngine(1));
    await expect(proxy.runSync("failing command")).rejects.toThrow();
  });
});

describe("ExecutionProxy.runBatch", () => {
  it("runs multiple commands and stops on failure", async () => {
    const engine = new SandboxEngine({
      gateFn: permissiveGate,
      auditSink: noopAuditSink,
      config: { mode: "auto", allowHostEscape: true },
    });

    let callCount = 0;
    engine.registerLayer({
      strategy: "host" as const, // must match selectStrategy() fallback
      isAvailable: async () => true,
      execute: async (req: ExecutionRequest): Promise<ExecutionResult> => {
        callCount++;
        const code = callCount === 2 ? 1 : 0;
        return {
          requestId: req.id,
          exitCode: code,
          stdout: `cmd-${callCount}`,
          stderr: "",
          durationMs: 0,
          timedOut: false,
          strategy: "host",
          sandboxed: true,
          violations: [],
        };
      },
      teardown: async () => {},
    });

    const proxy = new ExecutionProxy(engine);
    const batch = await proxy.runBatch(["cmd1", "cmd2", "cmd3"]);

    // Stops after first failure (cmd2)
    expect(batch.length).toBe(2);
    expect(batch.at(0)?.exitCode).toBe(0);
    expect(batch.at(1)?.exitCode).toBe(1);
  });
});

describe("ExecutionProxy.wouldAllow", () => {
  it("returns true for safe commands", async () => {
    const proxy = new ExecutionProxy(makeEngine());
    expect(await proxy.wouldAllow("echo hi")).toBe(true);
  });

  it("returns false for critical commands", async () => {
    const proxy = new ExecutionProxy(makeEngine());
    expect(await proxy.wouldAllow("rm -rf /")).toBe(false);
  });
});

describe("toToolResult", () => {
  const base: ExecutionResult = {
    requestId: randomUUID(),
    exitCode: 0,
    stdout: "hello",
    stderr: "",
    durationMs: 10,
    timedOut: false,
    strategy: "docker",
    sandboxed: true,
    violations: [],
  };

  it("returns content and isError:false on success", () => {
    const r = toToolResult(base);
    expect(r.content).toContain("hello");
    expect(r.isError).toBe(false);
  });

  it("returns isError:true on non-zero exit", () => {
    const r = toToolResult({ ...base, exitCode: 1, stderr: "fail" });
    expect(r.isError).toBe(true);
  });

  it("returns isError:true on timeout", () => {
    const r = toToolResult({ ...base, timedOut: true });
    expect(r.isError).toBe(true);
    expect(r.content).toContain("timed out");
  });

  it("returns isError:true on violations", () => {
    const r = toToolResult({ ...base, violations: ["blocked: rm -rf /"] });
    expect(r.isError).toBe(true);
  });
});
