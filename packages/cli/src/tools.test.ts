import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SelfImprovementContext } from "@dantecode/config-types";

const {
  mockReadFile,
  mockWriteFile,
  mockMkdir,
  mockReaddir,
  mockStat,
  mockExecSync,
  mockExec,
  mockExecFile,
  mockAppendAuditEvent,
} = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
  mockReaddir: vi.fn(),
  mockStat: vi.fn(),
  mockExecSync: vi.fn(),
  mockExec: vi.fn(),
  mockExecFile: vi.fn(),
  mockAppendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execSync: (...args: unknown[]) => mockExecSync(...args),
    exec: (...args: unknown[]) => mockExec(...args),
    execFile: (...args: unknown[]) => mockExecFile(...args),
  };
});

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<object>("../../core/src/self-improvement-policy.ts");
  return {
    ...actual,
    appendAuditEvent: (...args: unknown[]) => mockAppendAuditEvent(...args),
  };
});

import { executeTool, type CliToolExecutionContext } from "./tools.js";

function makeContext(
  overrides: Partial<CliToolExecutionContext> = {},
): CliToolExecutionContext {
  return {
    sessionId: "session-1",
    roundId: "round-1",
    readTracker: new Map(),
    editAttempts: new Map(),
    sandboxEnabled: false,
    ...overrides,
  };
}

function makeSelfImprovement(): SelfImprovementContext {
  return {
    enabled: true,
    workflowId: "autoforge-self-improve",
    triggerCommand: "/autoforge --self-improve",
    allowedRoots: ["/proj/packages/cli", "/proj/packages/core", "/proj/.dantecode"],
  };
}

describe("cli tools hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
    mockReaddir.mockReset();
    mockStat.mockReset();
    mockExecSync.mockReset();
  });

  it("blocks protected writes outside explicit self-improvement mode", async () => {
    const result = await executeTool(
      "Write",
      { file_path: "packages/cli/src/tools.ts", content: "export {};" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Self-modification blocked");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/proj",
      expect.objectContaining({ type: "self_modification_denied" }),
    );
  });

  it("allows protected writes in explicit self-improvement mode", async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await executeTool(
      "Write",
      { file_path: "packages/cli/src/tools.ts", content: "export {};" },
      "/proj",
      makeContext({ selfImprovement: makeSelfImprovement() }),
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Successfully wrote");
    expect(mockAppendAuditEvent).toHaveBeenCalledWith(
      "/proj",
      expect.objectContaining({ type: "self_modification_allowed" }),
    );
  });

  it("rejects repo-internal cd chains for Bash", async () => {
    const result = await executeTool(
      "Bash",
      { command: "cd packages/cli && npm test" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Run this from the repository root");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("requires a recent full-file Read before Edit", async () => {
    const result = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "old", new_string: "new" },
      "/proj",
      makeContext(),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Read the full current file before Edit");
  });

  it("returns current file contents after the first edit mismatch", async () => {
    const context = makeContext();
    mockReadFile.mockResolvedValueOnce("line 1\nline 2\n");

    const readResult = await executeTool("Read", { file_path: "src/app.ts" }, "/proj", context);
    expect(readResult.isError).toBe(false);

    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    const result = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
      "/proj",
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("old_string not found");
    expect(result.content).toContain("Latest file contents");
  });

  it("forces whole-file rewrite guidance on the second identical edit failure", async () => {
    const context = makeContext();
    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    await executeTool("Read", { file_path: "src/app.ts" }, "/proj", context);

    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
      "/proj",
      context,
    );

    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    const second = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
      "/proj",
      context,
    );

    expect(second.isError).toBe(true);
    expect(second.content).toContain("Use Write with the full updated file");
  });

  it("blocks a third identical edit attempt in the same round", async () => {
    const context = makeContext();
    mockReadFile.mockResolvedValueOnce("const value = 1;\n");
    await executeTool("Read", { file_path: "src/app.ts" }, "/proj", context);

    for (let i = 0; i < 2; i++) {
      mockReadFile.mockResolvedValueOnce("const value = 1;\n");
      await executeTool(
        "Edit",
        { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
        "/proj",
        context,
      );
    }

    const third = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: "missing", new_string: "updated" },
      "/proj",
      context,
    );

    expect(third.isError).toBe(true);
    expect(third.content).toContain("Third identical Edit attempt blocked");
  });
});
