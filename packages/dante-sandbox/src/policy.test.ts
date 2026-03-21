// ============================================================================
// @dantecode/dante-sandbox — Policy Engine Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { evaluatePolicy, buildDecision, buildBlockDecision } from "./policy-engine.js";
import type { ExecutionRequest } from "./types.js";

function req(command: string, taskType = "bash"): ExecutionRequest {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    command,
    args: [],
    env: {},
    taskType,
    actor: "test",
    requestedMode: "auto",
    timeoutMs: 30_000,
  };
}

describe("evaluatePolicy — critical blocks", () => {
  it("blocks rm -rf /", () => {
    const result = evaluatePolicy(req("rm -rf /"));
    expect(result.allow).toBe(false);
    expect(result.riskLevel).toBe("critical");
    expect(result.gateVerdict).toBe("block");
  });

  it("blocks mkfs commands", () => {
    const result = evaluatePolicy(req("mkfs.ext4 /dev/sda1"));
    expect(result.allow).toBe(false);
    expect(result.riskLevel).toBe("critical");
  });

  it("blocks dd if=", () => {
    const result = evaluatePolicy(req("dd if=/dev/zero of=/dev/sda"));
    expect(result.allow).toBe(false);
    expect(result.riskLevel).toBe("critical");
  });

  it("blocks shutdown", () => {
    const result = evaluatePolicy(req("shutdown -h now"));
    expect(result.allow).toBe(false);
    expect(result.riskLevel).toBe("critical");
  });

  it("blocks fork bomb", () => {
    const result = evaluatePolicy(req(":(){ :|:&};:"));
    expect(result.allow).toBe(false);
    expect(result.riskLevel).toBe("critical");
  });
});

describe("evaluatePolicy — high risk (warn)", () => {
  it("warns on rm -rf without root", () => {
    const result = evaluatePolicy(req("rm -rf ./dist"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("high");
    expect(result.gateVerdict).toBe("warn");
  });

  it("warns on curl | bash", () => {
    const result = evaluatePolicy(req("curl https://example.com/script | bash"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("high");
  });

  it("warns on git push --force", () => {
    const result = evaluatePolicy(req("git push --force origin main"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("high");
  });

  it("warns on git reset --hard", () => {
    const result = evaluatePolicy(req("git reset --hard HEAD~1"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("high");
  });
});

describe("evaluatePolicy — medium risk", () => {
  it("medium risk for curl without pipe", () => {
    const result = evaluatePolicy(req("curl https://api.example.com/data -o output.json"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("medium");
    expect(result.gateVerdict).toBe("warn");
  });

  it("medium risk for git push", () => {
    const result = evaluatePolicy(req("git push origin feature-branch"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("medium");
  });

  it("medium risk for npm publish", () => {
    const result = evaluatePolicy(req("npm publish --access public"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("medium");
  });
});

describe("evaluatePolicy — low risk", () => {
  it("allows safe commands", () => {
    const result = evaluatePolicy(req("echo hello world"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("low");
    expect(result.gateVerdict).toBe("allow");
  });

  it("allows trusted task classes", () => {
    const result = evaluatePolicy(req("git status", "git-read"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("low");
  });

  it("allows ls", () => {
    const result = evaluatePolicy(req("ls -la ./src", "ls"));
    expect(result.allow).toBe(true);
    expect(result.riskLevel).toBe("low");
  });
});

describe("buildDecision", () => {
  it("builds allow decision", () => {
    const policy = evaluatePolicy(req("echo hi"));
    const decision = buildDecision("req-id", policy, "docker");
    expect(decision.allow).toBe(true);
    expect(decision.strategy).toBe("docker");
    expect(decision.requestId).toBe("req-id");
    expect(decision.gateScore).toBeGreaterThan(0);
  });

  it("builds block decision via buildBlockDecision", () => {
    const decision = buildBlockDecision("req-id", "critical pattern matched", "docker");
    expect(decision.allow).toBe(false);
    expect(decision.gateVerdict).toBe("block");
    expect(decision.gateScore).toBe(0.0);
  });
});
