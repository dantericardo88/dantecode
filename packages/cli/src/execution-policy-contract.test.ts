import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("CLI execution policy delegation contract", () => {
  const agentLoopSource = readFileSync(new URL("./agent-loop.ts", import.meta.url), "utf8");
  const bannerSource = readFileSync(new URL("./banner.ts", import.meta.url), "utf8");
  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const replSource = readFileSync(new URL("./repl.ts", import.meta.url), "utf8");
  const toolExecutorSource = readFileSync(new URL("./tool-executor.ts", import.meta.url), "utf8");

  it("routes no-tool and completion decisions through ExecutionPolicyEngine", () => {
    expect(agentLoopSource).toContain("ExecutionPolicyEngine");
    expect(agentLoopSource).toContain("executionPolicy.evaluateNoToolResponse(");
    expect(agentLoopSource).toContain("executionPolicy.verifyWorkflowCompletion(");
    expect(agentLoopSource).toContain("executionPolicy.snapshot()");
  });

  it("routes retry decisions through the injected execution policy instead of global state", () => {
    expect(toolExecutorSource).toContain("ctx.executionPolicy.assessToolCall(");
    expect(toolExecutorSource).toContain("ctx.executionPolicy.recordToolResult(");
    expect(toolExecutorSource).not.toContain("globalRetryDetector");
  });

  it("removes local duplicated execution-control instantiations from the hot path", () => {
    expect(agentLoopSource).not.toContain("new RetryDetector(");
    expect(agentLoopSource).not.toContain("new VerificationGates(");
    expect(agentLoopSource).not.toContain("new StatusTracker(");
  });

  it("advertises and wires the explicit benchmark execution profile", () => {
    expect(bannerSource).toContain("--execution-profile <name>");
    expect(indexSource).toContain("--execution-profile");
    expect(replSource).toContain("executionProfile?: ExecutionProfile");
    expect(replSource).toContain('options.executionProfile === "benchmark"');
    expect(agentLoopSource).toContain('config.executionProfile === "benchmark"');
  });
});
