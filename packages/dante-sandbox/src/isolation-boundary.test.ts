import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxEngine } from "./sandbox-engine.js";
import type {
  ExecutionRequest,
  SandboxDecision,
  IsolationLayer,
  GateFn,
  AuditSink,
} from "./types.js";
import { ExecutionRequestSchema } from "./types.js";

function makeRequest(command: string): ExecutionRequest {
  return ExecutionRequestSchema.parse({
    id: randomUUID(),
    command,
    args: [],
    cwd: "/tmp",
    env: {},
    taskType: "bash",
    actor: "agent",
    requestedMode: "auto",
    timeoutMs: 5000,
  });
}

function createAllowGate(): GateFn {
  return vi.fn().mockResolvedValue({
    requestId: "req-iso",
    allow: true,
    strategy: "host",
    reason: "gate allows",
    riskLevel: "low",
    gateVerdict: "allow",
    requiresConfirmation: false,
    gateScore: 1.0,
    at: new Date().toISOString(),
  } satisfies SandboxDecision);
}

function createMockLayer(strategy: "host" | "docker" | "worktree" | "native"): IsolationLayer {
  return {
    strategy,
    isAvailable: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockResolvedValue({
      requestId: "req-iso",
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      durationMs: 10,
      timedOut: false,
      strategy,
      sandboxed: strategy !== "host",
      violations: [],
    }),
    teardown: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Isolation Boundary", () => {
  let engine: SandboxEngine;
  let gate: GateFn;
  let auditSink: AuditSink;

  beforeEach(() => {
    gate = createAllowGate();
    auditSink = vi.fn();
    engine = new SandboxEngine({
      config: { mode: "auto", allowHostEscape: true },
      gateFn: gate,
      auditSink,
    });
  });

  it("blocks execution when no isolation layer is registered", async () => {
    const result = await engine.execute(makeRequest("echo hello"));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No isolation layer");
  });

  it("routes through registered layer on allowed command", async () => {
    const hostLayer = createMockLayer("host");
    engine.registerLayer(hostLayer);
    const result = await engine.execute(makeRequest("echo hello"));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("ok");
    expect(hostLayer.execute).toHaveBeenCalled();
  });

  it("blocks critical commands even with registered layer", async () => {
    engine.registerLayer(createMockLayer("host"));
    const result = await engine.execute(makeRequest("rm -rf /"));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("blocked");
  });

  it("records audit for every execution attempt", async () => {
    engine.registerLayer(createMockLayer("host"));
    await engine.execute(makeRequest("echo hello"));
    expect(auditSink).toHaveBeenCalled();
  });

  it("blocks host execution when allowHostEscape is false", async () => {
    const strictEngine = new SandboxEngine({
      config: { mode: "host-escape", allowHostEscape: false },
      gateFn: gate,
      auditSink,
    });
    strictEngine.registerLayer(createMockLayer("host"));
    const result = await strictEngine.execute(makeRequest("echo safe"));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Host execution is not permitted");
  });

  it("teardown cleans up all registered layers", async () => {
    const layer = createMockLayer("host");
    engine.registerLayer(layer);
    await engine.teardown();
    expect(layer.teardown).toHaveBeenCalled();
  });
});
