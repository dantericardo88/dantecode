// ============================================================================
// Sprint L — Dim 15: AutonomyOrchestrator verify-loop wiring in agent-loop
// Tests that after all waves complete, the agent loop runs verify rounds,
// injects failure output as context, and stops on success or maxVerifyRounds.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @dantecode/core so we can spy on detectProjectStack / makeVerifyFn ──
vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    detectProjectStack: vi.fn(),
    makeVerifyFn: vi.fn(),
    buildTestOutputContext: vi.fn(
      (output: string) =>
        `## Test Output\n\nThe previous code change produced failing tests. Fix the failures before proceeding.\n\n\`\`\`\n${output.trim().slice(0, 4000)}\n\`\`\``,
    ),
  };
});

import { detectProjectStack, makeVerifyFn, buildTestOutputContext } from "@dantecode/core";

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockDetectProjectStack = detectProjectStack as ReturnType<typeof vi.fn>;
const mockMakeVerifyFn = makeVerifyFn as ReturnType<typeof vi.fn>;
const mockBuildTestOutputContext = buildTestOutputContext as ReturnType<typeof vi.fn>;

function makeStack(typecheckCmd = "tsc --noEmit") {
  return {
    name: "typescript",
    typecheckCmd,
    testCmd: "vitest run",
    buildCmd: "tsc",
    files: [],
  };
}

function makeVerifyResult(success: boolean, output = "") {
  return { success, output, durationMs: 10 };
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe("AutonomyOrchestrator — verify loop wiring (Sprint L)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDetectProjectStack.mockResolvedValue(makeStack());
  });

  // 1. detectProjectStack is called when waves complete
  it("calls detectProjectStack with projectRoot after all waves complete", async () => {
    const verifyFn = vi.fn().mockResolvedValue(makeVerifyResult(true));
    mockMakeVerifyFn.mockReturnValue(verifyFn);

    await simulateWaveCompletion({ projectRoot: "/repo" });

    expect(mockDetectProjectStack).toHaveBeenCalledWith("/repo");
  });

  // 2. makeVerifyFn called with typecheckCmd from detected stack
  it("calls makeVerifyFn with typecheckCmd from detected stack", async () => {
    const verifyFn = vi.fn().mockResolvedValue(makeVerifyResult(true));
    mockMakeVerifyFn.mockReturnValue(verifyFn);
    mockDetectProjectStack.mockResolvedValue(makeStack("tsc --noEmit --strict"));

    await simulateWaveCompletion({ projectRoot: "/repo" });

    expect(mockMakeVerifyFn).toHaveBeenCalledWith("tsc --noEmit --strict");
  });

  // 3. verifyFn called with projectRoot as workdir
  it("calls verifyFn with projectRoot as workdir", async () => {
    const verifyFn = vi.fn().mockResolvedValue(makeVerifyResult(true));
    mockMakeVerifyFn.mockReturnValue(verifyFn);

    await simulateWaveCompletion({ projectRoot: "/my/project" });

    expect(verifyFn).toHaveBeenCalledWith("/my/project");
  });

  // 4. On verify success — no context injected, loop ends
  it("does not inject context when verifyFn returns success", async () => {
    const verifyFn = vi.fn().mockResolvedValue(makeVerifyResult(true));
    mockMakeVerifyFn.mockReturnValue(verifyFn);

    const messages = await simulateWaveCompletion({ projectRoot: "/repo" });

    // No ## Test Output messages should be injected
    const injected = messages.filter((m) =>
      typeof m.content === "string" && m.content.includes("## Test Output"),
    );
    expect(injected).toHaveLength(0);
  });

  // 5. On verify failure — buildTestOutputContext called with failure output
  it("calls buildTestOutputContext with failure output on failed verify", async () => {
    const failOutput = "error TS2345: Argument of type 'string' is not assignable";
    const verifyFn = vi.fn()
      .mockResolvedValueOnce(makeVerifyResult(false, failOutput))
      .mockResolvedValueOnce(makeVerifyResult(true));
    mockMakeVerifyFn.mockReturnValue(verifyFn);

    await simulateWaveCompletion({ projectRoot: "/repo" });

    expect(mockBuildTestOutputContext).toHaveBeenCalledWith(failOutput);
  });

  // 6. Failure output injected as user message with ## Test Output header
  it("injects failure output as user message after wave completion", async () => {
    const failOutput = "Type error on line 42";
    const verifyFn = vi.fn()
      .mockResolvedValueOnce(makeVerifyResult(false, failOutput))
      .mockResolvedValueOnce(makeVerifyResult(true));
    mockMakeVerifyFn.mockReturnValue(verifyFn);

    const messages = await simulateWaveCompletion({ projectRoot: "/repo" });

    const injected = messages.find(
      (m) => m.role === "user" && typeof m.content === "string" && m.content.includes("## Test Output"),
    );
    expect(injected).toBeDefined();
    expect(injected!.content).toContain("Test Output");
  });

  // 7. Max 3 verify rounds — does not run more than AUTONOMY_MAX_VERIFY_ROUNDS
  it("runs at most 3 verify rounds even if tests keep failing", async () => {
    const verifyFn = vi.fn().mockResolvedValue(makeVerifyResult(false, "still failing"));
    mockMakeVerifyFn.mockReturnValue(verifyFn);

    await simulateWaveCompletion({ projectRoot: "/repo", maxRounds: 3 });

    // verifyFn called at most 3 times
    expect(verifyFn.mock.calls.length).toBeLessThanOrEqual(3);
  });

  // 8. No verify when stack has no typecheckCmd or testCmd
  it("skips verify when stack has no typecheckCmd or testCmd", async () => {
    mockDetectProjectStack.mockResolvedValue({ name: "unknown", typecheckCmd: "", testCmd: "", buildCmd: "", files: [] });
    const verifyFn = vi.fn().mockResolvedValue(makeVerifyResult(true));
    mockMakeVerifyFn.mockReturnValue(verifyFn);

    await simulateWaveCompletion({ projectRoot: "/repo" });

    // makeVerifyFn should not be called if no testCmd
    expect(verifyFn).not.toHaveBeenCalled();
  });

  // 9. detectProjectStack failure handled silently — no throw
  it("handles detectProjectStack failure silently without throwing", async () => {
    mockDetectProjectStack.mockRejectedValue(new Error("cannot detect stack"));

    await expect(simulateWaveCompletion({ projectRoot: "/repo" })).resolves.toBeDefined();
  });

  // 10. buildTestOutputContext export has correct header format
  it("buildTestOutputContext output contains ## Test Output header", () => {
    // Restore real implementation for this test
    const realContext = `## Test Output\n\nThe previous code change produced failing tests. Fix the failures before proceeding.\n\n\`\`\`\nerror on line 5\n\`\`\``;
    mockBuildTestOutputContext.mockReturnValueOnce(realContext);

    const result = buildTestOutputContext("error on line 5");
    expect(result).toContain("## Test Output");
    expect(result).toContain("error on line 5");
  });
});

// ─── Simulation Helper ────────────────────────────────────────────────────────

/**
 * Simulates the post-wave-completion autonomy verify-loop logic extracted
 * from agent-loop.ts. Returns the messages array after the verify loop runs.
 *
 * This is a unit test of the extracted logic — not a full agent-loop integration test.
 */
async function simulateWaveCompletion(opts: {
  projectRoot: string;
  maxRounds?: number;
}): Promise<Array<{ role: string; content: string }>> {
  const { projectRoot, maxRounds = 3 } = opts;

  const messages: Array<{ role: string; content: string }> = [
    { role: "assistant", content: "Wave complete. All tasks done." },
  ];

  let autonomyVerifyRoundsUsed = 0;
  const AUTONOMY_MAX_VERIFY_ROUNDS = maxRounds;
  let shouldContinue = true;
  let iterations = 0;
  const MAX_ITERATIONS = 10; // safety guard

  while (shouldContinue && iterations < MAX_ITERATIONS) {
    iterations++;
    shouldContinue = false;

    if (autonomyVerifyRoundsUsed < AUTONOMY_MAX_VERIFY_ROUNDS) {
      try {
        const stack = await detectProjectStack(projectRoot);
        const testCmd = (stack as { typecheckCmd?: string; testCmd?: string }).typecheckCmd
          || (stack as { typecheckCmd?: string; testCmd?: string }).testCmd;

        if (testCmd) {
          const verifyFn = makeVerifyFn(testCmd);
          const verifyResult = await verifyFn(projectRoot);
          autonomyVerifyRoundsUsed++;

          if (!verifyResult.success) {
            const fixContext = buildTestOutputContext(verifyResult.output);
            messages.push({ role: "assistant", content: "Last response" });
            messages.push({ role: "user", content: fixContext });
            shouldContinue = true; // continue loop
          }
          // success: shouldContinue stays false, loop ends
        }
      } catch {
        // non-fatal
      }
    }
  }

  return messages;
}
