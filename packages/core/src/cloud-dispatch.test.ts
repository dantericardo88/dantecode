// ============================================================================
// @dantecode/core — Cloud Agent Dispatcher Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  selectDispatchMode,
  dispatchAgentTask,
  parseSSEStream,
} from "./cloud-dispatch.js";
import type { DispatchOptions } from "./cloud-dispatch.js";
import * as childProcess from "node:child_process";

// Mock child_process.exec
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
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

// Save original fetch
const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockExecSuccess(stdout = "executed", stderr = ""): void {
  (childProcess.exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _opts: unknown, cb: (err: unknown, result: unknown) => void) => {
      cb(null, { stdout, stderr });
      return {};
    },
  );
}

function mockExecFailure(message: string, code = 1): void {
  (childProcess.exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _opts: unknown, cb: (err: unknown) => void) => {
      const err = new Error(message) as Error & { code: number; stdout: string; stderr: string };
      err.code = code;
      err.stdout = "";
      err.stderr = message;
      cb(err);
      return {};
    },
  );
}

function makeBaseOptions(overrides: Partial<DispatchOptions> = {}): DispatchOptions {
  return {
    prompt: "Write a test",
    projectRoot: "/tmp/project",
    ...overrides,
  };
}

// ─── selectDispatchMode ──────────────────────────────────────────────────────

describe("selectDispatchMode", () => {
  it("returns 'local' when no configs are provided", () => {
    const mode = selectDispatchMode(makeBaseOptions());
    expect(mode).toBe("local");
  });

  it("returns 'cloud' when cloudConfig is provided", () => {
    const mode = selectDispatchMode(
      makeBaseOptions({
        cloudConfig: { endpoint: "https://api.example.com", apiToken: "tok" },
      }),
    );
    expect(mode).toBe("cloud");
  });

  it("returns 'docker' when only dockerConfig is provided", () => {
    const mode = selectDispatchMode(
      makeBaseOptions({
        dockerConfig: { image: "node:20" },
      }),
    );
    expect(mode).toBe("docker");
  });

  it("respects preferredMode over automatic detection", () => {
    const mode = selectDispatchMode(
      makeBaseOptions({
        preferredMode: "local",
        cloudConfig: { endpoint: "https://api.example.com", apiToken: "tok" },
      }),
    );
    expect(mode).toBe("local");
  });

  it("returns 'cloud' as preferredMode when explicitly set", () => {
    const mode = selectDispatchMode(
      makeBaseOptions({ preferredMode: "cloud" }),
    );
    expect(mode).toBe("cloud");
  });
});

// ─── dispatchAgentTask — local mode ──────────────────────────────────────────

describe("dispatchAgentTask — local mode", () => {
  it("succeeds with local execution", async () => {
    mockExecSuccess("task output");
    const result = await dispatchAgentTask(
      makeBaseOptions({ preferredMode: "local" }),
    );

    expect(result.mode).toBe("local");
    expect(result.success).toBe(true);
    expect(result.output).toBe("task output");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns failure when local exec fails", async () => {
    mockExecFailure("command not found");
    const result = await dispatchAgentTask(
      makeBaseOptions({ preferredMode: "local" }),
    );

    expect(result.mode).toBe("local");
    expect(result.success).toBe(false);
    expect(result.error).toContain("command not found");
  });

  it("reports progress during local execution", async () => {
    mockExecSuccess("done");
    const messages: string[] = [];
    await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "local",
        onProgress: (msg) => messages.push(msg),
      }),
    );

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes("local"))).toBe(true);
  });
});

// ─── dispatchAgentTask — local mode with localExecutor ───────────────────────

describe("dispatchAgentTask — localExecutor", () => {
  it("uses injected localExecutor when provided", async () => {
    const executor = vi.fn().mockResolvedValue({
      output: "agent completed task",
      touchedFiles: ["src/main.ts", "src/utils.ts"],
    });

    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "local",
        localExecutor: executor,
      }),
    );

    expect(result.mode).toBe("local");
    expect(result.success).toBe(true);
    expect(result.output).toBe("agent completed task");
    expect(result.touchedFiles).toEqual(["src/main.ts", "src/utils.ts"]);
    expect(executor).toHaveBeenCalledWith("Write a test", "/tmp/project");
  });

  it("handles localExecutor failure", async () => {
    const executor = vi.fn().mockRejectedValue(new Error("Agent crashed"));

    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "local",
        localExecutor: executor,
      }),
    );

    expect(result.mode).toBe("local");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Agent crashed");
  });

  it("handles localExecutor timeout", async () => {
    const executor = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10_000)),
    );

    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "local",
        localExecutor: executor,
        timeoutMs: 50,
      }),
    );

    expect(result.mode).toBe("local");
    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
  });
});

// ─── dispatchAgentTask — docker mode with fallback ───────────────────────────

describe("dispatchAgentTask — docker fallback", () => {
  it("falls back to local when docker config is missing", async () => {
    mockExecSuccess("local fallback");
    const result = await dispatchAgentTask(
      makeBaseOptions({ preferredMode: "docker" }),
    );

    // Docker fails (no config), falls back to local
    expect(result.success).toBe(true);
    expect(result.mode).toBe("local");
  });

  it("falls back to local when docker is not available", async () => {
    // First call (docker info) fails, second call (local exec) succeeds
    let callCount = 0;
    (childProcess.exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _opts: unknown, cb: (err: unknown, result?: unknown) => void) => {
        callCount++;
        if (callCount <= 1) {
          // docker info check fails
          cb(new Error("docker not found"));
        } else {
          // local exec succeeds
          cb(null, { stdout: "local fallback output", stderr: "" });
        }
        return {};
      },
    );

    const messages: string[] = [];
    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "docker",
        dockerConfig: { image: "node:20" },
        onProgress: (msg) => messages.push(msg),
      }),
    );

    expect(result.success).toBe(true);
    expect(result.mode).toBe("local");
    expect(messages.some((m) => m.includes("failed"))).toBe(true);
  });
});

// ─── dispatchAgentTask — cloud mode ──────────────────────────────────────────

describe("dispatchAgentTask — cloud mode", () => {
  it("succeeds with cloud execution", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        taskId: "task-1",
        status: "completed",
        output: "cloud result",
        touchedFiles: ["src/main.ts"],
      }),
    });

    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "cloud",
        cloudConfig: {
          endpoint: "https://api.example.com",
          apiToken: "secret-token",
        },
      }),
    );

    expect(result.mode).toBe("cloud");
    expect(result.success).toBe(true);
    expect(result.output).toBe("cloud result");
    expect(result.touchedFiles).toEqual(["src/main.ts"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://api.example.com/tasks",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
  });

  it("returns failure for non-ok cloud response", async () => {
    mockExecSuccess("local fallback after cloud failure");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    });

    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "cloud",
        cloudConfig: {
          endpoint: "https://api.example.com",
          apiToken: "tok",
        },
      }),
    );

    // Cloud fails, falls back through docker (no config = fail) then to local
    expect(result.success).toBe(true);
    expect(result.mode).toBe("local");
  });

  it("handles cloud fetch network error with fallback", async () => {
    mockExecSuccess("fell back to local");
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "cloud",
        cloudConfig: {
          endpoint: "https://api.example.com",
          apiToken: "tok",
        },
      }),
    );

    expect(result.success).toBe(true);
    expect(result.mode).toBe("local");
  });

  it("handles SSE streaming progress", async () => {
    const ssePayload = [
      'event: progress\ndata: {"type":"progress","message":"Analyzing code..."}\n\n',
      'event: progress\ndata: {"type":"progress","message":"Writing tests..."}\n\n',
      'event: complete\ndata: {"status":"completed","output":"SSE cloud result","touchedFiles":["a.ts"]}\n\n',
    ].join("");

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload));
        controller.close();
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    });

    const progress: string[] = [];
    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "cloud",
        cloudConfig: {
          endpoint: "https://api.example.com",
          apiToken: "tok",
          streamProgress: true,
        },
        onProgress: (msg) => progress.push(msg),
      }),
    );

    expect(result.mode).toBe("cloud");
    expect(result.success).toBe(true);
    expect(result.output).toBe("SSE cloud result");
    expect(result.touchedFiles).toEqual(["a.ts"]);
    expect(progress.some((p) => p.includes("Analyzing code"))).toBe(true);
  });

  it("handles cloud timeout", async () => {
    mockExecSuccess("local after timeout");
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "cloud",
        cloudConfig: {
          endpoint: "https://api.example.com",
          apiToken: "tok",
          timeoutMs: 100,
        },
        timeoutMs: 100,
      }),
    );

    // Falls back to local
    expect(result.success).toBe(true);
    expect(result.mode).toBe("local");
  });
});

// ─── SSE Stream Parsing ─────────────────────────────────────────────────────

describe("parseSSEStream", () => {
  it("parses data-only events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: hello world\n\ndata: second event\n\n'));
        controller.close();
      },
    });

    const events: Array<{ event?: string; data: string }> = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0]!.data).toBe("hello world");
    expect(events[1]!.data).toBe("second event");
  });

  it("parses named events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: progress\ndata: step 1\n\n'));
        controller.close();
      },
    });

    const events: Array<{ event?: string; data: string }> = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe("progress");
    expect(events[0]!.data).toBe("step 1");
  });

  it("handles chunked delivery", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: "));
        controller.enqueue(encoder.encode("chunked data\n\n"));
        controller.close();
      },
    });

    const events: Array<{ event?: string; data: string }> = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.data.includes("chunked data"))).toBe(true);
  });

  it("handles empty stream", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });

    const events: Array<{ event?: string; data: string }> = [];
    for await (const event of parseSSEStream(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
  });
});

// ─── Full fallback chain ─────────────────────────────────────────────────────

describe("dispatchAgentTask — fallback chain", () => {
  it("cloud -> docker -> local fallback chain", async () => {
    // Cloud fails
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Cloud unavailable"));

    // Docker info fails (no docker), local succeeds
    let callCount = 0;
    (childProcess.exec as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _opts: unknown, cb: (err: unknown, result?: unknown) => void) => {
        callCount++;
        if (callCount <= 1) {
          // docker info fails
          cb(new Error("docker not found"));
        } else {
          // local exec
          cb(null, { stdout: "final local output", stderr: "" });
        }
        return {};
      },
    );

    const messages: string[] = [];
    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "cloud",
        cloudConfig: {
          endpoint: "https://api.example.com",
          apiToken: "tok",
        },
        dockerConfig: { image: "node:20" },
        onProgress: (msg) => messages.push(msg),
      }),
    );

    expect(result.success).toBe(true);
    expect(result.mode).toBe("local");
    expect(result.output).toBe("final local output");
    // Verify that multiple tiers were attempted
    expect(messages.some((m) => m.includes("cloud"))).toBe(true);
  });

  it("returns last failure when all tiers fail", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Cloud down"));
    mockExecFailure("exec failed");

    const result = await dispatchAgentTask(
      makeBaseOptions({
        preferredMode: "cloud",
        cloudConfig: {
          endpoint: "https://api.example.com",
          apiToken: "tok",
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
