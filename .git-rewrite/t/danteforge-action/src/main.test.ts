// ============================================================================
// @dantecode/danteforge-action - Tests
// Covers annotation builders, summary formatting, and the main verification
// flow under success and failure scenarios using module-level mocks.
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildCheckRunAnnotations,
  buildPRReviewComments,
  parseAntiStubViolations,
} from "./annotations.js";
import type {
  AntiStubResult,
  CheckRunAnnotation,
  PdseFileResult,
} from "./annotations.js";

// ---------------------------------------------------------------------------
// annotations.ts — buildCheckRunAnnotations
// ---------------------------------------------------------------------------

describe("buildCheckRunAnnotations", () => {
  it("returns empty array when PDSE is skipped and anti-stub passes", () => {
    const pdse = { files: [], skipped: true };
    const antiStub: AntiStubResult = { passed: true, output: "", violations: [] };

    const annotations = buildCheckRunAnnotations(pdse, antiStub);
    expect(annotations).toEqual([]);
  });

  it("creates warning annotations for PDSE failures", () => {
    const pdse = {
      files: [
        { filePath: "src/foo.ts", overall: 45, passed: false },
        { filePath: "src/bar.ts", overall: 90, passed: true },
      ],
      skipped: false,
    };
    const antiStub: AntiStubResult = { passed: true, output: "", violations: [] };

    const annotations = buildCheckRunAnnotations(pdse, antiStub);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      path: "src/foo.ts",
      start_line: 1,
      end_line: 1,
      annotation_level: "warning",
      title: "PDSE: 45/100",
    });
  });

  it("creates failure annotations for anti-stub violations", () => {
    const pdse = { files: [], skipped: true };
    const antiStub: AntiStubResult = {
      passed: false,
      output: "",
      violations: [
        { filePath: "src/utils.ts", line: 42, message: "stub detected - function body is empty" },
      ],
    };

    const annotations = buildCheckRunAnnotations(pdse, antiStub);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      path: "src/utils.ts",
      start_line: 42,
      end_line: 42,
      annotation_level: "failure",
      title: "Anti-Stub Violation",
    });
  });

  it("creates a fallback annotation when anti-stub fails but has no structured violations", () => {
    const pdse = { files: [], skipped: true };
    const antiStub: AntiStubResult = {
      passed: false,
      output: "Something went wrong with the scanner",
      violations: [],
    };

    const annotations = buildCheckRunAnnotations(pdse, antiStub);
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      path: ".",
      annotation_level: "failure",
      title: "Anti-Stub Failure",
    });
    expect(annotations[0]!.message).toContain("Something went wrong");
  });

  it("combines PDSE and anti-stub annotations", () => {
    const pdse = {
      files: [
        { filePath: "src/a.ts", overall: 30, passed: false },
        { filePath: "src/b.ts", overall: 20, passed: false },
      ],
      skipped: false,
    };
    const antiStub: AntiStubResult = {
      passed: false,
      output: "",
      violations: [
        { filePath: "src/c.ts", line: 10, message: "stub detected" },
      ],
    };

    const annotations = buildCheckRunAnnotations(pdse, antiStub);
    expect(annotations).toHaveLength(3);

    const levels = annotations.map((a) => a.annotation_level);
    expect(levels).toContain("warning");
    expect(levels).toContain("failure");
  });
});

// ---------------------------------------------------------------------------
// annotations.ts — buildPRReviewComments
// ---------------------------------------------------------------------------

describe("buildPRReviewComments", () => {
  it("returns empty array when PDSE is skipped", () => {
    const comments = buildPRReviewComments({ files: [], skipped: true });
    expect(comments).toEqual([]);
  });

  it("creates review comments for failed PDSE files only", () => {
    const pdse = {
      files: [
        { filePath: "src/low.ts", overall: 35, passed: false },
        { filePath: "src/high.ts", overall: 95, passed: true },
        { filePath: "src/mid.ts", overall: 55, passed: false },
      ],
      skipped: false,
    };

    const comments = buildPRReviewComments(pdse);
    expect(comments).toHaveLength(2);
    expect(comments[0]).toMatchObject({
      path: "src/low.ts",
      position: 1,
    });
    expect(comments[0]!.body).toContain("35/100");
    expect(comments[1]).toMatchObject({
      path: "src/mid.ts",
      position: 1,
    });
  });

  it("uses specific line when provided in PDSE result", () => {
    const pdse = {
      files: [{ filePath: "src/fn.ts", overall: 40, passed: false, line: 17 }],
      skipped: false,
    };

    const comments = buildPRReviewComments(pdse);
    expect(comments[0]!.position).toBe(17);
  });
});

// ---------------------------------------------------------------------------
// annotations.ts — parseAntiStubViolations
// ---------------------------------------------------------------------------

describe("parseAntiStubViolations", () => {
  it("returns empty array for empty input", () => {
    expect(parseAntiStubViolations("")).toEqual([]);
    expect(parseAntiStubViolations("   ")).toEqual([]);
  });

  it("parses standard violation format", () => {
    const output = [
      "src/utils.ts:42: stub detected - function body is empty",
      "packages/core/index.ts:7: placeholder return value",
    ].join("\n");

    const violations = parseAntiStubViolations(output);
    expect(violations).toHaveLength(2);
    expect(violations[0]).toEqual({
      filePath: "src/utils.ts",
      line: 42,
      message: "stub detected - function body is empty",
    });
    expect(violations[1]).toEqual({
      filePath: "packages/core/index.ts",
      line: 7,
      message: "placeholder return value",
    });
  });

  it("ignores lines that do not match the violation pattern", () => {
    const output = [
      "Running anti-stub scanner...",
      "src/main.ts:10: stub detected",
      "Done. 1 violation(s) found.",
    ].join("\n");

    const violations = parseAntiStubViolations(output);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.filePath).toBe("src/main.ts");
  });
});

// ---------------------------------------------------------------------------
// main.ts — buildSummary (imported directly, no side-effect concerns)
// ---------------------------------------------------------------------------

// buildSummary is a pure function so we import and test it directly.
// We use a lazy import inside the describe block to avoid triggering
// the module-level bootstrap (which is guarded, but this is belt-and-suspenders).

describe("buildSummary", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let buildSummaryFn: typeof import("./main.js")["buildSummary"];

  beforeEach(async () => {
    // Dynamic import so the module-level guard sees VITEST env var
    const mod = await import("./main.js");
    buildSummaryFn = mod.buildSummary;
  });

  it("produces PASS summary when all gates succeed", () => {
    const summary = buildSummaryFn({
      changedFiles: ["src/a.ts", "src/b.ts"],
      antiStub: { passed: true, output: "clean", violations: [] },
      pdse: {
        averageScore: 85,
        files: [
          { filePath: "src/a.ts", overall: 80, passed: true },
          { filePath: "src/b.ts", overall: 90, passed: true },
        ],
        failedFiles: [],
        skipped: false,
      },
      gstack: [{ command: "npm test", passed: true, output: "" }],
      pdseThreshold: 70,
      succeeded: true,
    });

    expect(summary).toContain("Status: PASS");
    expect(summary).toContain("Changed files: 2");
    expect(summary).toContain("Average score: 85");
    expect(summary).toContain("npm test: pass");
  });

  it("produces FAIL summary when anti-stub fails", () => {
    const summary = buildSummaryFn({
      changedFiles: ["src/c.ts"],
      antiStub: { passed: false, output: "3 stubs found", violations: [] },
      pdse: {
        averageScore: null,
        files: [],
        failedFiles: [],
        skipped: true,
      },
      gstack: [],
      pdseThreshold: 70,
      succeeded: false,
    });

    expect(summary).toContain("Status: FAIL");
    expect(summary).toContain("- Failed");
    expect(summary).toContain("3 stubs found");
  });

  it("shows PDSE skip reason when present", () => {
    const summary = buildSummaryFn({
      changedFiles: [],
      antiStub: { passed: true, output: "", violations: [] },
      pdse: {
        averageScore: null,
        files: [],
        failedFiles: [],
        skipped: true,
        reason: "Could not import @dantecode/danteforge in the action runtime.",
      },
      gstack: [],
      pdseThreshold: 70,
      succeeded: true,
    });

    expect(summary).toContain("Skipped: Could not import");
  });

  it("lists per-file PDSE results when not skipped", () => {
    const summary = buildSummaryFn({
      changedFiles: ["src/x.ts"],
      antiStub: { passed: true, output: "", violations: [] },
      pdse: {
        averageScore: 50,
        files: [{ filePath: "src/x.ts", overall: 50, passed: false }],
        failedFiles: [{ filePath: "src/x.ts", overall: 50, passed: false }],
        skipped: false,
      },
      gstack: [],
      pdseThreshold: 70,
      succeeded: false,
    });

    expect(summary).toContain("src/x.ts: 50 (fail)");
    expect(summary).toContain("Average score: 50 (threshold 70)");
  });

  it("shows GStack skip message when no commands configured", () => {
    const summary = buildSummaryFn({
      changedFiles: [],
      antiStub: { passed: true, output: "", violations: [] },
      pdse: { averageScore: null, files: [], failedFiles: [], skipped: true },
      gstack: [],
      pdseThreshold: 70,
      succeeded: true,
    });

    expect(summary).toContain("Skipped (no commands configured)");
  });

  it("shows GStack failure output", () => {
    const summary = buildSummaryFn({
      changedFiles: [],
      antiStub: { passed: true, output: "", violations: [] },
      pdse: { averageScore: null, files: [], failedFiles: [], skipped: true },
      gstack: [
        { command: "npm run lint", passed: false, output: "ESLint found 3 errors" },
      ],
      pdseThreshold: 70,
      succeeded: false,
    });

    expect(summary).toContain("npm run lint: fail");
    expect(summary).toContain("ESLint found 3 errors");
  });
});

// ---------------------------------------------------------------------------
// main.ts — run() integration (fully mocked I/O)
// ---------------------------------------------------------------------------

// For integration tests we mock @actions/core, @actions/github, node:child_process
// and node:fs/promises at the vitest module level so that run() exercises its
// real control flow while all external I/O is intercepted.

describe("run() integration", () => {
  const mockSetFailed = vi.fn();
  const mockSetOutput = vi.fn();
  const mockGetInput = vi.fn();
  const mockInfo = vi.fn();
  const mockWarning = vi.fn();
  const mockSummaryAddRaw = vi.fn();
  const mockSummaryWrite = vi.fn().mockResolvedValue(undefined);
  const mockExecFile = vi.fn();
  const mockReadFile = vi.fn();
  const mockWriteFile = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();

    mockSummaryWrite.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        "pdse-threshold": "70",
        "fail-on-stub": "true",
        "annotations-mode": "both",
        "gstack-commands": "",
        "github-token": "",
      };
      return inputs[name] ?? "";
    });

    vi.doMock("@actions/core", () => ({
      getInput: mockGetInput,
      setFailed: mockSetFailed,
      setOutput: mockSetOutput,
      info: mockInfo,
      warning: mockWarning,
      summary: {
        addRaw: mockSummaryAddRaw,
        write: mockSummaryWrite,
      },
    }));

    vi.doMock("@actions/github", () => ({
      context: {
        repo: { owner: "test-owner", repo: "test-repo" },
        sha: "abc123",
        payload: {},
      },
      getOctokit: vi.fn(),
    }));

    // Mock child_process.execFile to prevent real shell calls.
    // By default: git diff returns no files, anti-stub script succeeds.
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        if (cb) {
          cb(null, { stdout: "", stderr: "" });
        }
      },
    );

    vi.doMock("node:child_process", () => ({
      execFile: mockExecFile,
    }));

    vi.doMock("node:fs/promises", () => ({
      readFile: mockReadFile,
      writeFile: mockWriteFile,
    }));
  });

  it("sets passed=true when all checks succeed", async () => {
    const { run } = await import("./main.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("passed", "true");
    expect(mockSetFailed).not.toHaveBeenCalled();
  });

  it("calls setFailed when anti-stub check fails (script exit code 1)", async () => {
    // Make the anti-stub script (second execFile call) fail.
    let callCount = 0;
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callCount++;
        if (callCount === 2) {
          // Second call is the anti-stub script
          const err = Object.assign(new Error("Process exited with code 1"), {
            stdout: "src/foo.ts:10: stub detected",
            stderr: "",
          });
          cb?.(err, { stdout: "", stderr: "" });
        } else {
          cb?.(null, { stdout: "", stderr: "" });
        }
      },
    );

    const { run } = await import("./main.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("passed", "false");
    expect(mockSetFailed).toHaveBeenCalledWith(
      expect.stringContaining("verification failed"),
    );
  });

  it("calls setFailed when PDSE is below threshold", async () => {
    // Return a changed .ts file from git diff
    let callCount = 0;
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callCount++;
        if (callCount === 1) {
          // git diff returns a source file
          cb?.(null, { stdout: "src/low.ts\n", stderr: "" });
        } else {
          cb?.(null, { stdout: "", stderr: "" });
        }
      },
    );

    // Mock readFile to return source code
    mockReadFile.mockResolvedValue("function stub() {}");

    // Mock @dantecode/danteforge import with a low PDSE score
    vi.doMock("@dantecode/danteforge", () => ({
      runLocalPDSEScorer: () => ({ overall: 40 }),
    }));

    const { run } = await import("./main.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("passed", "false");
    expect(mockSetOutput).toHaveBeenCalledWith("pdse-average", "40");
    expect(mockSetFailed).toHaveBeenCalled();
  });

  it("sets stub-count output from violation count", async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(
      (
        _cmd: string,
        _args: string[],
        _opts: unknown,
        cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void,
      ) => {
        callCount++;
        if (callCount === 2) {
          const err = Object.assign(new Error("exit 1"), {
            stdout: "a.ts:1: stub\nb.ts:2: stub\nc.ts:3: stub",
            stderr: "",
          });
          cb?.(err, { stdout: "", stderr: "" });
        } else {
          cb?.(null, { stdout: "", stderr: "" });
        }
      },
    );

    const { run } = await import("./main.js");
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith("stub-count", "3");
  });

  it("writes summary via core.summary API", async () => {
    const { run } = await import("./main.js");
    await run();

    expect(mockSummaryAddRaw).toHaveBeenCalledWith(
      expect.stringContaining("DanteForge Verification"),
    );
    expect(mockSummaryWrite).toHaveBeenCalled();
  });

  it("writes SARIF report to disk", async () => {
    const { run } = await import("./main.js");
    await run();

    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining("danteforge-results.sarif"),
      expect.stringContaining('"version": "2.1.0"'),
      "utf-8",
    );
  });

  it("skips annotations when no github-token is available", async () => {
    const { run } = await import("./main.js");
    await run();

    // Should warn about missing token
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining("No GitHub token"),
    );
  });
});
