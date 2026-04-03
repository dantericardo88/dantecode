// ============================================================================
// @dantecode/cli — Human-Friendly Output Tests (OnRamp v1.3)
// Verifies that raw PDSE scores never leak to non-technical users.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StreamRenderer } from "./stream-renderer.js";
import { formatVerificationVerdict } from "./danteforge-pipeline.js";
import type { VerificationDetails } from "./danteforge-pipeline.js";

// Strip ANSI escape codes for content assertions
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

// ---------------------------------------------------------------------------
// Stream Renderer Footer — Human-Friendly Output
// ---------------------------------------------------------------------------

describe("StreamRenderer._renderFooter (human-friendly)", () => {
  let output: string;
  const originalWrite = process.stdout.write;

  beforeEach(() => {
    output = "";
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("shows 'Verified' for high PDSE scores (>= 0.75)", () => {
    const renderer = new StreamRenderer({ colors: false });
    renderer.write("test");
    renderer.finish({ pdseScore: 0.87 });
    expect(output).toContain("Verified");
    expect(output).not.toContain("pdse:");
    expect(output).not.toContain("0.87");
  });

  it("shows 'Review recommended' for medium PDSE scores (0.5-0.75)", () => {
    const renderer = new StreamRenderer({ colors: false });
    renderer.write("test");
    renderer.finish({ pdseScore: 0.62 });
    expect(output).toContain("Review recommended");
    expect(output).not.toContain("pdse:");
  });

  it("shows 'Needs attention' for low PDSE scores (< 0.5)", () => {
    const renderer = new StreamRenderer({ colors: false });
    renderer.write("test");
    renderer.finish({ pdseScore: 0.35 });
    expect(output).toContain("Needs attention");
    expect(output).not.toContain("pdse:");
  });

  it("shows elapsed time in human-readable seconds", () => {
    const renderer = new StreamRenderer({ colors: false });
    renderer.write("test");
    renderer.finish({ elapsedMs: 3456 });
    expect(output).toContain("3.5s");
  });

  it("shows token count with locale formatting", () => {
    const renderer = new StreamRenderer({ colors: false });
    renderer.write("test");
    renderer.finish({ tokens: 12345 });
    expect(output).toContain("tokens");
  });

  it("produces no output when no options are provided", () => {
    const renderer = new StreamRenderer({ colors: false });
    renderer.write("test");
    renderer.finish({});
    // Should only have the trailing newline from write, no footer
    expect(output).not.toContain("[");
  });
});

// ---------------------------------------------------------------------------
// formatVerificationVerdict — No Raw PDSE in Non-Verbose Mode
// ---------------------------------------------------------------------------

describe("formatVerificationVerdict (non-verbose)", () => {
  function makeDetails(overrides: Partial<VerificationDetails> = {}): VerificationDetails {
    return {
      antiStubPassed: true,
      hardViolationCount: 0,
      hardViolationMessages: [],
      constitutionPassed: true,
      constitutionCriticalCount: 0,
      constitutionWarningCount: 0,
      constitutionMessages: [],
      pdseScore: 94,
      pdsePassedGate: true,
      ...overrides,
    };
  }

  it("shows 'Verified — no issues found' when all pass", () => {
    const result = formatVerificationVerdict(makeDetails(), false);
    const plain = stripAnsi(result);
    expect(plain).toContain("Verified");
    expect(plain).toContain("no issues found");
  });

  it("shows 'Verified — N warning(s)' when warnings exist", () => {
    const result = formatVerificationVerdict(makeDetails({ constitutionWarningCount: 3 }), false);
    const plain = stripAnsi(result);
    expect(plain).toContain("Verified");
    expect(plain).toContain("3 warning(s)");
  });

  it("shows 'caught N stub(s)' when anti-stub fails", () => {
    const result = formatVerificationVerdict(
      makeDetails({
        antiStubPassed: false,
        hardViolationCount: 2,
        hardViolationMessages: ["empty body", "placeholder"],
      }),
      false,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("caught 2 stub(s)");
  });

  it("shows PDSE score on failure even in non-verbose mode (P1 requirement)", () => {
    const result = formatVerificationVerdict(
      makeDetails({
        pdsePassedGate: false,
        pdseScore: 42,
        pdseBreakdown: { completeness: 40, correctness: 44, clarity: 41, consistency: 43 },
      }),
      false,
    );
    const plain = stripAnsi(result);
    expect(plain).toContain("additional review needed");
    expect(plain).toContain("42/100");
    expect(plain).toContain("Completeness");
  });

  it("shows PDSE score in verbose mode (power users)", () => {
    const result = formatVerificationVerdict(makeDetails({ pdseScore: 94 }), true);
    const plain = stripAnsi(result);
    expect(plain).toContain("94/100");
  });

  it("does NOT show breakdown in non-verbose mode when all checks pass", () => {
    const result = formatVerificationVerdict(makeDetails(), false);
    const plain = stripAnsi(result);
    expect(plain).toContain("no issues found");
    expect(plain).not.toContain("PDSE score");
  });
});
