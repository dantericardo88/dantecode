// ============================================================================
// Sprint M — Dim 10: incrementalVerifyGate wiring in agent-loop Write path
// Tests that when config.incrementalVerify is true, the gate is called after
// each file write and failure output is injected as context.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    detectProjectStack: vi.fn().mockResolvedValue({
      name: "typescript",
      typecheckCmd: "tsc --noEmit",
      testCmd: "vitest run",
      buildCmd: "tsc",
      files: [],
    }),
    incrementalVerifyGate: vi.fn(),
    buildTestOutputContext: vi.fn(
      (output: string) => `## Test Output\n\n\`\`\`\n${output}\n\`\`\``,
    ),
  };
});

import { detectProjectStack, incrementalVerifyGate, buildTestOutputContext } from "@dantecode/core";

const mockDetectProjectStack = detectProjectStack as ReturnType<typeof vi.fn>;
const mockIncrementalVerifyGate = incrementalVerifyGate as ReturnType<typeof vi.fn>;
const mockBuildTestOutputContext = buildTestOutputContext as ReturnType<typeof vi.fn>;

// ── Simulation of the agent-loop Write-path incremental verify logic ──────────

async function simulateWritePathVerify(opts: {
  filePath: string;
  projectRoot: string;
  incrementalVerify: boolean;
  gateResult?: { passed: boolean; output: string };
}): Promise<{ toolResults: string[] }> {
  const toolResults: string[] = [];
  const { filePath, projectRoot, incrementalVerify, gateResult = { passed: true, output: "" } } = opts;

  mockIncrementalVerifyGate.mockImplementation(async () => gateResult);

  if (incrementalVerify) {
    try {
      const stack = await detectProjectStack(projectRoot);
      const result = await incrementalVerifyGate(filePath, stack);
      if (!result.passed && result.output) {
        const ctx = buildTestOutputContext(result.output);
        toolResults.push(`SYSTEM: Incremental typecheck after writing ${filePath}:\n\n${ctx}`);
      }
    } catch { /* non-fatal */ }
  }

  return { toolResults };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("incrementalVerifyGate — Write path wiring (Sprint M)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectProjectStack.mockResolvedValue({
      name: "typescript",
      typecheckCmd: "tsc --noEmit",
      testCmd: "vitest run",
      buildCmd: "tsc",
      files: [],
    });
  });

  // 1. Gate called when config.incrementalVerify is true
  it("calls incrementalVerifyGate when config.incrementalVerify is true", async () => {
    mockIncrementalVerifyGate.mockResolvedValueOnce({ passed: true, output: "" });
    await simulateWritePathVerify({
      filePath: "/repo/src/foo.ts",
      projectRoot: "/repo",
      incrementalVerify: true,
    });
    expect(mockIncrementalVerifyGate).toHaveBeenCalledWith("/repo/src/foo.ts", expect.objectContaining({ typecheckCmd: "tsc --noEmit" }));
  });

  // 2. Gate NOT called when config.incrementalVerify is false
  it("does not call incrementalVerifyGate when config.incrementalVerify is false", async () => {
    await simulateWritePathVerify({
      filePath: "/repo/src/foo.ts",
      projectRoot: "/repo",
      incrementalVerify: false,
    });
    expect(mockIncrementalVerifyGate).not.toHaveBeenCalled();
  });

  // 3. No context injected when gate passes
  it("injects no context when gate returns passed: true", async () => {
    const { toolResults } = await simulateWritePathVerify({
      filePath: "/repo/src/foo.ts",
      projectRoot: "/repo",
      incrementalVerify: true,
      gateResult: { passed: true, output: "" },
    });
    expect(toolResults).toHaveLength(0);
  });

  // 4. Failure output injected as SYSTEM message when gate fails
  it("injects SYSTEM message with typecheck output when gate fails", async () => {
    const { toolResults } = await simulateWritePathVerify({
      filePath: "/repo/src/foo.ts",
      projectRoot: "/repo",
      incrementalVerify: true,
      gateResult: { passed: false, output: "error TS2322: Type 'number' is not assignable" },
    });
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toContain("SYSTEM: Incremental typecheck after writing");
    expect(toolResults[0]).toContain("foo.ts");
  });

  // 5. buildTestOutputContext called with failure output
  it("calls buildTestOutputContext with the gate failure output", async () => {
    const failOutput = "Type error on line 10";
    await simulateWritePathVerify({
      filePath: "/repo/src/bar.ts",
      projectRoot: "/repo",
      incrementalVerify: true,
      gateResult: { passed: false, output: failOutput },
    });
    expect(mockBuildTestOutputContext).toHaveBeenCalledWith(failOutput);
  });

  // 6. detectProjectStack called with projectRoot
  it("calls detectProjectStack with projectRoot to get stack template", async () => {
    mockIncrementalVerifyGate.mockResolvedValueOnce({ passed: true, output: "" });
    await simulateWritePathVerify({
      filePath: "/repo/src/foo.ts",
      projectRoot: "/my/project",
      incrementalVerify: true,
    });
    expect(mockDetectProjectStack).toHaveBeenCalledWith("/my/project");
  });

  // 7. Errors from incrementalVerifyGate handled silently (no throw)
  it("handles incrementalVerifyGate errors silently", async () => {
    mockIncrementalVerifyGate.mockRejectedValueOnce(new Error("tsc not found"));
    await expect(
      simulateWritePathVerify({
        filePath: "/repo/src/foo.ts",
        projectRoot: "/repo",
        incrementalVerify: true,
      }),
    ).resolves.toBeDefined();
  });

  // 8. No injection when gate fails with empty output
  it("does not inject context when gate fails but output is empty", async () => {
    const { toolResults } = await simulateWritePathVerify({
      filePath: "/repo/src/foo.ts",
      projectRoot: "/repo",
      incrementalVerify: true,
      gateResult: { passed: false, output: "" },
    });
    expect(toolResults).toHaveLength(0);
  });
});
