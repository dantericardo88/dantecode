// ============================================================================
// @dantecode/core — SandboxEngine Tests
// 30 tests exercising all public methods via execSyncFn dependency injection.
// No module-level mocking — every test constructs its own engine instance.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { SandboxEngine, type SandboxEngineOptions } from "./sandbox-engine.js";

// ─── Shared fixtures ─────────────────────────────────────────────────────────

function makeEngine(opts: SandboxEngineOptions = {}) {
  const mockExec = vi.fn().mockReturnValue(Buffer.from("output"));
  const engine = new SandboxEngine({
    execSyncFn: mockExec as any,
    ...opts,
  });
  return { engine, mockExec };
}

// ─── Test suites ─────────────────────────────────────────────────────────────

describe("SandboxEngine — create()", () => {
  it("1. returns an instance with idle status", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    expect(instance.status).toBe("idle");
  });

  it("2. merges policy overrides with defaults", () => {
    const { engine } = makeEngine();
    const instance = engine.create("process", {
      allowNetwork: true,
      maxExecutionMs: 5000,
    });
    expect(instance.policy.allowNetwork).toBe(true);
    expect(instance.policy.maxExecutionMs).toBe(5000);
    // Unoverridden fields keep defaults
    expect(instance.policy.allowFileWrite).toBe(true);
    expect(instance.policy.maxOutputBytes).toBe(1024 * 1024);
  });

  it("3. assigns unique IDs to each instance", () => {
    const { engine } = makeEngine();
    const a = engine.create();
    const b = engine.create();
    const c = engine.create();
    const ids = [a.id, b.id, c.id];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  it("23. creates instance with docker mode", () => {
    const { engine } = makeEngine();
    const instance = engine.create("docker");
    expect(instance.mode).toBe("docker");
    expect(instance.status).toBe("idle");
  });

  it("24. creates instance with mock mode", () => {
    const { engine } = makeEngine();
    const instance = engine.create("mock");
    expect(instance.mode).toBe("mock");
  });
});

describe("SandboxEngine — exec()", () => {
  it("4. runs command via execSyncFn", () => {
    const { engine, mockExec } = makeEngine();
    const instance = engine.create();
    engine.exec(instance.id, "echo hello");
    expect(mockExec).toHaveBeenCalledWith(
      "echo hello",
      expect.objectContaining({ encoding: "buffer" }),
    );
  });

  it("5. returns stdout, stderr, and exitCode", () => {
    const mockExec = vi.fn().mockReturnValue(Buffer.from("hello world"));
    const engine = new SandboxEngine({ execSyncFn: mockExec as any });
    const instance = engine.create();
    const result = engine.exec(instance.id, "echo hello world");
    expect(result.stdout).toBe("hello world");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("6. marks instance completed on success", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    engine.exec(instance.id, "echo ok");
    expect(engine.getInstance(instance.id)!.status).toBe("completed");
  });

  it("7. marks instance failed when execSyncFn throws", () => {
    const mockExec = vi.fn().mockImplementation(() => {
      const err = new Error("command failed") as any;
      err.stdout = Buffer.from("");
      err.stderr = Buffer.from("error output");
      err.status = 1;
      throw err;
    });
    const engine = new SandboxEngine({ execSyncFn: mockExec as any });
    const instance = engine.create();
    const result = engine.exec(instance.id, "false");
    expect(engine.getInstance(instance.id)!.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("error output");
  });

  it("8. blocks commands in the blockedCommands list", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    expect(() => engine.exec(instance.id, "rm -rf /")).toThrow(/policy violation/i);
  });

  it("9. truncates output over maxOutputBytes", () => {
    const bigStdout = "x".repeat(200);
    const mockExec = vi.fn().mockReturnValue(Buffer.from(bigStdout));
    const engine = new SandboxEngine({ execSyncFn: mockExec as any });
    const instance = engine.create("process", { maxOutputBytes: 100 });
    const result = engine.exec(instance.id, "echo lots");
    expect(result.truncated).toBe(true);
    expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(100);
  });

  it("10. throws for unknown instance ID", () => {
    const { engine } = makeEngine();
    expect(() => engine.exec("nonexistent-id", "echo hi")).toThrow(/not found/i);
  });

  it("11. throws for destroyed instance", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    engine.destroy(instance.id);
    expect(() => engine.exec(instance.id, "echo hi")).toThrow(/destroyed/i);
  });

  it("27. durationMs is a positive number", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    const result = engine.exec(instance.id, "echo timing");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("30. exec() on completed instance is allowed (re-execution)", () => {
    const { engine, mockExec } = makeEngine();
    const instance = engine.create();
    engine.exec(instance.id, "echo first");
    expect(engine.getInstance(instance.id)!.status).toBe("completed");
    // Second call should not throw
    engine.exec(instance.id, "echo second");
    expect(mockExec).toHaveBeenCalledTimes(2);
  });
});

describe("SandboxEngine — destroy()", () => {
  it("12. marks instance as destroyed", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    engine.destroy(instance.id);
    expect(engine.getInstance(instance.id)!.status).toBe("destroyed");
  });

  it("29. destroy() on already-destroyed instance is idempotent", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    engine.destroy(instance.id);
    expect(() => engine.destroy(instance.id)).not.toThrow();
    expect(engine.getInstance(instance.id)!.status).toBe("destroyed");
  });
});

describe("SandboxEngine — applyPolicies()", () => {
  it("13. returns null for an allowed command", () => {
    const { engine } = makeEngine();
    const instance = engine.create("process", { allowNetwork: true });
    const result = engine.applyPolicies(instance, "echo allowed");
    expect(result).toBeNull();
  });

  it("14. returns violation message for a blocked command", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    const result = engine.applyPolicies(instance, "shutdown now");
    expect(result).not.toBeNull();
    expect(result).toMatch(/shutdown/i);
  });
});

describe("SandboxEngine — isCommandBlocked()", () => {
  it("15. detects rm -rf /", () => {
    const { engine } = makeEngine();
    const policy = engine.create().policy;
    expect(engine.isCommandBlocked("rm -rf /", policy)).toBe(true);
  });

  it("16. detects fork bomb :(){:|:&};:", () => {
    const { engine } = makeEngine();
    const policy = engine.create().policy;
    expect(engine.isCommandBlocked(":(){:|:&};:", policy)).toBe(true);
  });

  it("17. allows safe commands like ls and cat", () => {
    const { engine } = makeEngine();
    const policy = engine.create().policy;
    expect(engine.isCommandBlocked("ls -la", policy)).toBe(false);
    expect(engine.isCommandBlocked("cat README.md", policy)).toBe(false);
  });
});

describe("SandboxEngine — getInstance()", () => {
  it("18. returns the instance for a known ID", () => {
    const { engine } = makeEngine();
    const instance = engine.create();
    const retrieved = engine.getInstance(instance.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(instance.id);
  });

  it("19. returns undefined for an unknown ID", () => {
    const { engine } = makeEngine();
    expect(engine.getInstance("does-not-exist")).toBeUndefined();
  });
});

describe("SandboxEngine — listInstances()", () => {
  it("20. returns all instances when no status filter is applied", () => {
    const { engine } = makeEngine();
    engine.create();
    engine.create();
    engine.create();
    expect(engine.listInstances()).toHaveLength(3);
  });

  it("21. filters instances by status", () => {
    const { engine } = makeEngine();
    const a = engine.create();
    const b = engine.create();
    engine.create(); // stays idle
    engine.exec(a.id, "echo ok"); // → completed
    engine.destroy(b.id); // → destroyed
    const idleList = engine.listInstances("idle");
    expect(idleList).toHaveLength(1);
    const completedList = engine.listInstances("completed");
    expect(completedList).toHaveLength(1);
    const destroyedList = engine.listInstances("destroyed");
    expect(destroyedList).toHaveLength(1);
  });
});

describe("SandboxEngine — getStats()", () => {
  it("22. counts instances by status correctly", () => {
    const { engine } = makeEngine();
    const a = engine.create();
    const b = engine.create();
    engine.create(); // stays idle

    engine.exec(a.id, "echo ok"); // → completed

    const failExec = vi.fn().mockImplementation(() => {
      const err = new Error("fail") as any;
      err.stdout = Buffer.from("");
      err.stderr = Buffer.from("err");
      err.status = 1;
      throw err;
    });
    const engineB = new SandboxEngine({ execSyncFn: failExec as any });
    const bInst = engineB.create();
    engineB.exec(bInst.id, "false"); // → failed on engineB

    engine.destroy(b.id); // → destroyed

    const stats = engine.getStats();
    expect(stats.total).toBe(3);
    expect(stats.idle).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.destroyed).toBe(1);
    expect(stats.running).toBe(0);

    // Verify the failing engine separately
    const statsB = engineB.getStats();
    expect(statsB.failed).toBe(1);
  });
});

describe("SandboxEngine — Network policy", () => {
  it("25. allowNetwork=false blocks curl", () => {
    const { engine } = makeEngine();
    const instance = engine.create("process", { allowNetwork: false });
    expect(() => engine.exec(instance.id, "curl https://example.com")).toThrow(
      /network access is disabled/i,
    );
  });
});

describe("SandboxEngine — Custom policy", () => {
  it("26. custom blockedCommands list is respected", () => {
    const { engine } = makeEngine();
    const instance = engine.create("process", {
      blockedCommands: ["forbidden-tool"],
    });
    expect(() => engine.exec(instance.id, "forbidden-tool --do-evil")).toThrow(/policy violation/i);
    // Verify a default blocked command is NOT blocked (custom list replaces defaults)
    // The custom blockedCommands replaces the default list entirely
    const result = engine.applyPolicies(
      engine.create("process", { blockedCommands: ["forbidden-tool"] }),
      "shutdown now",
    );
    // With the custom policy "shutdown" is no longer blocked
    expect(result).toBeNull();
  });
});

describe("SandboxEngine — Multiple instances independence", () => {
  it("28. multiple instances do not share state", () => {
    const { engine } = makeEngine();
    const a = engine.create();
    const b = engine.create();

    engine.exec(a.id, "echo from-a");
    // a is completed, b is still idle
    expect(engine.getInstance(a.id)!.status).toBe("completed");
    expect(engine.getInstance(b.id)!.status).toBe("idle");

    engine.destroy(b.id);
    // destroying b does not affect a
    expect(engine.getInstance(a.id)!.status).toBe("completed");
    expect(engine.getInstance(b.id)!.status).toBe("destroyed");
  });
});
