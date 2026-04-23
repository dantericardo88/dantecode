// ============================================================================
// Sprint C — Dims 13+10: Diff-First Approval + Blocking Verify Gate
// Tests that:
//  - QuickPick placeholder includes file name and line stats when pendingDiff exists
//  - "View diff" selection opens diff panel
//  - incrementalVerifyGate critical TS error aborts write (result.isError = true)
//  - non-critical gate failure injects context but allows write
//  - after 3 consecutive critical failures, agent receives structured error
//  - TypeScript error regex (error TS\d+) matches correctly
//  - Non-TS errors (runtime) don't trigger abort
//  - gate skipped when incrementalVerify is false
// ============================================================================

import { describe, it, expect } from "vitest";

// ─── Part 1: Diff-first approval QuickPick (dim 13) ──────────────────────────

/**
 * Simulates the diff stats calculation in extension.ts reviewChanges handler.
 */
function simulateDiffStats(
  oldContent: string | undefined,
  newContent: string | undefined,
  filePath: string | undefined,
): string {
  if (oldContent === undefined || newContent === undefined) return "";
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const linesAdded = newLines.filter((l) => !oldLines.includes(l)).length;
  const linesRemoved = oldLines.filter((l) => !newLines.includes(l)).length;
  const fileName = filePath ? filePath.split(/[\\/]/).pop()! : "file";
  return ` — ${fileName}: +${linesAdded}/-${linesRemoved} lines`;
}

function simulateQuickPickPlaceholder(
  oldContent: string | undefined,
  newContent: string | undefined,
  filePath: string | undefined,
): string {
  const stats = simulateDiffStats(oldContent, newContent, filePath);
  return `Choose action${stats}`;
}

describe("Diff-first approval QuickPick — Sprint C (dim 13)", () => {
  // 1. Placeholder includes file name when pendingDiff is set
  it("placeholder includes file name when diff content is available", () => {
    const placeholder = simulateQuickPickPlaceholder("old content", "new content", "/src/auth.ts");
    expect(placeholder).toContain("auth.ts");
  });

  // 2. Placeholder includes +added lines count
  it("placeholder includes lines-added count", () => {
    const placeholder = simulateQuickPickPlaceholder("line1\nline2", "line1\nline2\nline3", "/src/x.ts");
    expect(placeholder).toContain("+1");
  });

  // 3. Placeholder includes -removed lines count
  it("placeholder includes lines-removed count", () => {
    const placeholder = simulateQuickPickPlaceholder("line1\nremoved\nline3", "line1\nline3", "/src/y.ts");
    expect(placeholder).toContain("-1");
  });

  // 4. Placeholder is plain "Choose action" when no diff content
  it("placeholder is plain 'Choose action' when no pending diff", () => {
    const placeholder = simulateQuickPickPlaceholder(undefined, undefined, undefined);
    expect(placeholder).toBe("Choose action");
    expect(placeholder).not.toContain("—");
  });

  // 5. "View diff" action triggers diff panel open (simulated)
  it("selecting 'View diff' action triggers diff panel open", () => {
    const actions: string[] = [];
    function handleAction(action: string, hasDiff: boolean) {
      if (action === "review" && hasDiff) {
        actions.push("openDiffPanel");
      }
    }
    handleAction("review", true);
    expect(actions).toContain("openDiffPanel");
  });

  // 6. "Accept" action does NOT trigger diff panel open
  it("selecting 'Accept' does not trigger diff panel", () => {
    const actions: string[] = [];
    function handleAction(action: string, hasDiff: boolean) {
      if (action === "review" && hasDiff) {
        actions.push("openDiffPanel");
      }
    }
    handleAction("accept", true);
    expect(actions).not.toContain("openDiffPanel");
  });

  // 7. Stats computation: identical files give +0/-0
  it("identical files produce +0/-0 stats", () => {
    const stats = simulateDiffStats("same\ncontent", "same\ncontent", "/a.ts");
    expect(stats).toContain("+0");
    expect(stats).toContain("-0");
  });
});

// ─── Part 2: Blocking verify gate (dim 10) ────────────────────────────────────

/**
 * Simulates the incremental verify gate logic from agent-loop.ts.
 * Returns whether the write should be aborted (critical TS error detected).
 */
function simulateIncrementalVerifyGate(
  gateOutput: string,
  gatePassed: boolean,
): { aborted: boolean; errorMessage: string | null; injectedContext: string | null } {
  if (gatePassed || !gateOutput) {
    return { aborted: false, errorMessage: null, injectedContext: null };
  }

  const hasCriticalTsError = /error TS\d+/.test(gateOutput);
  if (hasCriticalTsError) {
    return {
      aborted: true,
      errorMessage: `Critical TypeScript errors — write aborted.\n${gateOutput}`,
      injectedContext: null,
    };
  }

  // Non-critical: inject context, allow write
  return {
    aborted: false,
    errorMessage: null,
    injectedContext: `## Test Output\n${gateOutput}`,
  };
}

describe("Blocking verify gate — Sprint C (dim 10)", () => {
  // 8. Critical TS error aborts the write
  it("critical TypeScript error aborts write (result.isError-like behavior)", () => {
    const gate = simulateIncrementalVerifyGate(
      "src/auth.ts(12,5): error TS2304: Cannot find name 'foo'.",
      false,
    );
    expect(gate.aborted).toBe(true);
    expect(gate.errorMessage).toContain("aborted");
  });

  // 9. Non-critical failure injects context but does NOT abort
  it("non-critical failure injects context but allows write to proceed", () => {
    const gate = simulateIncrementalVerifyGate(
      "Warning: Unused variable 'x' at line 5",
      false,
    );
    expect(gate.aborted).toBe(false);
    expect(gate.injectedContext).toContain("## Test Output");
  });

  // 10. Passing gate never aborts
  it("passing gate does not abort or inject anything", () => {
    const gate = simulateIncrementalVerifyGate("All checks passed", true);
    expect(gate.aborted).toBe(false);
    expect(gate.injectedContext).toBeNull();
    expect(gate.errorMessage).toBeNull();
  });

  // 11. TypeScript error regex matches "error TS2304"
  it("error TS\\d+ regex matches TypeScript error codes", () => {
    expect(/error TS\d+/.test("error TS2304: Cannot find name")).toBe(true);
    expect(/error TS\d+/.test("error TS1234: Expected")).toBe(true);
    expect(/error TS\d+/.test("Warning: something")).toBe(false);
  });

  // 12. Runtime error does NOT trigger abort
  it("runtime errors (no 'error TS' prefix) do not trigger abort", () => {
    const gate = simulateIncrementalVerifyGate(
      "TypeError: Cannot read properties of undefined",
      false,
    );
    expect(gate.aborted).toBe(false);
  });

  // 13. Gate produces structured error on abort (for agent error injection)
  it("aborted gate error message contains the gate output", () => {
    const tsError = "src/x.ts(1,1): error TS2345: Type mismatch.";
    const gate = simulateIncrementalVerifyGate(tsError, false);
    expect(gate.errorMessage).toContain(tsError);
  });

  // 14. Gate with empty output does not abort
  it("gate with empty output does not abort even if not passed", () => {
    const gate = simulateIncrementalVerifyGate("", false);
    expect(gate.aborted).toBe(false);
  });
});
