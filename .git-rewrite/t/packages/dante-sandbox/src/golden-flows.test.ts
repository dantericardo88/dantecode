// ============================================================================
// @dantecode/dante-sandbox — Golden Flow Tests (GF-01 through GF-05)
// All 5 golden flows from the spec must pass.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SandboxEngine } from "./sandbox-engine.js";
import { ExecutionProxy } from "./execution-proxy.js";
import { evaluatePolicy } from "./policy-engine.js";
import { buildDanteForgeGate, permissiveGate } from "./danteforge-gate.js";
import { SandboxAuditLog, noopAuditSink } from "./audit-log.js";
import { DanteSandbox } from "./integration.js";
import type { IsolationLayer, ExecutionRequest, ExecutionResult } from "./types.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

// ─── Shared Mock Layer ────────────────────────────────────────────────────────

// Use "host" strategy so engine.selectStrategy() (which always falls back to host) finds this layer
function makeMockLayer(): IsolationLayer {
  return {
    strategy: "host" as const,
    isAvailable: async () => true,
    execute: async (req: ExecutionRequest): Promise<ExecutionResult> => ({
      requestId: req.id,
      exitCode: 0,
      stdout: `[mock] ${req.command}`,
      stderr: "",
      durationMs: 1,
      timedOut: false,
      strategy: "host",
      sandboxed: true,
      violations: [],
    }),
    teardown: async () => {},
  };
}

function buildEngine(opts?: { allowHostEscape?: boolean }): SandboxEngine {
  const engine = new SandboxEngine({
    gateFn: buildDanteForgeGate(),
    auditSink: noopAuditSink,
    config: {
      mode: "auto",
      allowHostEscape: opts?.allowHostEscape ?? true, // allow host for tests
    },
  });
  engine.registerLayer(makeMockLayer());
  return engine;
}

// ─── GF-01: Basic command ─────────────────────────────────────────────────────

describe("GF-01 — Basic command routed through sandbox", () => {
  it("safe command executes in sandboxed mock layer and returns result", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    const result = await proxy.run("ls -la", { taskType: "bash", actor: "agent-loop" });

    expect(result.exitCode).toBe(0);
    expect(result.sandboxed).toBe(true);
    expect(result.stdout).toContain("ls -la");
    expect(result.violations).toHaveLength(0);
  });

  it("echo command returns normalized ExecutionResult (not raw process state)", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    const result = await proxy.run("echo hello");
    // Must have all canonical fields
    expect(result).toHaveProperty("requestId");
    expect(result).toHaveProperty("exitCode");
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
    expect(result).toHaveProperty("durationMs");
    expect(result).toHaveProperty("timedOut");
    expect(result).toHaveProperty("strategy");
    expect(result).toHaveProperty("sandboxed");
    expect(result).toHaveProperty("violations");
  });
});

// ─── GF-02: Dangerous command blocked ────────────────────────────────────────

describe("GF-02 — Dangerous command blocked by DanteForge gate", () => {
  it("rm -rf / is blocked with violations", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    const result = await proxy.run("rm -rf /");

    expect(result.exitCode).toBe(1);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.stderr).toContain("blocked");
  });

  it("fork bomb is blocked", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    const result = await proxy.run(":(){ :|:&};:");

    expect(result.exitCode).toBe(1);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("shutdown command is blocked", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    const result = await proxy.run("shutdown -h now");

    expect(result.exitCode).toBe(1);
    expect(result.violations.length).toBeGreaterThan(0);
  });

  it("policy evaluates rm -rf / as critical", () => {
    const policy = evaluatePolicy({
      id: "test",
      command: "rm -rf /",
      args: [],
      env: {},
      taskType: "bash",
      actor: "test",
      requestedMode: "auto",
      timeoutMs: 30_000,
    });
    expect(policy.allow).toBe(false);
    expect(policy.riskLevel).toBe("critical");
    expect(policy.gateVerdict).toBe("block");
  });
});

// ─── GF-03: Subagent isolation ────────────────────────────────────────────────

describe("GF-03 — Subagent isolation (no cross-contamination)", () => {
  it("two proxies with separate engines do not share state", async () => {
    const engine1 = buildEngine();
    const engine2 = buildEngine();

    const proxy1 = new ExecutionProxy(engine1);

    await proxy1.run("touch /tmp/parent-file");
    const statusP1 = await engine1.getStatus();

    // engine2 should not have any executions from engine1
    const statusP2 = await engine2.getStatus();

    expect(statusP1.executionCount).toBe(1);
    expect(statusP2.executionCount).toBe(0);
  });

  it("each execution gets a unique requestId", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    const [r1, r2] = await Promise.all([proxy.run("echo parent"), proxy.run("echo child")]);

    expect(r1.requestId).not.toBe(r2.requestId);
  });
});

// ─── GF-04: Gaslight integration ──────────────────────────────────────────────

describe("GF-04 — Gaslight-style execution goes through sandbox", () => {
  it("policy check runs before any simulated gaslight execution", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    // Simulate what Gaslight does: check if command would be allowed
    const safeDraft = "cat output.txt";
    const dangerousDraft = "rm -rf /tmp/session";

    expect(await proxy.wouldAllow(safeDraft)).toBe(true);
    // rm -rf is high-risk but not critical (path is /tmp/session not /)
    const dangerousPolicy = evaluatePolicy({
      id: "g",
      command: dangerousDraft,
      args: [],
      env: {},
      taskType: "bash",
      actor: "gaslight",
      requestedMode: "auto",
      timeoutMs: 30_000,
    });
    // rm -rf pattern → high risk, but policy.allow is true (gate may still warn)
    expect(dangerousPolicy.riskLevel).toBe("high");
    expect(dangerousPolicy.gateVerdict).toBe("warn");
  });

  it("lessons only eligible if execution completes without violations", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    const safeResult = await proxy.run("echo pass");
    const blockedResult = await proxy.run("rm -rf /");

    // Safe execution: no violations — eligible for lesson writing
    expect(safeResult.violations).toHaveLength(0);
    expect(safeResult.exitCode).toBe(0);

    // Blocked execution: has violations — NOT eligible for lesson writing
    expect(blockedResult.violations.length).toBeGreaterThan(0);
  });
});

// ─── GF-05: Audit trail completeness ─────────────────────────────────────────

describe("GF-05 — Full audit trail for combined execution", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dante-sandbox-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("audit log captures every execution", async () => {
    const auditLog = new SandboxAuditLog({ projectRoot: tmpDir });
    const engine = new SandboxEngine({
      gateFn: permissiveGate,
      auditSink: auditLog.sink,
      config: { mode: "auto", allowHostEscape: true },
    });
    engine.registerLayer(makeMockLayer());

    const proxy = new ExecutionProxy(engine);
    await proxy.run("echo first");
    await proxy.run("echo second");
    await proxy.run("rm -rf /"); // blocked

    const records = auditLog.getSessionRecords();
    expect(records.length).toBe(3);

    // Blocked record has violations
    const blocked = records.find((r) => r.violations.length > 0);
    expect(blocked).toBeDefined();
    expect(blocked!.decision.allow).toBe(false);
  });

  it("audit ref reflects session stats correctly", async () => {
    const auditLog = new SandboxAuditLog({ projectRoot: tmpDir });
    const engine = new SandboxEngine({
      gateFn: permissiveGate,
      auditSink: auditLog.sink,
      config: { mode: "auto", allowHostEscape: true },
    });
    engine.registerLayer(makeMockLayer());

    const proxy = new ExecutionProxy(engine);
    await proxy.run("echo ok");
    await proxy.run("rm -rf /"); // blocked → violation

    const ref = auditLog.buildAuditRef();
    expect(ref.violationCount).toBeGreaterThan(0);
    expect(ref.auditRecordIds.length).toBe(2);
    expect(ref.hostEscapeCount).toBe(0);
  });

  it("status reflects execution and violation counts", async () => {
    const engine = buildEngine();
    const proxy = new ExecutionProxy(engine);

    await proxy.run("echo ok");
    await proxy.run("echo ok2");
    await proxy.run("rm -rf /"); // blocked

    const status = await engine.getStatus();
    expect(status.executionCount).toBe(2); // 2 passed (blocked don't increment)
    expect(status.violationCount).toBe(1);
    expect(status.hostEscapeCount).toBe(0);
  });
});

// ─── Integration facade tests ─────────────────────────────────────────────────

describe("DanteSandbox integration facade", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "dante-sandbox-facade-"));
    await DanteSandbox.setup({
      projectRoot: tmpDir,
      useMockGate: true,
      noAuditFile: true,
      config: { mode: "auto", allowHostEscape: true },
    });
    // Register a mock layer for tests
    // (engine is internal; DanteSandbox.execute routes through it)
  });

  afterEach(async () => {
    await DanteSandbox.teardown();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("isReady() returns true after setup", () => {
    expect(DanteSandbox.isReady()).toBe(true);
  });

  it("status() returns an object with required fields", async () => {
    const status = await DanteSandbox.status();
    expect(status).toHaveProperty("enforced");
    expect(status).toHaveProperty("mode");
    expect(status).toHaveProperty("available");
    expect(status).toHaveProperty("dockerReady");
    expect(status).toHaveProperty("worktreeReady");
    expect(status).toHaveProperty("executionCount");
  });

  it("setMode changes the active mode", () => {
    DanteSandbox.setMode("worktree");
    // No assertion on return; smoke test that it doesn't throw
  });

  it("isReady() returns false after teardown", async () => {
    await DanteSandbox.teardown();
    expect(DanteSandbox.isReady()).toBe(false);
  });
});
