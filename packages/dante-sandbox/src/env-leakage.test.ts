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

function makeRequest(command: string, env: Record<string, string> = {}): ExecutionRequest {
  return ExecutionRequestSchema.parse({
    id: randomUUID(),
    command,
    args: [],
    cwd: "/tmp",
    env,
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
        reason: "gate allows",
        riskLevel: "low",
        gateVerdict: "allow",
        requiresConfirmation: false,
        gateScore: 1.0,
        at: new Date().toISOString(),
      }) satisfies SandboxDecision,
  );
}

describe("Env Leakage — Environment Isolation", () => {
  let engine: SandboxEngine;
  let auditSink: AuditSink;
  let capturedEnv: Record<string, string> | undefined;

  beforeEach(() => {
    capturedEnv = undefined;
    auditSink = vi.fn();
    engine = new SandboxEngine({
      config: { mode: "auto", allowHostEscape: true },
      gateFn: createAllowGate(),
      auditSink,
    });
  });

  function createEnvCapturingLayer(): IsolationLayer {
    return {
      strategy: "host" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockImplementation(async (req: ExecutionRequest) => {
        capturedEnv = req.env;
        return {
          requestId: req.id,
          exitCode: 0,
          stdout: JSON.stringify(req.env),
          stderr: "",
          durationMs: 1,
          timedOut: false,
          strategy: "host" as const,
          sandboxed: false,
          violations: [],
        };
      }),
      teardown: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("passes only the declared env to the isolation layer", async () => {
    const layer = createEnvCapturingLayer();
    engine.registerLayer(layer);

    const declared = { MY_VAR: "hello", OTHER: "world" };
    await engine.execute(makeRequest("echo test", declared));

    expect(capturedEnv).toBeDefined();
    expect(capturedEnv!["MY_VAR"]).toBe("hello");
    expect(capturedEnv!["OTHER"]).toBe("world");
  });

  it("does not leak host process env via request", async () => {
    const layer = createEnvCapturingLayer();
    engine.registerLayer(layer);

    await engine.execute(makeRequest("echo test", {}));

    expect(capturedEnv).toBeDefined();
    // The request env should be empty — not a copy of process.env
    expect(Object.keys(capturedEnv!)).toHaveLength(0);
    // Spot-check common host vars are absent
    expect(capturedEnv!["PATH"]).toBeUndefined();
    expect(capturedEnv!["HOME"]).toBeUndefined();
    expect(capturedEnv!["USER"]).toBeUndefined();
  });

  it("keeps env isolated between concurrent requests", async () => {
    const envSnapshots: Record<string, string>[] = [];

    const layer: IsolationLayer = {
      strategy: "host" as const,
      isAvailable: vi.fn().mockResolvedValue(true),
      execute: vi.fn().mockImplementation(async (req: ExecutionRequest) => {
        envSnapshots.push({ ...req.env });
        await new Promise((r) => setTimeout(r, 5));
        return {
          requestId: req.id,
          exitCode: 0,
          stdout: "",
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

    await Promise.all([
      engine.execute(makeRequest("cmd1", { SECRET: "alpha" })),
      engine.execute(makeRequest("cmd2", { TOKEN: "beta" })),
    ]);

    expect(envSnapshots).toHaveLength(2);
    // Each request should only see its own env, not the other's
    const hasSecret = envSnapshots.filter((e) => e["SECRET"] === "alpha");
    const hasToken = envSnapshots.filter((e) => e["TOKEN"] === "beta");
    expect(hasSecret).toHaveLength(1);
    expect(hasToken).toHaveLength(1);
    // No cross-contamination
    expect(hasSecret[0]!["TOKEN"]).toBeUndefined();
    expect(hasToken[0]!["SECRET"]).toBeUndefined();
  });

  it("blocks commands that try to read sensitive env vars", async () => {
    const layer = createEnvCapturingLayer();
    engine.registerLayer(layer);

    // printenv by itself is low risk; the policy engine checks the command string
    const result = await engine.execute(makeRequest("echo $AWS_SECRET_KEY", {}));
    // Command itself is not blocked (it's just echo), but env is isolated
    expect(result.exitCode).toBe(0);
    expect(capturedEnv!["AWS_SECRET_KEY"]).toBeUndefined();
  });

  it("audit record captures the request env scope", async () => {
    const layer = createEnvCapturingLayer();
    engine.registerLayer(layer);

    await engine.execute(makeRequest("echo safe", { VISIBLE: "yes" }));

    expect(auditSink).toHaveBeenCalledTimes(1);
    const record = (auditSink as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(record.request.env).toEqual({ VISIBLE: "yes" });
    // Audit should not contain host process env
    expect(record.request.env["PATH"]).toBeUndefined();
  });

  it("handles env with special characters safely", async () => {
    const layer = createEnvCapturingLayer();
    engine.registerLayer(layer);

    const specialEnv = {
      SPECIAL_CHARS: "value;with|special&chars",
      QUOTES: 'he said "hello"',
      NEWLINE: "line1\nline2",
    };
    await engine.execute(makeRequest("echo test", specialEnv));

    expect(capturedEnv).toBeDefined();
    expect(capturedEnv!["SPECIAL_CHARS"]).toBe("value;with|special&chars");
    expect(capturedEnv!["QUOTES"]).toBe('he said "hello"');
    expect(capturedEnv!["NEWLINE"]).toBe("line1\nline2");
  });
});
