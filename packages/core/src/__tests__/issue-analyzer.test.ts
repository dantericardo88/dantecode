// packages/core/src/__tests__/issue-analyzer.test.ts
import { describe, it, expect } from "vitest";
import { analyzeIssue, formatAnalyzedIssueForPrompt, type IssueSignal } from "../issue-analyzer.js";

const BUG_ISSUE: IssueSignal = {
  title: "TypeError: Cannot read property 'length' of undefined in UserManager",
  body: `## Steps to Reproduce
1. Import \`UserManager\` from \`src/auth/user-manager.ts\`
2. Call \`manager.getUsers()\` with no arguments
3. Observe the crash

Expected: Returns empty array
Actual: TypeError: Cannot read property 'length' of undefined

## Stack Trace
\`\`\`
TypeError: Cannot read property 'length' of undefined
  at UserManager.getUsers (src/auth/user-manager.ts:45:18)
  at AuthController.listUsers (src/auth/controller.ts:23:12)
\`\`\``,
  language: "typescript",
};

const FEATURE_ISSUE: IssueSignal = {
  title: "Feature request: Add support for OAuth2 authentication",
  body: "It would be nice to have OAuth2 support so users can log in with Google.",
  labels: ["enhancement", "feature"],
};

const REGRESSION_ISSUE: IssueSignal = {
  title: "Regression: getUsers() used to work in version 2.0, broke in 2.1",
  body: "After upgrading from 2.0 to 2.1, the `getUsers` function no longer works.",
};

describe("analyzeIssue — type classification", () => {
  it("classifies TypeError issue as bug", () => {
    expect(analyzeIssue(BUG_ISSUE).type).toBe("bug");
  });

  it("classifies feature request as feature", () => {
    expect(analyzeIssue(FEATURE_ISSUE).type).toBe("feature");
  });

  it("classifies version regression as regression", () => {
    expect(analyzeIssue(REGRESSION_ISSUE).type).toBe("regression");
  });

  it("classifies performance issues correctly", () => {
    const perf: IssueSignal = { title: "Memory leak in WebSocket handler causes OOM", body: "..." };
    expect(analyzeIssue(perf).type).toBe("performance");
  });
});

describe("analyzeIssue — severity classification", () => {
  it("rates TypeError crash as high severity", () => {
    expect(analyzeIssue(BUG_ISSUE).severity).toMatch(/high|critical/);
  });

  it("rates feature request as low severity", () => {
    expect(analyzeIssue(FEATURE_ISSUE).severity).toBe("low");
  });

  it("uses label to boost severity to critical", () => {
    const issue: IssueSignal = {
      title: "Minor display issue",
      body: "Small visual glitch",
      labels: ["critical", "p0"],
    };
    expect(analyzeIssue(issue).severity).toBe("critical");
  });
});

describe("analyzeIssue — error signatures", () => {
  it("extracts TypeError from bug report", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.errorSignatures.length).toBeGreaterThan(0);
    expect(analyzed.errorSignatures[0]!.type).toContain("TypeError");
  });

  it("extracts error message fragment", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.errorSignatures[0]!.message).toContain("length");
  });

  it("returns empty array for feature requests", () => {
    expect(analyzeIssue(FEATURE_ISSUE).errorSignatures).toHaveLength(0);
  });

  it("extracts TypeScript error codes (TS2304)", () => {
    const issue: IssueSignal = {
      title: "TS2304: Cannot find name 'foo'",
      body: "Getting TS2304: Cannot find name 'foo' when building",
    };
    const analyzed = analyzeIssue(issue);
    expect(analyzed.errorSignatures.some((e) => e.type.includes("TS2304"))).toBe(true);
  });
});

describe("analyzeIssue — file hints", () => {
  it("extracts file path from backtick mention", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.fileHints.some((h) => h.path.includes("user-manager"))).toBe(true);
  });

  it("gives high confidence to directly mentioned files", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    const highConf = analyzed.fileHints.filter((h) => h.confidence >= 0.8);
    expect(highConf.length).toBeGreaterThan(0);
  });

  it("extracts symbol names from issue", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.symbols.some((s) => s.includes("UserManager"))).toBe(true);
  });
});

describe("analyzeIssue — reproduction steps", () => {
  it("extracts numbered steps", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.reproductionSteps.length).toBeGreaterThanOrEqual(3);
  });

  it("step 1 is the first action", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.reproductionSteps[0]!.step).toBe(1);
    expect(analyzed.reproductionSteps[0]!.action.length).toBeGreaterThan(5);
  });
});

describe("analyzeIssue — search queries", () => {
  it("generates non-empty search queries", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.searchQueries.length).toBeGreaterThan(0);
  });

  it("includes symbol names in search queries", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    const allQueries = analyzed.searchQueries.join(" ");
    expect(allQueries).toMatch(/UserManager|getUsers|TypeError/);
  });
});

describe("analyzeIssue — problem statement", () => {
  it("generates a non-empty problem statement", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.problemStatement.length).toBeGreaterThan(10);
  });

  it("includes the error type in bug statements", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    expect(analyzed.problemStatement).toContain("TypeError");
  });
});

describe("formatAnalyzedIssueForPrompt", () => {
  it("contains Issue Analysis header", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    const formatted = formatAnalyzedIssueForPrompt(analyzed);
    expect(formatted).toContain("Issue Analysis");
  });

  it("contains file hints section when hints exist", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    const formatted = formatAnalyzedIssueForPrompt(analyzed);
    expect(formatted).toContain("relevant files");
  });

  it("contains search queries section", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    const formatted = formatAnalyzedIssueForPrompt(analyzed);
    expect(formatted).toContain("Search queries");
  });

  it("contains type and severity", () => {
    const analyzed = analyzeIssue(BUG_ISSUE);
    const formatted = formatAnalyzedIssueForPrompt(analyzed);
    expect(formatted).toContain("Type:");
    expect(formatted).toContain("Severity:");
  });
});
