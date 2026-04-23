// packages/core/src/__tests__/pr-automation.test.ts
import { describe, it, expect } from "vitest";
import {
  parseDiffStat,
  generatePrContent,
  detectReviewAnnotations,
} from "../pr-automation.js";

const SAMPLE_NUMSTAT = `
15\t3\tpackages/core/src/auth.ts
42\t8\tpackages/core/src/routes.ts
23\t0\tpackages/core/src/__tests__/auth.test.ts
0\t45\tpackages/core/src/legacy-auth.ts
5\t2\t.github/workflows/ci.yml
`.trim();

describe("parseDiffStat", () => {
  it("parses numstat format into ChangedFile array", () => {
    const result = parseDiffStat(SAMPLE_NUMSTAT);
    expect(result.files).toHaveLength(5);
  });

  it("calculates total additions and deletions", () => {
    const result = parseDiffStat(SAMPLE_NUMSTAT);
    expect(result.totalAdditions).toBe(85); // 15+42+23+0+5
    expect(result.totalDeletions).toBe(58); // 3+8+0+45+2
  });

  it("identifies test files", () => {
    const result = parseDiffStat(SAMPLE_NUMSTAT);
    expect(result.testFiles).toHaveLength(1);
    expect(result.testFiles[0]).toContain("auth.test.ts");
  });

  it("identifies infra files (.github/workflows)", () => {
    const result = parseDiffStat(SAMPLE_NUMSTAT);
    expect(result.infraFiles).toHaveLength(1);
    expect(result.infraFiles[0]).toContain("ci.yml");
  });

  it("detects primary language as TypeScript", () => {
    const result = parseDiffStat(SAMPLE_NUMSTAT);
    expect(result.primaryLanguage).toBe("TypeScript");
  });

  it("marks pure-addition files as status:added", () => {
    const result = parseDiffStat(SAMPLE_NUMSTAT);
    const testFile = result.files.find((f) => f.path.includes("auth.test.ts"));
    expect(testFile?.status).toBe("added");
  });

  it("marks pure-deletion files as status:deleted", () => {
    const result = parseDiffStat(SAMPLE_NUMSTAT);
    const legacyFile = result.files.find((f) => f.path.includes("legacy-auth.ts"));
    expect(legacyFile?.status).toBe("deleted");
  });

  it("handles empty input", () => {
    const result = parseDiffStat("");
    expect(result.files).toHaveLength(0);
    expect(result.totalAdditions).toBe(0);
  });

  it("detects Python files as primary language", () => {
    const pyNumstat = "50\t5\tapp/models.py\n30\t2\tapp/views.py";
    const result = parseDiffStat(pyNumstat);
    expect(result.primaryLanguage).toBe("Python");
  });
});

describe("generatePrContent", () => {
  it("generates a PR title with conventional prefix", () => {
    const summary = parseDiffStat(SAMPLE_NUMSTAT);
    const result = generatePrContent(summary, "Add JWT authentication to API");
    expect(result.title).toMatch(/^(feat|fix|chore|docs|refactor|test|style|perf):/);
  });

  it("includes goal in PR body", () => {
    const summary = parseDiffStat(SAMPLE_NUMSTAT);
    const result = generatePrContent(summary, "Add JWT authentication to API");
    expect(result.body).toContain("Add JWT authentication to API");
  });

  it("marks hasTests=true when test files are present", () => {
    const summary = parseDiffStat(SAMPLE_NUMSTAT);
    const result = generatePrContent(summary, "Add auth");
    expect(result.hasTests).toBe(true);
  });

  it("marks hasTests=false when no test files", () => {
    const noTestStat = "15\t3\tpackages/core/src/auth.ts\n5\t2\tpackages/core/src/routes.ts";
    const summary = parseDiffStat(noTestStat);
    const result = generatePrContent(summary, "Quick fix");
    expect(result.hasTests).toBe(false);
  });

  it("detects security changes for auth files", () => {
    const summary = parseDiffStat(SAMPLE_NUMSTAT); // contains auth.ts
    const result = generatePrContent(summary, "Update authentication");
    expect(result.hasSecurityChanges).toBe(true);
  });

  it("adds has-tests label when tests present", () => {
    const summary = parseDiffStat(SAMPLE_NUMSTAT);
    const result = generatePrContent(summary, "Add auth");
    expect(result.labels).toContain("has-tests");
  });

  it("adds security label for auth files", () => {
    const summary = parseDiffStat(SAMPLE_NUMSTAT);
    const result = generatePrContent(summary, "Update auth");
    expect(result.labels).toContain("security");
  });

  it("uses fix prefix for bug fix goals", () => {
    const summary = parseDiffStat("5\t2\tsrc/app.ts");
    const result = generatePrContent(summary, "Fix the login bug causing 500 error");
    expect(result.title).toMatch(/^fix:/);
  });

  it("uses test prefix for test-focused goals", () => {
    const summary = parseDiffStat("20\t0\tsrc/__tests__/auth.test.ts");
    const result = generatePrContent(summary, "Add test coverage for auth module");
    expect(result.title).toMatch(/^test:/);
  });

  it("includes DanteCode attribution in body", () => {
    const summary = parseDiffStat(SAMPLE_NUMSTAT);
    const result = generatePrContent(summary, "Test");
    expect(result.body).toContain("DanteCode");
  });

  it("includes session notes in body when provided", () => {
    const summary = parseDiffStat(SAMPLE_NUMSTAT);
    const result = generatePrContent(summary, "Test", "Implemented using JWT RS256 signing");
    expect(result.body).toContain("JWT RS256");
  });
});

describe("detectReviewAnnotations", () => {
  it("detects eval() usage as security error", () => {
    const lines = ["+const result = eval(userInput);"];
    const anns = detectReviewAnnotations("app.js", lines);
    expect(anns).toHaveLength(1);
    expect(anns[0]!.category).toBe("security");
    expect(anns[0]!.severity).toBe("error");
  });

  it("detects innerHTML assignment as security warning", () => {
    const lines = ["+element.innerHTML = userContent;"];
    const anns = detectReviewAnnotations("app.js", lines);
    expect(anns[0]!.category).toBe("security");
  });

  it("detects console.log as style suggestion", () => {
    const lines = ["+console.log('debug:', data);"];
    const anns = detectReviewAnnotations("app.ts", lines);
    expect(anns[0]!.category).toBe("style");
    expect(anns[0]!.severity).toBe("suggestion");
  });

  it("skips unchanged lines (no + prefix)", () => {
    const lines = [" console.log('not added');", "-console.log('deleted');"];
    const anns = detectReviewAnnotations("app.ts", lines);
    expect(anns).toHaveLength(0);
  });

  it("detects hardcoded password as security error", () => {
    const lines = ['+const password = "secret123";'];
    const anns = detectReviewAnnotations("config.ts", lines);
    expect(anns[0]!.severity).toBe("error");
    expect(anns[0]!.comment).toContain("password");
  });

  it("returns empty array for clean code", () => {
    const lines = ["+const x = compute(data);", "+return x * 2;"];
    const anns = detectReviewAnnotations("math.ts", lines);
    expect(anns).toHaveLength(0);
  });

  it("records correct file path in annotation", () => {
    const lines = ["+eval('bad');"];
    const anns = detectReviewAnnotations("src/evil.ts", lines);
    expect(anns[0]!.file).toBe("src/evil.ts");
  });
});
