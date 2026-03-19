/**
 * execution-policy.test.ts — DTR Phase 6 unit tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  BUILTIN_TOOL_POLICIES,
  ExecutionPolicyRegistry,
  globalExecutionPolicy,
} from "./execution-policy.js";

describe("BUILTIN_TOOL_POLICIES", () => {
  it("has policies for all 16 standard tools", () => {
    const tools = new Set(BUILTIN_TOOL_POLICIES.map((p) => p.tool));
    const expected = [
      "Read", "Glob", "Grep",
      "Write", "Edit", "TodoWrite",
      "Bash",
      "WebSearch", "WebFetch",
      "AcquireUrl", "AcquireArchive",
      "GitCommit", "GitPush",
      "SubAgent", "GitHubSearch", "GitHubOps",
    ];
    for (const t of expected) {
      expect(tools.has(t), `Missing policy for ${t}`).toBe(true);
    }
  });

  it("Read/Glob/Grep are read_only", () => {
    const readOnly = BUILTIN_TOOL_POLICIES.filter((p) => p.executionClass === "read_only");
    const names = readOnly.map((p) => p.tool);
    expect(names).toContain("Read");
    expect(names).toContain("Glob");
    expect(names).toContain("Grep");
  });

  it("Write/Edit are file_write with verifyAfterExecution", () => {
    const write = BUILTIN_TOOL_POLICIES.find((p) => p.tool === "Write")!;
    const edit = BUILTIN_TOOL_POLICIES.find((p) => p.tool === "Edit")!;
    expect(write.executionClass).toBe("file_write");
    expect(write.verifyAfterExecution).toBe(true);
    expect(edit.executionClass).toBe("file_write");
    expect(edit.verifyAfterExecution).toBe(true);
  });

  it("Bash is process class", () => {
    const bash = BUILTIN_TOOL_POLICIES.find((p) => p.tool === "Bash")!;
    expect(bash.executionClass).toBe("process");
  });

  it("AcquireUrl/AcquireArchive are acquire class with verification", () => {
    const url = BUILTIN_TOOL_POLICIES.find((p) => p.tool === "AcquireUrl")!;
    const arch = BUILTIN_TOOL_POLICIES.find((p) => p.tool === "AcquireArchive")!;
    expect(url.executionClass).toBe("acquire");
    expect(url.verifyAfterExecution).toBe(true);
    expect(arch.executionClass).toBe("acquire");
    expect(arch.verifyAfterExecution).toBe(true);
  });

  it("GitCommit depends on Write and Edit", () => {
    const commit = BUILTIN_TOOL_POLICIES.find((p) => p.tool === "GitCommit")!;
    expect(commit.dependsOn).toContain("Write");
    expect(commit.dependsOn).toContain("Edit");
  });

  it("GitPush depends on GitCommit", () => {
    const push = BUILTIN_TOOL_POLICIES.find((p) => p.tool === "GitPush")!;
    expect(push.dependsOn).toContain("GitCommit");
  });
});

describe("ExecutionPolicyRegistry.executionClass", () => {
  let registry: ExecutionPolicyRegistry;

  beforeEach(() => {
    registry = new ExecutionPolicyRegistry();
  });

  it("returns read_only for Read", () => {
    expect(registry.executionClass("Read")).toBe("read_only");
  });

  it("returns process for Bash", () => {
    expect(registry.executionClass("Bash")).toBe("process");
  });

  it("returns acquire for AcquireUrl", () => {
    expect(registry.executionClass("AcquireUrl")).toBe("acquire");
  });

  it("returns vcs for GitCommit", () => {
    expect(registry.executionClass("GitCommit")).toBe("vcs");
  });

  it("returns process fallback for unknown tools", () => {
    expect(registry.executionClass("UnknownTool")).toBe("process");
  });
});

describe("ExecutionPolicyRegistry.canRunConcurrently", () => {
  let registry: ExecutionPolicyRegistry;

  beforeEach(() => {
    registry = new ExecutionPolicyRegistry();
  });

  it("Read and Glob can run concurrently (both read_only)", () => {
    expect(registry.canRunConcurrently("Read", "Glob")).toBe(true);
  });

  it("Read and Write cannot run concurrently", () => {
    expect(registry.canRunConcurrently("Read", "Write")).toBe(false);
  });

  it("Bash and Write cannot run concurrently", () => {
    expect(registry.canRunConcurrently("Bash", "Write")).toBe(false);
  });

  it("Grep and Grep can run concurrently", () => {
    expect(registry.canRunConcurrently("Grep", "Grep")).toBe(true);
  });
});

describe("ExecutionPolicyRegistry.isBlocked", () => {
  let registry: ExecutionPolicyRegistry;

  beforeEach(() => {
    registry = new ExecutionPolicyRegistry();
  });

  it("tool with no blockedBy is never blocked", () => {
    const result = registry.isBlocked("Read", new Set(["Write", "Bash"]));
    expect(result.blocked).toBe(false);
  });

  it("custom blocked tool is blocked when blocker already ran", () => {
    registry.register({
      tool: "GitPush",
      executionClass: "vcs",
      blockedBy: ["FailedBash"],
    });
    const result = registry.isBlocked("GitPush", new Set(["FailedBash"]));
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("FailedBash");
  });

  it("custom blocked tool is not blocked when blocker hasn't run", () => {
    registry.register({
      tool: "GitPush",
      executionClass: "vcs",
      blockedBy: ["FailedBash"],
    });
    const result = registry.isBlocked("GitPush", new Set(["Write", "Edit"]));
    expect(result.blocked).toBe(false);
  });
});

describe("ExecutionPolicyRegistry.dependenciesSatisfied", () => {
  let registry: ExecutionPolicyRegistry;

  beforeEach(() => {
    registry = new ExecutionPolicyRegistry();
  });

  it("tool with no dependsOn is always satisfied", () => {
    const result = registry.dependenciesSatisfied("Bash", new Set<string>());
    expect(result.satisfied).toBe(true);
  });

  it("GitCommit deps satisfied when both Write and Edit ran", () => {
    const result = registry.dependenciesSatisfied("GitCommit", new Set(["Write", "Edit"]));
    expect(result.satisfied).toBe(true);
  });

  it("GitCommit deps not satisfied when neither Write nor Edit ran", () => {
    const result = registry.dependenciesSatisfied("GitCommit", new Set<string>(["Bash"]));
    expect(result.satisfied).toBe(false);
    expect(result.missing).toBeDefined();
    expect(result.missing!.length).toBeGreaterThan(0);
  });

  it("GitPush deps satisfied when GitCommit ran", () => {
    const result = registry.dependenciesSatisfied("GitPush", new Set(["GitCommit"]));
    expect(result.satisfied).toBe(true);
  });
});

describe("ExecutionPolicyRegistry.register", () => {
  it("custom policy overrides builtin", () => {
    const registry = new ExecutionPolicyRegistry();
    registry.register({
      tool: "Bash",
      executionClass: "read_only", // hypothetical override
    });
    expect(registry.executionClass("Bash")).toBe("read_only");
  });

  it("new tool can be registered", () => {
    const registry = new ExecutionPolicyRegistry();
    registry.register({
      tool: "MyCustomTool",
      executionClass: "agent",
      verifyAfterExecution: true,
    });
    expect(registry.executionClass("MyCustomTool")).toBe("agent");
    expect(registry.get("MyCustomTool").verifyAfterExecution).toBe(true);
  });
});

describe("globalExecutionPolicy singleton", () => {
  it("is an ExecutionPolicyRegistry", () => {
    expect(globalExecutionPolicy).toBeInstanceOf(ExecutionPolicyRegistry);
  });

  it("Read is read_only globally", () => {
    expect(globalExecutionPolicy.executionClass("Read")).toBe("read_only");
  });

  it("AcquireUrl is acquire globally", () => {
    expect(globalExecutionPolicy.executionClass("AcquireUrl")).toBe("acquire");
  });
});
