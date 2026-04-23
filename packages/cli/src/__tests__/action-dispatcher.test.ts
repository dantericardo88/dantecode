// ============================================================================
// packages/cli/src/__tests__/action-dispatcher.test.ts
//
// 30 tests for parseActionsFromToolCalls and executeAction.
// All I/O is mocked — no real filesystem or shell calls.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";
import {
  parseActionsFromToolCalls,
  executeAction,
  type ToolCall,
} from "../action-dispatcher.js";

// ---------------------------------------------------------------------------
// Mock node:child_process
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock node:fs/promises
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Pull in the mocked modules for use in tests
import { execFile as execFileMock } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const mockedExecFile = vi.mocked(execFileMock);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedMkdir = vi.mocked(mkdir);

const PROJECT_ROOT = "/project";

// ---------------------------------------------------------------------------
// Helper to set up execFile mock with a callback-based implementation.
// promisify wraps the last argument as a node-style callback (err, result).
// We use `mockImplementation` typed as `any` to avoid fighting the overload
// union signatures that TypeScript picks for the mocked execFile.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => void;

function setupExecFileSuccess(stdout: string, stderr = "") {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockedExecFile as any).mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: AnyFn) => {
      cb(null, { stdout, stderr });
    },
  );
}

function setupExecFileError(
  code: number | string,
  stdout = "",
  stderr = "",
  killed = false,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockedExecFile as any).mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: AnyFn) => {
      const err = Object.assign(new Error("exec failed"), {
        code,
        stdout,
        stderr,
        killed,
      });
      cb(err, { stdout, stderr });
    },
  );
}

function setupExecFileTimeout() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mockedExecFile as any).mockImplementation(
    (_file: string, _args: string[], _opts: unknown, cb: AnyFn) => {
      const err = Object.assign(new Error("process timed out"), {
        killed: true,
        code: "ETIMEDOUT",
        stdout: "",
        stderr: "",
      });
      cb(err, { stdout: "", stderr: "" });
    },
  );
}

// ============================================================================
// Group 1: parseActionsFromToolCalls (12 tests)
// ============================================================================

describe("parseActionsFromToolCalls", () => {
  it("execute_bash → CmdRunAction with command", () => {
    const calls: ToolCall[] = [
      { toolName: "execute_bash", args: { command: "ls -la" } },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ type: "cmd_run", command: "ls -la" });
  });

  it("execute_bash with timeout → CmdRunAction with timeout", () => {
    const calls: ToolCall[] = [
      {
        toolName: "execute_bash",
        args: { command: "sleep 10", timeout: 5000 },
      },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions[0]).toEqual({
      type: "cmd_run",
      command: "sleep 10",
      timeout: 5000,
    });
  });

  it("str_replace_based_edit_tool str_replace → FileEditAction", () => {
    const calls: ToolCall[] = [
      {
        toolName: "str_replace_based_edit_tool",
        args: {
          command: "str_replace",
          path: "src/foo.ts",
          old_str: "const x = 1",
          new_str: "const x = 2",
        },
      },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions[0]).toEqual({
      type: "file_edit",
      path: "src/foo.ts",
      old_str: "const x = 1",
      new_str: "const x = 2",
    });
  });

  it("str_replace_based_edit_tool view → FileReadAction", () => {
    const calls: ToolCall[] = [
      {
        toolName: "str_replace_based_edit_tool",
        args: { command: "view", path: "src/bar.ts" },
      },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions[0]).toEqual({ type: "file_read", path: "src/bar.ts" });
  });

  it("str_replace_based_edit_tool create → FileWriteAction", () => {
    const calls: ToolCall[] = [
      {
        toolName: "str_replace_based_edit_tool",
        args: {
          command: "create",
          path: "src/new.ts",
          file_text: "export const x = 1;\n",
        },
      },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions[0]).toEqual({
      type: "file_write",
      path: "src/new.ts",
      content: "export const x = 1;\n",
    });
  });

  it("think → ThinkAction", () => {
    const calls: ToolCall[] = [
      {
        toolName: "think",
        args: { thought: "I should check the tests first." },
      },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions[0]).toEqual({
      type: "think",
      thought: "I should check the tests first.",
    });
  });

  it("finish → AgentFinishAction with outputs", () => {
    const calls: ToolCall[] = [
      {
        toolName: "finish",
        args: { outputs: { result: "done" }, thought: "All good." },
      },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions[0]).toEqual({
      type: "agent_finish",
      outputs: { result: "done" },
      thought: "All good.",
    });
  });

  it("finish with no outputs → AgentFinishAction with empty outputs", () => {
    const calls: ToolCall[] = [
      { toolName: "finish", args: { thought: "Done." } },
    ];
    const actions = parseActionsFromToolCalls(calls);
    const act = actions[0] as {
      type: string;
      outputs: Record<string, string>;
    };
    expect(act.type).toBe("agent_finish");
    expect(act.outputs).toEqual({});
  });

  it("unknown tool → empty array returned (skipped)", () => {
    const calls: ToolCall[] = [
      { toolName: "some_unknown_tool", args: { foo: "bar" } },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions).toHaveLength(0);
  });

  it("multiple tool calls → returns multiple actions in order", () => {
    const calls: ToolCall[] = [
      { toolName: "execute_bash", args: { command: "pwd" } },
      {
        toolName: "str_replace_based_edit_tool",
        args: { command: "view", path: "README.md" },
      },
      { toolName: "think", args: { thought: "Looks good." } },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions).toHaveLength(3);
    expect(actions[0]!.type).toBe("cmd_run");
    expect(actions[1]!.type).toBe("file_read");
    expect(actions[2]!.type).toBe("think");
  });

  it("empty tool calls array → returns empty array", () => {
    expect(parseActionsFromToolCalls([])).toEqual([]);
  });

  it("str_replace_based_edit_tool with unknown subcommand → skipped", () => {
    const calls: ToolCall[] = [
      {
        toolName: "str_replace_based_edit_tool",
        args: { command: "undo", path: "src/foo.ts" },
      },
    ];
    const actions = parseActionsFromToolCalls(calls);
    expect(actions).toHaveLength(0);
  });
});

// ============================================================================
// Group 2: executeAction cmd_run (6 tests)
// ============================================================================

describe("executeAction cmd_run", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  it("success → cmd_output with exitCode 0", async () => {
    setupExecFileSuccess("hello\n");
    const obs = await executeAction(
      { type: "cmd_run", command: "echo hello" },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("cmd_output");
    expect(obs.exitCode).toBe(0);
    expect(obs.content).toBe("hello\n");
  });

  it("failure (non-zero exit) → cmd_output with exitCode from process", async () => {
    setupExecFileError(2, "", "command not found\n");
    const obs = await executeAction(
      { type: "cmd_run", command: "bad-cmd" },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("cmd_output");
    expect(obs.exitCode).toBe(2);
    expect(obs.content).toContain("command not found");
  });

  it("timeout → error observation with 'timed out' message", async () => {
    setupExecFileTimeout();
    const obs = await executeAction(
      { type: "cmd_run", command: "sleep 9999", timeout: 1 },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("error");
    expect(obs.content).toMatch(/timed out/i);
    expect(obs.exitCode).toBe(-1);
  });

  it("stdout is captured in content", async () => {
    setupExecFileSuccess("captured output");
    const obs = await executeAction(
      { type: "cmd_run", command: "cat file.txt" },
      PROJECT_ROOT,
    );
    expect(obs.content).toBe("captured output");
  });

  it("stderr captured on failure", async () => {
    setupExecFileError(1, "", "error: something went wrong");
    const obs = await executeAction(
      { type: "cmd_run", command: "failing-cmd" },
      PROJECT_ROOT,
    );
    expect(obs.content).toContain("something went wrong");
  });

  it("uses correct shell executable based on platform", async () => {
    let capturedFile = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockedExecFile as any).mockImplementation(
      (file: string, _args: string[], _opts: unknown, cb: AnyFn) => {
        capturedFile = file;
        cb(null, { stdout: "", stderr: "" });
      },
    );
    await executeAction(
      { type: "cmd_run", command: "echo test" },
      PROJECT_ROOT,
    );
    const expectedShell = process.platform === "win32" ? "cmd.exe" : "bash";
    expect(capturedFile).toBe(expectedShell);
  });
});

// ============================================================================
// Group 3: executeAction file_read (4 tests)
// ============================================================================

describe("executeAction file_read", () => {
  beforeEach(() => {
    mockedReadFile.mockReset();
  });

  it("success → file_content observation with file content", async () => {
    mockedReadFile.mockResolvedValue("file contents here" as never);
    const obs = await executeAction(
      { type: "file_read", path: "src/index.ts" },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("file_content");
    expect(obs.content).toBe("file contents here");
  });

  it("file not found → error observation", async () => {
    mockedReadFile.mockRejectedValue(
      Object.assign(new Error("ENOENT: no such file or directory"), {
        code: "ENOENT",
      }),
    );
    const obs = await executeAction(
      { type: "file_read", path: "missing.ts" },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("error");
    expect(obs.content).toMatch(/ENOENT/);
  });

  it("path resolved relative to projectRoot", async () => {
    mockedReadFile.mockResolvedValue("content" as never);
    await executeAction(
      { type: "file_read", path: "relative/path.ts" },
      PROJECT_ROOT,
    );
    const call = mockedReadFile.mock.calls[0];
    expect(call).toBeDefined();
    const calledWith = (call as [string, ...unknown[]])[0];
    expect(calledWith).toBe(resolve(PROJECT_ROOT, "relative/path.ts"));
  });

  it("absolute path is used as-is (resolve leaves absolute paths alone)", async () => {
    mockedReadFile.mockResolvedValue("abs content" as never);
    // Use a path rooted under PROJECT_ROOT so it works cross-platform
    const absPath = resolve(PROJECT_ROOT, "absolute/path.ts");
    const obs = await executeAction(
      { type: "file_read", path: absPath },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("file_content");
    const call = mockedReadFile.mock.calls[0];
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const calledWith = call![0] as string;
    expect(calledWith).toBe(absPath);
  });
});

// ============================================================================
// Group 4: executeAction file_edit (4 tests)
// ============================================================================

describe("executeAction file_edit", () => {
  beforeEach(() => {
    mockedReadFile.mockReset();
    mockedWriteFile.mockReset();
  });

  it("success → edit_result observation", async () => {
    mockedReadFile.mockResolvedValue(
      "const x = 1;\nconst y = 2;\n" as never,
    );
    mockedWriteFile.mockResolvedValue(undefined as never);
    const obs = await executeAction(
      {
        type: "file_edit",
        path: "src/foo.ts",
        old_str: "const x = 1;",
        new_str: "const x = 99;",
      },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("edit_result");
    expect(obs.content).toContain("Applied edit");
  });

  it("old_str not found → error observation", async () => {
    mockedReadFile.mockResolvedValue("nothing matches here\n" as never);
    const obs = await executeAction(
      {
        type: "file_edit",
        path: "src/foo.ts",
        old_str: "THIS DOES NOT EXIST",
        new_str: "replacement",
      },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("error");
    expect(obs.content).toContain("old_str not found");
  });

  it("replaces first occurrence only and writes back", async () => {
    const original = "a\na\na\n";
    mockedReadFile.mockResolvedValue(original as never);
    mockedWriteFile.mockResolvedValue(undefined as never);
    await executeAction(
      {
        type: "file_edit",
        path: "src/dup.ts",
        old_str: "a",
        new_str: "b",
      },
      PROJECT_ROOT,
    );
    const call = mockedWriteFile.mock.calls[0];
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const writtenContent = call![1] as string;
    // Only the first "a" replaced
    expect(writtenContent).toBe("b\na\na\n");
  });

  it("writes back to the correct file path", async () => {
    mockedReadFile.mockResolvedValue("old text" as never);
    mockedWriteFile.mockResolvedValue(undefined as never);
    await executeAction(
      {
        type: "file_edit",
        path: "src/target.ts",
        old_str: "old text",
        new_str: "new text",
      },
      PROJECT_ROOT,
    );
    const call = mockedWriteFile.mock.calls[0];
    expect(call).toBeDefined();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const writtenPath = call![0] as string;
    expect(writtenPath).toBe(resolve(PROJECT_ROOT, "src/target.ts"));
  });
});

// ============================================================================
// Group 5: executeAction file_write (2 tests)
// ============================================================================

describe("executeAction file_write", () => {
  beforeEach(() => {
    mockedWriteFile.mockReset();
    mockedMkdir.mockReset();
  });

  it("success → edit_result observation with Created message", async () => {
    mockedMkdir.mockResolvedValue(undefined as never);
    mockedWriteFile.mockResolvedValue(undefined as never);
    const obs = await executeAction(
      {
        type: "file_write",
        path: "src/new-file.ts",
        content: "export const a = 1;\n",
      },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("edit_result");
    expect(obs.content).toContain("Created");
  });

  it("creates parent directories automatically with recursive: true", async () => {
    mockedMkdir.mockResolvedValue(undefined as never);
    mockedWriteFile.mockResolvedValue(undefined as never);
    await executeAction(
      {
        type: "file_write",
        path: "deep/nested/dir/file.ts",
        content: "// new file\n",
      },
      PROJECT_ROOT,
    );
    expect(mockedMkdir).toHaveBeenCalledWith(
      resolve(PROJECT_ROOT, "deep/nested/dir"),
      { recursive: true },
    );
  });
});

// ============================================================================
// Group 6: executeAction think / condense / agent_finish (2 tests)
// ============================================================================

describe("executeAction think / condense / agent_finish", () => {
  it("think → cmd_output with thought as content", async () => {
    const obs = await executeAction(
      { type: "think", thought: "I should refactor this." },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("cmd_output");
    expect(obs.content).toBe("I should refactor this.");
  });

  it("agent_finish → cmd_output with thought (or JSON outputs fallback)", async () => {
    const obs = await executeAction(
      {
        type: "agent_finish",
        outputs: { status: "success" },
        thought: "Task complete.",
      },
      PROJECT_ROOT,
    );
    expect(obs.type).toBe("cmd_output");
    expect(obs.content).toBe("Task complete.");
  });
});
