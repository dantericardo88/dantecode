import { describe, it, expect } from "vitest";
import { PRQualityChecker } from "./pr-quality-checker.js";

const checker = new PRQualityChecker();

function makeDiff(addedLines: string[], removedLines: string[] = []): string {
  const parts = [
    "diff --git a/file.ts b/file.ts",
    "--- a/file.ts",
    "+++ b/file.ts",
    "@@ -1,5 +1,5 @@",
  ];
  for (const line of removedLines) parts.push(`-${line}`);
  for (const line of addedLines) parts.push(`+${line}`);
  return parts.join("\n");
}

describe("PRQualityChecker", () => {
  it("detects diff size and flags large PRs (>500 lines)", () => {
    const smallDiff = makeDiff(["const x = 1;", "const y = 2;"]);
    const smallReport = checker.check(smallDiff);
    expect(smallReport.size.isLarge).toBe(false);
    expect(smallReport.size.linesAdded).toBe(2);

    // Generate a large diff
    const largeLines = Array.from({ length: 300 }, (_, i) => `const v${i} = ${i};`);
    const largeDiff = makeDiff(largeLines, largeLines);
    const largeReport = checker.check(largeDiff);
    expect(largeReport.size.isLarge).toBe(true);
  });

  it("scans added lines for anti-stub violations", () => {
    const diff = makeDiff([
      "const feature = true;",
      "// TODO: implement this properly",
      "throw new Error('not implemented');",
      "const placeholder = null;",
    ]);
    const report = checker.check(diff);
    expect(report.antiStubViolations.length).toBeGreaterThanOrEqual(3);
  });

  it("validates commit message conventions", () => {
    const diff = makeDiff(["const x = 1;"]);
    const report = checker.check(diff, {
      commitMessages: [
        "feat(core): add memory consolidator", // valid
        "just fixed something", // invalid
        "fix: correct typo", // valid
      ],
    });
    expect(report.conventionViolations.length).toBe(1);
    expect(report.conventionViolations[0]).toContain("just fixed something");
  });

  it("scoring reflects test failures", () => {
    const diff = makeDiff(["const x = 1;"]);
    const passing = checker.check(diff, { testsPassed: true });
    const failing = checker.check(diff, { testsPassed: false });
    expect(passing.score).toBeGreaterThan(failing.score);
    expect(passing.score - failing.score).toBe(25); // test dimension is 25 pts
  });

  it("blocks PRs below threshold (default 70)", () => {
    // Bad PR: stub violations + failing tests + bad commits
    const diff = makeDiff([
      "// TODO fix this later",
      "// FIXME broken",
      "const stub = null;",
      "const placeholder = undefined;",
      "// TBD decide on approach",
    ]);
    const report = checker.check(diff, {
      testsPassed: false,
      commitMessages: ["bad message"],
    });
    expect(report.blocked).toBe(true);
    expect(report.score).toBeLessThan(70);
  });

  it("shouldBlock method respects custom threshold", () => {
    expect(checker.shouldBlock(65)).toBe(true);
    expect(checker.shouldBlock(75)).toBe(false);
    expect(checker.shouldBlock(45, 50)).toBe(true);
    expect(checker.shouldBlock(55, 50)).toBe(false);
  });
});
