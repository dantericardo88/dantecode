// ============================================================================
// @dantecode/core — Docker Agent Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerAgent } from "./docker-agent.js";
import * as childProcess from "node:child_process";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:util", async () => {
  const actual = await vi.importActual<typeof import("node:util")>("node:util");
  return {
    ...actual,
    promisify: vi.fn((fn: unknown) => {
      return (...args: unknown[]) =>
        new Promise((resolve, reject) => {
          (fn as (...a: unknown[]) => void)(...args, (err: unknown, result: unknown) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
    }),
  };
});

vi.mock("node:crypto", () => ({
  randomUUID: () => "12345678-abcd-efgh-ijkl-123456789012",
}));

const mockExecFile = childProcess.execFile as unknown as ReturnType<typeof vi.fn>;

function mockDockerSuccess(stdout = "", stderr = ""): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
      cb(null, { stdout, stderr });
      return {};
    },
  );
}

function mockDockerFailure(message: string, code = 1): void {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown) => void) => {
      const err = new Error(message) as Error & {
        code: number;
        stdout: string;
        stderr: string;
        killed: boolean;
        signal: string | null;
      };
      err.code = code;
      err.stdout = "";
      err.stderr = message;
      err.killed = false;
      err.signal = null;
      cb(err);
      return {};
    },
  );
}

function mockDockerSequence(results: Array<{ stdout?: string; stderr?: string; error?: string; killed?: boolean; signal?: string }>): void {
  let callIndex = 0;
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown, result?: unknown) => void) => {
      const entry = results[callIndex] ?? results[results.length - 1]!;
      callIndex++;
      if (entry.error) {
        const err = new Error(entry.error) as Error & {
          code: number;
          stdout: string;
          stderr: string;
          killed: boolean;
          signal: string | null;
        };
        err.code = 1;
        err.stdout = "";
        err.stderr = entry.error;
        err.killed = entry.killed ?? false;
        err.signal = entry.signal ?? null;
        cb(err);
      } else {
        cb(null, { stdout: entry.stdout ?? "", stderr: entry.stderr ?? "" });
      }
      return {};
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Constructor defaults ────────────────────────────────────────────────────

describe("DockerAgent constructor", () => {
  it("sets default options when none provided", () => {
    const agent = new DockerAgent("/projects/test");
    const opts = agent.getOptions();

    expect(opts.image).toBe("node:20-slim");
    expect(opts.workdir).toBe("/workspace");
    expect(opts.networkMode).toBe("none");
    expect(opts.memoryLimitMb).toBe(2048);
    expect(opts.cpuLimit).toBe(2);
    expect(opts.timeoutMs).toBe(300_000);
    expect(opts.readOnlyMount).toBe(true);
    expect(opts.env).toEqual({});
  });

  it("merges provided options with defaults", () => {
    const agent = new DockerAgent("/projects/test", {
      image: "python:3.12",
      networkMode: "bridge",
      memoryLimitMb: 4096,
    });
    const opts = agent.getOptions();

    expect(opts.image).toBe("python:3.12");
    expect(opts.networkMode).toBe("bridge");
    expect(opts.memoryLimitMb).toBe(4096);
    // Defaults still applied
    expect(opts.cpuLimit).toBe(2);
    expect(opts.readOnlyMount).toBe(true);
  });

  it("starts with no container ID", () => {
    const agent = new DockerAgent("/projects/test");
    expect(agent.getContainerId()).toBeNull();
  });
});

// ─── isAvailable ─────────────────────────────────────────────────────────────

describe("DockerAgent.isAvailable", () => {
  it("returns true when docker info succeeds", async () => {
    mockDockerSuccess("Docker version info...");
    const available = await DockerAgent.isAvailable();
    expect(available).toBe(true);

    // Verify docker info was called
    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      ["info"],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("returns false when docker info fails", async () => {
    mockDockerFailure("docker not found");
    const available = await DockerAgent.isAvailable();
    expect(available).toBe(false);
  });
});

// ─── start ───────────────────────────────────────────────────────────────────

describe("DockerAgent.start", () => {
  it("builds correct docker run command", async () => {
    mockDockerSuccess("abc123def456");
    const agent = new DockerAgent("/projects/test", {
      image: "node:20",
      networkMode: "bridge",
      memoryLimitMb: 1024,
      cpuLimit: 1,
      readOnlyMount: true,
      env: { NODE_ENV: "production" },
    });

    await agent.start();

    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "run",
        "--detach",
        "--name",
        expect.stringContaining("dantecode-agent-"),
        "--workdir",
        "/workspace",
        "--network",
        "bridge",
        "--memory",
        "1024m",
        "--cpus",
        "1",
        "--volume",
        "/projects/test:/workspace:ro",
        "--env",
        "NODE_ENV=production",
        "node:20",
        "sleep",
        "infinity",
      ]),
      expect.any(Object),
      expect.any(Function),
    );

    expect(agent.getContainerId()).toBe("abc123def456");
  });

  it("uses rw mount when readOnlyMount is false", async () => {
    mockDockerSuccess("container-id-here");
    const agent = new DockerAgent("/projects/test", {
      readOnlyMount: false,
    });

    await agent.start();

    expect(mockExecFile).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining([
        "--volume",
        "/projects/test:/workspace",
      ]),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it("throws if container already started", async () => {
    mockDockerSuccess("container-id");
    const agent = new DockerAgent("/projects/test");
    await agent.start();

    await expect(agent.start()).rejects.toThrow("Container already started");
  });

  it("throws on docker run failure", async () => {
    mockDockerFailure("image not found");
    const agent = new DockerAgent("/projects/test");

    await expect(agent.start()).rejects.toThrow("Failed to start Docker container");
  });
});

// ─── exec ────────────────────────────────────────────────────────────────────

describe("DockerAgent.exec", () => {
  it("sends correct docker exec command", async () => {
    mockDockerSequence([
      { stdout: "container123" },             // docker run
      { stdout: "command output", stderr: "" }, // docker exec
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    const result = await agent.exec({ command: "ls -la" });

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("command output");
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Verify second call was docker exec
    const execCall = mockExecFile.mock.calls[1]!;
    expect(execCall[0]).toBe("docker");
    expect(execCall[1]).toContain("exec");
    expect(execCall[1]).toContain("container123");
    expect(execCall[1]).toContain("ls -la");
  });

  it("passes workdir and env overrides", async () => {
    mockDockerSequence([
      { stdout: "cid" },
      { stdout: "ok" },
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    await agent.exec({
      command: "echo hello",
      workdir: "/custom",
      env: { FOO: "bar" },
    });

    const execCall = mockExecFile.mock.calls[1]!;
    const args = execCall[1] as string[];
    expect(args).toContain("--workdir");
    expect(args).toContain("/custom");
    expect(args).toContain("--env");
    expect(args).toContain("FOO=bar");
  });

  it("throws if container not started", async () => {
    const agent = new DockerAgent("/projects/test");

    await expect(agent.exec({ command: "ls" })).rejects.toThrow(
      "Container not started",
    );
  });

  it("handles command failure with exit code", async () => {
    mockDockerSequence([
      { stdout: "cid" },
      { error: "exit code 2", killed: false },
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    const result = await agent.exec({ command: "false" });

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
  });

  it("detects timeout via killed signal", async () => {
    mockDockerSequence([
      { stdout: "cid" },
      { error: "timed out", killed: true, signal: "SIGTERM" },
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    const result = await agent.exec({
      command: "sleep 999",
      timeoutMs: 100,
    });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });
});

// ─── runTask ─────────────────────────────────────────────────────────────────

describe("DockerAgent.runTask", () => {
  it("runs full lifecycle: start, exec, collect patch, stop", async () => {
    mockDockerSequence([
      { stdout: "container-for-task" },           // docker run (start)
      { stdout: "task output" },                   // docker exec (command)
      { stdout: "diff --git a/f.ts b/f.ts\n+new line" }, // docker exec (git diff / collectPatch)
      { stdout: "" },                               // docker rm (stop)
    ]);

    const agent = new DockerAgent("/projects/test");
    const result = await agent.runTask("npm test");

    expect(result.success).toBe(true);
    expect(result.stdout).toBe("task output");
    expect(result.patch).toBe("diff --git a/f.ts b/f.ts\n+new line");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    // Container should be cleaned up
    expect(agent.getContainerId()).toBeNull();
  });

  it("stops container even when exec fails", async () => {
    mockDockerSequence([
      { stdout: "cid" },             // docker run
      { error: "command failed" },    // docker exec (command fails)
      { stdout: "" },                 // docker exec (collectPatch — may also fail gracefully)
      { stdout: "" },                 // docker rm (stop)
    ]);

    const agent = new DockerAgent("/projects/test");
    const result = await agent.runTask("bad-command");

    expect(result.success).toBe(false);
    // Container should still be cleaned up
    expect(agent.getContainerId()).toBeNull();
  });

  it("skips start/stop when container is already running", async () => {
    mockDockerSequence([
      { stdout: "pre-started-id" },  // docker run (manual start)
      { stdout: "reuse output" },     // docker exec (command)
      { stdout: "" },                 // docker exec (git diff)
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    const result = await agent.runTask("echo hello");

    expect(result.success).toBe(true);
    expect(result.stdout).toBe("reuse output");
    // Container should still be running (not stopped)
    expect(agent.getContainerId()).toBe("pre-started-");
  });
});

// ─── collectPatch ────────────────────────────────────────────────────────────

describe("DockerAgent.collectPatch", () => {
  it("returns git diff output", async () => {
    const diffOutput = "diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1,2 @@\n+console.log('hello')";
    mockDockerSequence([
      { stdout: "cid" },
      { stdout: diffOutput },
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    const patch = await agent.collectPatch();
    expect(patch).toBe(diffOutput);
  });

  it("returns empty string when no changes", async () => {
    mockDockerSequence([
      { stdout: "cid" },
      { stdout: "" },
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    const patch = await agent.collectPatch();
    expect(patch).toBe("");
  });

  it("throws if container not started", async () => {
    const agent = new DockerAgent("/projects/test");
    await expect(agent.collectPatch()).rejects.toThrow("Container not started");
  });
});

// ─── stop ────────────────────────────────────────────────────────────────────

describe("DockerAgent.stop", () => {
  it("removes container with force flag", async () => {
    mockDockerSequence([
      { stdout: "to-remove" }, // docker run
      { stdout: "" },          // docker rm
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();
    await agent.stop();

    // Verify docker rm --force was called
    const rmCall = mockExecFile.mock.calls[1]!;
    expect(rmCall[0]).toBe("docker");
    expect(rmCall[1]).toContain("rm");
    expect(rmCall[1]).toContain("--force");
    expect(agent.getContainerId()).toBeNull();
  });

  it("is idempotent — no-op when not started", async () => {
    const agent = new DockerAgent("/projects/test");
    // Should not throw
    await agent.stop();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("handles cleanup errors gracefully", async () => {
    mockDockerSequence([
      { stdout: "cid" },
      { error: "container already removed" },
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    // Should not throw even when docker rm fails
    await agent.stop();
    expect(agent.getContainerId()).toBeNull();
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────

describe("DockerAgent — error handling", () => {
  it("propagates start failure with descriptive message", async () => {
    mockDockerFailure("permission denied");
    const agent = new DockerAgent("/projects/test");

    await expect(agent.start()).rejects.toThrow(
      "Failed to start Docker container: permission denied",
    );
  });

  it("returns stderr in result when exec fails", async () => {
    mockDockerSequence([
      { stdout: "cid" },
      { error: "npm ERR! Missing script: test" },
    ]);

    const agent = new DockerAgent("/projects/test");
    await agent.start();

    const result = await agent.exec({ command: "npm test" });
    expect(result.success).toBe(false);
    expect(result.stderr).toContain("npm ERR!");
  });
});
