import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SandboxEngine } from "./sandbox-engine.js";
import type { IsolationLayer, GateFn, AuditSink, SandboxDecision } from "./types.js";

function createAllowGate(): GateFn {
  return vi.fn().mockResolvedValue({
    requestId: "req",
    allow: true,
    strategy: "host",
    reason: "allowed",
    riskLevel: "low",
    gateVerdict: "allow",
    requiresConfirmation: false,
    gateScore: 1.0,
    at: new Date().toISOString(),
  } satisfies SandboxDecision);
}

describe("Cleanup — Resource Release", () => {
  let engine: SandboxEngine;
  let auditSink: AuditSink;

  beforeEach(() => {
    auditSink = vi.fn();
    engine = new SandboxEngine({
      config: { mode: "auto", allowHostEscape: true },
      gateFn: createAllowGate(),
      auditSink,
    });
  });

  it("calls teardown on all registered layers", async () => {
    const layer1: IsolationLayer = {
      strategy: "docker" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
      teardown: vi.fn().mockResolvedValue(undefined),
    };
    const layer2: IsolationLayer = {
      strategy: "worktree" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
      teardown: vi.fn().mockResolvedValue(undefined),
    };

    engine.registerLayer(layer1);
    engine.registerLayer(layer2);
    await engine.teardown();

    expect(layer1.teardown).toHaveBeenCalled();
    expect(layer2.teardown).toHaveBeenCalled();
  });

  it("handles teardown errors gracefully", async () => {
    const failingLayer: IsolationLayer = {
      strategy: "docker" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn(),
      teardown: vi.fn().mockRejectedValue(new Error("docker cleanup failed")),
    };

    engine.registerLayer(failingLayer);
    // Should not throw
    await expect(engine.teardown()).resolves.toBeUndefined();
  });

  it("clears layers after teardown", async () => {
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
    await engine.teardown();

    // After teardown, layers are cleared — should get "no layer" error
    const { ExecutionRequestSchema } = await import("./types.js");
    const req = ExecutionRequestSchema.parse({
      id: randomUUID(),
      command: "echo hi",
      args: [],
      cwd: "/tmp",
      env: {},
      taskType: "bash",
      actor: "agent",
      requestedMode: "auto",
      timeoutMs: 5000,
    });

    const result = await engine.execute(req);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No isolation layer");
  });
});
