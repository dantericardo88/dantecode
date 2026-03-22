// ============================================================================
// @dantecode/cli — DanteForge Pipeline Tests (B5: Human-Readable Verification)
// ============================================================================

import { describe, it, expect } from "vitest";
import { formatVerificationVerdict, type VerificationDetails } from "./danteforge-pipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes for plain-text assertions. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function makeDetails(overrides: Partial<VerificationDetails> = {}): VerificationDetails {
  return {
    antiStubPassed: true,
    hardViolationCount: 0,
    hardViolationMessages: [],
    constitutionPassed: true,
    constitutionCriticalCount: 0,
    constitutionWarningCount: 0,
    constitutionMessages: [],
    pdseScore: 85,
    pdsePassedGate: true,
    pdseBreakdown: { completeness: 90, correctness: 85, clarity: 80, consistency: 85 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// formatVerificationVerdict
// ---------------------------------------------------------------------------

describe("formatVerificationVerdict", () => {
  it("shows green check when all pass with no warnings", () => {
    const result = formatVerificationVerdict(makeDetails(), false);
    const plain = stripAnsi(result);
    expect(plain).toContain("\u2713 Verified");
    expect(plain).toContain("no issues found");
  });

  it("shows yellow check when all pass with warnings", () => {
    const result = formatVerificationVerdict(
      makeDetails({ constitutionWarningCount: 3 }),
      false,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("\u2713 Verified");
    expect(plain).toContain("3 warning(s)");
  });

  it("shows failure when anti-stub fails", () => {
    const result = formatVerificationVerdict(
      makeDetails({
        antiStubPassed: false,
        hardViolationCount: 2,
        hardViolationMessages: ["stub found at line 10", "stub found at line 25"],
      }),
      false,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("Verification failed");
    expect(plain).toContain("2 stub(s)");
    expect(plain).toContain("stub found at line 10");
  });

  it("shows failure when constitution fails", () => {
    const result = formatVerificationVerdict(
      makeDetails({
        constitutionPassed: false,
        constitutionCriticalCount: 1,
        constitutionMessages: ["security: eval() usage"],
      }),
      false,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("Verification failed");
    expect(plain).toContain("1 policy violation(s)");
    expect(plain).toContain("security: eval() usage");
  });

  it("shows PDSE failure when only PDSE is below threshold", () => {
    const result = formatVerificationVerdict(
      makeDetails({ pdsePassedGate: false, pdseScore: 42 }),
      false,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("Could not fully verify");
    expect(plain).toContain("additional review needed");
  });

  it("non-verbose mode is a single line when all pass", () => {
    const result = formatVerificationVerdict(makeDetails(), false);
    expect(result.split("\n")).toHaveLength(1);
  });

  it("verbose mode includes full breakdown", () => {
    const result = formatVerificationVerdict(makeDetails(), true);
    const plain = stripAnsi(result);
    expect(plain).toContain("Anti-stub scan: PASSED");
    expect(plain).toContain("Constitution check: PASSED");
    expect(plain).toContain("PDSE score: 85/100");
    expect(plain).toContain("Completeness: 90");
    expect(plain).toContain("Correctness: 85");
    expect(plain).toContain("Clarity: 80");
    expect(plain).toContain("Consistency: 85");
  });

  it("verbose mode shows warning count on constitution", () => {
    const result = formatVerificationVerdict(
      makeDetails({ constitutionWarningCount: 5 }),
      true,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("5 warnings");
  });

  it("verbose mode shows FAILED for anti-stub when it fails", () => {
    const result = formatVerificationVerdict(
      makeDetails({ antiStubPassed: false, hardViolationCount: 3, hardViolationMessages: ["a", "b", "c"] }),
      true,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("Anti-stub scan: FAILED");
    expect(plain).toContain("3 hard violations");
  });

  it("limits displayed messages to first 2", () => {
    const result = formatVerificationVerdict(
      makeDetails({
        antiStubPassed: false,
        hardViolationCount: 5,
        hardViolationMessages: ["msg1", "msg2", "msg3", "msg4", "msg5"],
      }),
      false,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("msg1");
    expect(plain).toContain("msg2");
    expect(plain).not.toContain("msg3");
  });

  it("handles empty messages arrays gracefully", () => {
    const result = formatVerificationVerdict(
      makeDetails({ antiStubPassed: false, hardViolationCount: 0, hardViolationMessages: [] }),
      false,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("Verification failed");
    expect(plain).toContain("0 stub(s)");
  });

  it("anti-stub failure takes priority over constitution failure", () => {
    const result = formatVerificationVerdict(
      makeDetails({
        antiStubPassed: false,
        hardViolationCount: 1,
        hardViolationMessages: ["stub"],
        constitutionPassed: false,
        constitutionCriticalCount: 2,
        constitutionMessages: ["violation"],
      }),
      false,
    );
    const plain = stripAnsi(result);
    // Anti-stub should show (it's checked first)
    expect(plain).toContain("stub(s)");
  });
});
