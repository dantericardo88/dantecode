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

function makeRequest(command: string, timeoutMs = 5000): ExecutionRequest {
  return ExecutionRequestSchema.parse({
    id: randomUUID(),
    command,
    args: [],
    cwd: "/tmp",
    env: {},
    taskType: "bash",
    actor: "agent",
    requestedMode: "auto",
    timeoutMs,
  });
}

function createAllowGate(): GateFn {
  return vi.fn().mockResolvedValue({
    requestId: "req-rl",
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

function createTimingOutLayer(): IsolationLayer {
  return {
    strategy: "host" as const,
    isAvailable: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockResolvedValue({
      requestId: "req-rl",
      exitCode: -1,
      stdout: "",
      stderr: "timed out",
      durationMs: 5001,
      timedOut: true,
      strategy: "host",
      sandboxed: false,
      violations: [],
    }),
    teardown: vi.fn().mockResolvedValue(undefined),
  };
}

describe("Resource Limits", () => {
  let engine: SandboxEngine;
  let auditSink: AuditSink;

  beforeEach(() => {
    auditSink = vi.fn();
  });

  it("reports timeout when layer signals timedOut", async () => {
    engine = new SandboxEngine({
      config: { mode: "auto", allowHostEscape: true },
      gateFn: createAllowGate(),
      auditSink,
    });
    engine.registerLayer(createTimingOutLayer());

    const result = await engine.execute(makeRequest("sleep 999", 100));
    expect(result.timedOut).toBe(true);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it("handles layer execution errors gracefully", async () => {
    const errorLayer: IsolationLayer = {
      strategy: "host" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockRejectedValue(new Error("memory limit exceeded")),
      teardown: vi.fn().mockResolvedValue(undefined),
    };

    engine = new SandboxEngine({
      config: { mode: "auto", allowHostEscape: true },
      gateFn: createAllowGate(),
      auditSink,
    });
    engine.registerLayer(errorLayer);

    const result = await engine.execute(makeRequest("heavy-computation"));
    expect(result.exitCode).toBe(-1);
    expect(result.stderr).toContain("memory limit exceeded");
  });

  it("tracks execution count in status", async () => {
    engine = new SandboxEngine({
      config: { mode: "auto", allowHostEscape: true },
      gateFn: createAllowGate(),
      auditSink,
    });
    const layer: IsolationLayer = {
      strategy: "host" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockResolvedValue({
        requestId: "req-rl",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 1,
        timedOut: false,
        strategy: "host",
        sandboxed: false,
        violations: [],
      }),
      teardown: vi.fn().mockResolvedValue(undefined),
    };
    engine.registerLayer(layer);

    await engine.execute(makeRequest("echo 1"));
    await engine.execute(makeRequest("echo 2"));

    const status = await engine.getStatus();
    expect(status.executionCount).toBe(2);
  });

  it("tracks violation count after policy blocks", async () => {
    engine = new SandboxEngine({
      config: { mode: "auto", allowHostEscape: true },
      gateFn: createAllowGate(),
      auditSink,
    });

    // Execute a critical command (policy will block)
    await engine.execute(makeRequest("rm -rf /"));
    const status = await engine.getStatus();
    expect(status.violationCount).toBeGreaterThanOrEqual(1);
  });
});
