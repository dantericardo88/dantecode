import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitBridge } from "./git-bridge.js";
import type { AuditLogger } from "../audit-logger.js";

vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

vi.mock("node:util", () => ({
  promisify: (fn: unknown) => {
    return async (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        (fn as Function)(...args, (err: Error | null, result: unknown) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    };
  },
}));

function createMockLogger(): AuditLogger {
  return {
    log: vi.fn().mockResolvedValue("evt-1"),
    getProvenance: vi.fn().mockReturnValue({ sessionId: "s1", runId: "r1" }),
    setGitContext: vi.fn(),
  } as unknown as AuditLogger;
}

describe("GitBridge", () => {
  let bridge: GitBridge;
  let logger: AuditLogger;

  beforeEach(() => {
    vi.restoreAllMocks();
    logger = createMockLogger();
    bridge = new GitBridge(logger, "/tmp/test-project");
  });

  it("constructs with a logger and optional cwd", () => {
    expect(bridge).toBeDefined();
  });

  it("readContext returns a GitContext object", async () => {
    const { exec } = await import("node:child_process");
    const mockExec = exec as unknown as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((_cmd: string, _opts: object, cb?: Function) => {
      if (cb) cb(null, { stdout: "main\n", stderr: "" });
      return {};
    });

    const ctx = await bridge.readContext();
    expect(ctx).toHaveProperty("branch");
    expect(ctx).toHaveProperty("commitHash");
    expect(ctx).toHaveProperty("worktreePath");
    expect(ctx).toHaveProperty("isDirty");
    expect(ctx).toHaveProperty("modifiedFiles");
    expect(ctx).toHaveProperty("stagedFiles");
  });

  it("readContext handles git failures gracefully", async () => {
    const { exec } = await import("node:child_process");
    const mockExec = exec as unknown as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((_cmd: string, _opts: object, cb?: Function) => {
      if (cb) cb(new Error("not a git repo"), { stdout: "", stderr: "" });
      return {};
    });

    const ctx = await bridge.readContext();
    expect(ctx.branch).toBeNull();
    expect(ctx.commitHash).toBeNull();
    expect(ctx.isDirty).toBe(false);
  });

  it("enrichTrailEvent returns partial provenance", async () => {
    const { exec } = await import("node:child_process");
    const mockExec = exec as unknown as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((_cmd: string, _opts: object, cb?: Function) => {
      if (cb) cb(null, { stdout: "feat/test\n", stderr: "" });
      return {};
    });

    const prov = await bridge.enrichTrailEvent("src/app.ts", "e1");
    expect(prov).toHaveProperty("worktreePath");
  });

  it("fileDiff returns empty string when file has no changes", async () => {
    const { exec } = await import("node:child_process");
    const mockExec = exec as unknown as ReturnType<typeof vi.fn>;
    mockExec.mockImplementation((_cmd: string, _opts: object, cb?: Function) => {
      if (cb) cb(null, { stdout: "", stderr: "" });
      return {};
    });

    const diff = await bridge.fileDiff("clean-file.ts");
    expect(diff).toBe("");
  });
});
