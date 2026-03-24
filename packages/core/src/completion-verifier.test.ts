import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({ stat: vi.fn(), readFile: vi.fn() }));

import { stat, readFile } from "node:fs/promises";
import { verifyCompletion, deriveExpectations, summarizeVerification } from "./completion-verifier.js";
import type { CompletionVerification } from "./completion-verifier.js";
import type { RunReportEntry } from "./run-report.js";

const mockStat = stat as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as ReturnType<typeof vi.fn>;

function fakeStat() { return { isFile: () => true }; }

function makeEntry(overrides?: Partial<RunReportEntry>): RunReportEntry {
  return {
    prdName: "auth", prdFile: "prds/01-auth.md", status: "complete",
    filesCreated: [{ path: "src/auth.ts", lines: 100 }],
    filesModified: [{ path: "src/index.ts", added: 5, removed: 1 }],
    filesDeleted: [],
    verification: {
      antiStub: { passed: true, violations: 0, details: [] },
      constitution: { passed: true, violations: 0, warnings: 0, details: [] },
      pdseScore: 90, pdseThreshold: 85, regenerationAttempts: 0, maxAttempts: 3,
    },
    tests: { created: 5, passing: 5, failing: 0 },
    summary: "Built the auth feature.",
    startedAt: "2026-03-22T14:30:00Z", completedAt: "2026-03-22T14:45:00Z",
    tokenUsage: { input: 5000, output: 3000 },
    ...overrides,
  };
}

describe("verifyCompletion", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it("returns complete + high confidence when all files present", async () => {
    mockStat.mockResolvedValue(fakeStat());
    mockReadFile.mockResolvedValue("export function auth() { return true; }\n");
    const r = await verifyCompletion("/project", {
      expectedFiles: ["src/auth.ts", "src/db.ts", "src/api.ts"],
    });
    expect(r.verdict).toBe("complete");
    expect(r.confidence).toBe("high");
    expect(r.passed).toHaveLength(3);
    expect(r.failed).toHaveLength(0);
    expect(r.fileChecks).toHaveLength(3);
    expect(r.fileChecks[0]!.exists).toBe(true);
    expect(r.fileChecks[0]!.hasContent).toBe(true);
  });

  it("returns partial + medium confidence when some files missing", async () => {
    mockStat.mockResolvedValueOnce(fakeStat()).mockResolvedValueOnce(fakeStat())
      .mockRejectedValueOnce(new Error("ENOENT"));
    mockReadFile.mockResolvedValueOnce("content A\nline 2\n").mockResolvedValueOnce("content B\n");
    const r = await verifyCompletion("/project", {
      expectedFiles: ["src/auth.ts", "src/db.ts", "src/missing.ts"],
    });
    expect(r.verdict).toBe("partial");
    expect(r.confidence).toBe("medium");
    expect(r.passed).toHaveLength(2);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0]).toContain("missing.ts");
  });

  it("returns failed when no files present", async () => {
    mockStat.mockRejectedValue(new Error("ENOENT"));
    const r = await verifyCompletion("/project", {
      expectedFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
    });
    expect(r.verdict).toBe("failed");
    expect(r.passed).toHaveLength(0);
    expect(r.failed).toHaveLength(3);
  });

  it("reports pattern found as passed", async () => {
    mockReadFile.mockResolvedValue('export class AuthService {\n  login() { return "ok"; }\n}\n');
    const r = await verifyCompletion("/project", {
      expectedPatterns: [
        { file: "src/auth.ts", pattern: "class AuthService" },
        { file: "src/auth.ts", pattern: "login\\(\\)" },
      ],
    });
    expect(r.verdict).toBe("complete");
    expect(r.passed).toHaveLength(2);
    expect(r.patternChecks).toHaveLength(2);
    expect(r.patternChecks[0]!.found).toBe(true);
  });

  it("reports pattern not found as failed", async () => {
    mockReadFile.mockResolvedValue("export function hello() {}\n");
    const r = await verifyCompletion("/project", {
      expectedPatterns: [
        { file: "src/auth.ts", pattern: "class AuthService" },
        { file: "src/auth.ts", pattern: "export function hello" },
      ],
    });
    expect(r.verdict).toBe("partial");
    expect(r.passed).toHaveLength(1);
    expect(r.failed).toHaveLength(1);
    expect(r.patternChecks[0]!.found).toBe(false);
  });

  it("returns low confidence with only intentDescription", async () => {
    const r = await verifyCompletion("/project", { intentDescription: "Build a login page" });
    expect(r.confidence).toBe("low");
    expect(r.uncertain).toContain("Build a login page");
    expect(r.passed).toHaveLength(0);
    expect(r.summary).toContain("Low confidence");
  });

  it("returns low confidence with empty expectations", async () => {
    const r = await verifyCompletion("/project", {});
    expect(r.confidence).toBe("low");
    expect(r.verdict).toBe("failed");
    expect(r.summary).toContain("Low confidence");
  });

  it("counts test files in expectations", async () => {
    mockStat.mockResolvedValue(fakeStat());
    mockReadFile.mockResolvedValue('import { test } from "vitest";\ntest("works", () => {});\n');
    const r = await verifyCompletion("/project", {
      expectedTests: ["src/auth.test.ts", "src/db.test.ts", "src/api.test.ts"],
    });
    expect(r.verdict).toBe("complete");
    expect(r.confidence).toBe("high");
    expect(r.passed).toHaveLength(3);
    expect(r.fileChecks).toHaveLength(3);
  });
});

describe("deriveExpectations", () => {
  it("maps RunReportEntry files to expectedFiles", () => {
    const entry = makeEntry({
      filesCreated: [{ path: "src/auth.ts", lines: 100 }, { path: "src/auth.test.ts", lines: 50 }],
      filesModified: [{ path: "src/index.ts", added: 5, removed: 1 }],
    });
    const exp = deriveExpectations(entry);
    expect(exp.expectedFiles).toEqual(["src/auth.ts", "src/auth.test.ts", "src/index.ts"]);
    expect(exp.intentDescription).toBe("Built the auth feature.");
  });
});

describe("summarizeVerification", () => {
  it("produces plain-English output for mixed results", () => {
    const v: CompletionVerification = {
      verdict: "partial", confidence: "medium",
      passed: ["File exists: src/auth.ts", "File exists: src/db.ts"],
      failed: ["File missing: src/api.ts"], uncertain: [],
      fileChecks: [
        { file: "src/auth.ts", exists: true, hasContent: true, lines: 100 },
        { file: "src/db.ts", exists: true, hasContent: true, lines: 50 },
        { file: "src/api.ts", exists: false, hasContent: false },
      ],
      patternChecks: [], summary: "",
    };
    const text = summarizeVerification(v);
    expect(text).toContain("2/3 expected files found");
    expect(text).toContain("1 file missing: src/api.ts");
    expect(text).toContain("Confidence: medium");
  });

  it("includes low confidence message when confidence is low", () => {
    const v: CompletionVerification = {
      verdict: "failed", confidence: "low",
      passed: [], failed: [], uncertain: ["Build a login page"],
      fileChecks: [], patternChecks: [], summary: "",
    };
    const text = summarizeVerification(v);
    expect(text).toContain("Low confidence");
    expect(text).toContain("insufficient evidence");
  });
});
