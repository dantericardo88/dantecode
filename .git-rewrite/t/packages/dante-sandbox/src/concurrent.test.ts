import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxEngine } from "./sandbox-engine.js";
import type {
  IsolationLayer,
  GateFn,
  AuditSink,
  SandboxDecision,
  ExecutionRequest,
} from "./types.js";
import { ExecutionRequestSchema } from "./types.js";

let callCounter = 0;

function makeRequest(label: string): ExecutionRequest {
  return ExecutionRequestSchema.parse({
    id: randomUUID(),
    command: `echo ${label}`,
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
  return vi.fn().mockImplementation(
    async (req: ExecutionRequest) =>
      ({
        requestId: req.id,
        allow: true,
        strategy: "host",
        reason: "allowed",
        riskLevel: "low",
        gateVerdict: "allow",
        requiresConfirmation: false,
        gateScore: 1.0,
        at: new Date().toISOString(),
      }) satisfies SandboxDecision,
  );
}

describe("Concurrent Sandbox Executions", () => {
  let engine: SandboxEngine;
  let auditSink: AuditSink;

  beforeEach(() => {
    callCounter = 0;
    auditSink = vi.fn();
    engine = new SandboxEngine({
      config: { mode: "auto", allowHostEscape: true },
      gateFn: createAllowGate(),
      auditSink,
    });
  });

  it("handles multiple concurrent executions independently", async () => {
    const layer: IsolationLayer = {
      strategy: "host" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockImplementation(async (req: ExecutionRequest) => {
        callCounter++;
        // Simulate async work
        await new Promise((r) => setTimeout(r, 5));
        return {
          requestId: req.id,
          exitCode: 0,
          stdout: `output-${req.command}`,
          stderr: "",
          durationMs: 5,
          timedOut: false,
          strategy: "host" as const,
          sandboxed: false,
          violations: [],
        };
      }),
      teardown: vi.fn().mockResolvedValue(undefined),
    };
    engine.registerLayer(layer);

    const results = await Promise.all([
      engine.execute(makeRequest("c1")),
      engine.execute(makeRequest("c2")),
      engine.execute(makeRequest("c3")),
    ]);

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.exitCode === 0)).toBe(true);
    expect(results[0]!.stdout).toBe("output-echo c1");
    expect(results[1]!.stdout).toBe("output-echo c2");
    expect(results[2]!.stdout).toBe("output-echo c3");
    expect(callCounter).toBe(3);
  });

  it("concurrent blocked + allowed do not interfere", async () => {
    const layer: IsolationLayer = {
      strategy: "host" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockResolvedValue({
        requestId: "r",
        exitCode: 0,
        stdout: "ok",
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

    const [blocked, allowed] = await Promise.all([
      engine.execute(makeRequest("rm -rf /")),
      engine.execute(makeRequest("echo safe")),
    ]);

    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain("blocked");
    expect(allowed.exitCode).toBe(0);
  });

  it("audit sink receives records for all concurrent executions", async () => {
    const layer: IsolationLayer = {
      strategy: "host" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockResolvedValue({
        requestId: "r",
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

    await Promise.all([engine.execute(makeRequest("cmd-a")), engine.execute(makeRequest("cmd-b"))]);

    expect(auditSink).toHaveBeenCalledTimes(2);
  });
});
