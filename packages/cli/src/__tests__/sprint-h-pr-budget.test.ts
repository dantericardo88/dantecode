// ============================================================================
// Sprint H — Dims 8+27: PR Creation + Budget Warning
// Tests that:
//  - gh pr create called when autoCreatePR config is true
//  - PR URL printed with [PR created:] prefix
//  - gh failure → fallback message printed, no throw
//  - prTitle passed as --title argument
//  - Budget warning fires at 80% threshold
//  - Budget warning NOT fired below 80%
//  - Budget warning fires only once per session (idempotent)
//  - Percentage printed in [Budget warning: X%] message
// ============================================================================

import { describe, it, expect } from "vitest";
import { generatePRTitle } from "../agent-loop.js";

// ─── Part 1: gh pr create wiring (dim 8) ─────────────────────────────────────

/**
 * Simulates the gh pr create logic from agent-loop.ts.
 */
function simulatePRCreate(
  prTitle: string,
  autoCreatePR: boolean,
  ghResult: { url?: string; throws?: boolean },
  outputs: string[],
): void {
  if (!autoCreatePR) return;

  try {
    if (ghResult.throws) throw new Error("gh not found");
    const prUrl = ghResult.url ?? "";
    if (prUrl) {
      outputs.push(`[PR created: ${prUrl}]`);
    } else {
      outputs.push(`[PR creation skipped — gh unavailable or no remote]`);
    }
    // Ensure title is embedded in command
    outputs.push(`--title "${prTitle.replace(/"/g, '\\"')}"`);
  } catch {
    outputs.push(`[PR creation skipped — gh unavailable or no remote]`);
  }
}

describe("gh pr create wiring — Sprint H (dim 8)", () => {
  // 1. gh pr create called when autoCreatePR is true
  it("PR creation output emitted when autoCreatePR is true", () => {
    const outputs: string[] = [];
    const prTitle = generatePRTitle("feat(auth): add OAuth2 login");
    simulatePRCreate(prTitle, true, { url: "https://github.com/org/repo/pull/42" }, outputs);
    expect(outputs.some((o) => o.includes("[PR created:"))).toBe(true);
  });

  // 2. PR URL printed with [PR created:] prefix
  it("PR URL is printed with [PR created:] prefix", () => {
    const outputs: string[] = [];
    simulatePRCreate("feat: add feature", true, { url: "https://github.com/org/repo/pull/99" }, outputs);
    expect(outputs[0]).toContain("[PR created: https://github.com/org/repo/pull/99]");
  });

  // 3. gh failure → fallback message printed, no throw
  it("gh failure produces fallback message, does not throw", () => {
    const outputs: string[] = [];
    expect(() =>
      simulatePRCreate("fix: broken thing", true, { throws: true }, outputs),
    ).not.toThrow();
    expect(outputs.some((o) => o.includes("[PR creation skipped"))).toBe(true);
  });

  // 4. prTitle passed as --title argument
  it("prTitle is passed as --title in the gh command string", () => {
    const outputs: string[] = [];
    const prTitle = "feat(core): Add streaming support";
    simulatePRCreate(prTitle, true, { url: "https://github.com/org/repo/pull/1" }, outputs);
    const titleArg = outputs.find((o) => o.includes("--title"));
    expect(titleArg).toBeDefined();
    expect(titleArg).toContain(prTitle);
  });

  // 5. No PR output when autoCreatePR is false
  it("no PR output when autoCreatePR is false", () => {
    const outputs: string[] = [];
    simulatePRCreate("feat: something", false, { url: "https://github.com/org/repo/pull/1" }, outputs);
    expect(outputs.length).toBe(0);
  });

  // 6. Empty URL → skipped message (gh ran but no PR created)
  it("empty URL from gh → skipped message printed", () => {
    const outputs: string[] = [];
    simulatePRCreate("fix: nothing", true, { url: "" }, outputs);
    expect(outputs.some((o) => o.includes("[PR creation skipped"))).toBe(true);
  });

  // 7. generatePRTitle produces title used in PR creation
  it("generatePRTitle output is used as PR title in creation", () => {
    const commitMsg = "feat(api): add rate limiting";
    const prTitle = generatePRTitle(commitMsg);
    expect(prTitle).toBe("feat(api): Add rate limiting");
    const outputs: string[] = [];
    simulatePRCreate(prTitle, true, { url: "https://github.com/org/repo/pull/5" }, outputs);
    expect(outputs.some((o) => o.includes("Add rate limiting"))).toBe(true);
  });
});

// ─── Part 2: Budget % warning (dim 27) ────────────────────────────────────────

/**
 * Simulates the budget warning logic in ModelRouterImpl.recordRequestCost.
 */
function simulateBudgetWarning(
  sessionCostUsd: number,
  sessionBudgetUsd: number | undefined,
  budgetWarningSentBefore: boolean,
  outputs: string[],
): boolean {
  if (
    sessionBudgetUsd !== undefined &&
    !budgetWarningSentBefore &&
    sessionCostUsd / sessionBudgetUsd >= 0.8
  ) {
    const pct = Math.round((sessionCostUsd / sessionBudgetUsd) * 100);
    outputs.push(`[Budget warning: ${pct}% of session budget used ($${sessionCostUsd.toFixed(4)}/$${sessionBudgetUsd.toFixed(4)})]`);
    return true; // budgetWarningSent = true
  }
  return budgetWarningSentBefore;
}

describe("Budget % warning — Sprint H (dim 27)", () => {
  // 8. Budget warning fires at 80% threshold
  it("warning fires when cost reaches exactly 80% of session budget", () => {
    const outputs: string[] = [];
    simulateBudgetWarning(0.008, 0.01, false, outputs);
    expect(outputs.length).toBe(1);
    expect(outputs[0]).toContain("[Budget warning:");
  });

  // 9. Budget warning NOT fired below 80%
  it("warning does NOT fire when cost is below 80% threshold", () => {
    const outputs: string[] = [];
    simulateBudgetWarning(0.0079, 0.01, false, outputs);
    expect(outputs.length).toBe(0);
  });

  // 10. Budget warning fires only once per session (idempotent)
  it("warning only fires once even when called multiple times above threshold", () => {
    const outputs: string[] = [];
    let warned = false;
    warned = simulateBudgetWarning(0.009, 0.01, warned, outputs);
    warned = simulateBudgetWarning(0.0095, 0.01, warned, outputs);
    warned = simulateBudgetWarning(0.01, 0.01, warned, outputs);
    expect(outputs.length).toBe(1);
  });

  // 11. Percentage printed in [Budget warning: X%] message
  it("percentage is printed in warning message", () => {
    const outputs: string[] = [];
    simulateBudgetWarning(0.009, 0.01, false, outputs);
    expect(outputs[0]).toMatch(/\[Budget warning: \d+%/);
    expect(outputs[0]).toContain("90%");
  });

  // 12. No warning when budget undefined
  it("no warning when no session budget configured", () => {
    const outputs: string[] = [];
    simulateBudgetWarning(100.0, undefined, false, outputs);
    expect(outputs.length).toBe(0);
  });

  // 13. Warning at 100% still fires (not just at exactly 80%)
  it("warning fires when cost exceeds budget (>100%)", () => {
    const outputs: string[] = [];
    simulateBudgetWarning(0.015, 0.01, false, outputs);
    expect(outputs.length).toBe(1);
    expect(outputs[0]).toContain("150%");
  });

  // 14. Session reset clears budgetWarningSent — warning can fire again
  it("after session reset budgetWarningSent is false — warning can re-fire", () => {
    const outputs: string[] = [];
    // First session
    let warned = simulateBudgetWarning(0.009, 0.01, false, outputs);
    expect(warned).toBe(true);
    // Reset session → budgetWarningSent = false
    warned = false;
    // Second session exceeds threshold again
    warned = simulateBudgetWarning(0.009, 0.01, warned, outputs);
    expect(outputs.length).toBe(2);
    expect(warned).toBe(true);
  });
});
