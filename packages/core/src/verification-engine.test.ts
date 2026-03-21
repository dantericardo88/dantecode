import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  VerificationEngine,
  type VerificationStageResult,
  type VerificationReport,
} from "./verification-engine.js";

// Mock node:fs (existsSync) at module level
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from "node:fs";

const mockExistsSync = existsSync as ReturnType<typeof vi.fn>;

describe("VerificationEngine", () => {
  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExec = vi.fn();
    // Default: no config files exist
    mockExistsSync.mockReturnValue(false);
  });

  // =========================================================================
  // 1. Constructor (3 tests)
  // =========================================================================

  describe("constructor", () => {
    it("uses default options when none provided", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      // detectTestRunner will check file existence — verify engine is usable
      const runner = engine.detectTestRunner();
      expect(runner.runner).toBe("unknown");
    });

    it("merges custom options with defaults", () => {
      const engine = new VerificationEngine("/project", {
        stages: ["unit"],
        maxFixAttempts: 5,
        pdseGate: 0.5,
        execSyncFn: mockExec,
      });

      // Verify custom stages by running verify — only 1 stage
      mockExec.mockReturnValue("");
      const report = engine.verify();
      expect(report.stages).toHaveLength(1);
      expect(report.stages[0]!.stage).toBe("unit");
    });

    it("uses injected execSyncFn instead of real execSync", () => {
      const customExec = vi.fn().mockReturnValue("");
      const engine = new VerificationEngine("/project", {
        execSyncFn: customExec,
        stages: ["unit"],
      });

      // vitest.config.ts doesn't exist, so unit stage uses unknown runner
      engine.runStage("unit");
      expect(customExec).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. detectTestRunner (5 tests)
  // =========================================================================

  describe("detectTestRunner", () => {
    it("detects vitest when vitest.config.ts exists", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("vitest.config.ts"));

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const runner = engine.detectTestRunner();
      expect(runner.runner).toBe("vitest");
      expect(runner.command).toBe("npx vitest run");
      expect(runner.configFile).toBe("vitest.config.ts");
    });

    it("detects jest when jest.config.js exists", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("jest.config.js"));

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const runner = engine.detectTestRunner();
      expect(runner.runner).toBe("jest");
      expect(runner.command).toBe("npx jest");
      expect(runner.configFile).toBe("jest.config.js");
    });

    it("detects pytest when pytest.ini exists", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("pytest.ini"));

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const runner = engine.detectTestRunner();
      expect(runner.runner).toBe("pytest");
      expect(runner.command).toBe("pytest");
      expect(runner.configFile).toBe("pytest.ini");
    });

    it("detects go when go.mod exists", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("go.mod"));

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const runner = engine.detectTestRunner();
      expect(runner.runner).toBe("go");
      expect(runner.command).toBe("go test ./...");
    });

    it("returns unknown when no config files found", () => {
      mockExistsSync.mockReturnValue(false);

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const runner = engine.detectTestRunner();
      expect(runner.runner).toBe("unknown");
      expect(runner.configFile).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. getStageCommand (4 tests)
  // =========================================================================

  describe("getStageCommand", () => {
    it("returns tsc --noEmit for typecheck when tsconfig.json exists", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      expect(engine.getStageCommand("typecheck")).toBe("npx tsc --noEmit");
    });

    it("returns eslint command for lint when .eslintrc.js exists", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes(".eslintrc.js"));

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      expect(engine.getStageCommand("lint")).toBe("npx eslint . --max-warnings=0");
    });

    it("returns detected runner command for unit stage", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("vitest.config.ts"));

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      expect(engine.getStageCommand("unit")).toBe("npx vitest run");
    });

    it("returns skip when no config file exists for stage", () => {
      mockExistsSync.mockReturnValue(false);

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      expect(engine.getStageCommand("typecheck")).toBe("skip");
      expect(engine.getStageCommand("lint")).toBe("skip");
    });
  });

  // =========================================================================
  // 4. runStage (5 tests)
  // =========================================================================

  describe("runStage", () => {
    it("returns passing result when command succeeds", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));
      mockExec.mockReturnValue("");

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const result = engine.runStage("typecheck");

      expect(result.passed).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stage).toBe("typecheck");
    });

    it("returns failing result with parsed errors when command fails", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));
      const tsError = "src/foo.ts:12:5 - error TS2345: Argument of type 'string' is not assignable";
      mockExec.mockImplementation(() => {
        const err = new Error("Command failed") as Error & {
          status: number;
          stdout: string;
          stderr: string;
        };
        err.status = 1;
        err.stdout = tsError;
        err.stderr = "";
        throw err;
      });

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const result = engine.runStage("typecheck");

      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(1);
      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.parsedErrors[0]!.errorType).toBe("typescript");
    });

    it("handles timeout by capturing error message", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));
      mockExec.mockImplementation(() => {
        const err = new Error("TIMEOUT") as Error & {
          status: number;
          stdout: string;
          stderr: string;
        };
        err.status = 1;
        err.stdout = "";
        err.stderr = "";
        throw err;
      });

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
        timeout: 100,
      });
      const result = engine.runStage("typecheck");

      expect(result.passed).toBe(false);
      expect(result.stderr).toBe("TIMEOUT");
    });

    it("captures both stdout and stderr", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));
      mockExec.mockImplementation(() => {
        const err = new Error("fail") as Error & {
          status: number;
          stdout: string;
          stderr: string;
        };
        err.status = 2;
        err.stdout = "stdout content";
        err.stderr = "stderr content";
        throw err;
      });

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const result = engine.runStage("typecheck");

      expect(result.stdout).toBe("stdout content");
      expect(result.stderr).toBe("stderr content");
    });

    it("measures duration in milliseconds", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));
      mockExec.mockReturnValue("");

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const result = engine.runStage("typecheck");

      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // 5. verify (5 tests)
  // =========================================================================

  describe("verify", () => {
    it("reports all passed when every stage succeeds", () => {
      // Enable typecheck and lint config files
      mockExistsSync.mockImplementation(
        (p: string) => p.includes("tsconfig.json") || p.includes(".eslintrc.js"),
      );
      mockExec.mockReturnValue("");

      const engine = new VerificationEngine("/project", {
        stages: ["typecheck", "lint", "unit"],
        execSyncFn: mockExec,
      });
      const report = engine.verify();

      expect(report.overallPassed).toBe(true);
      expect(report.stages).toHaveLength(3);
      expect(report.fixSuggestions).toHaveLength(0);
    });

    it("reports partial failure with fix suggestions", () => {
      // Only tsconfig exists — lint will skip, unit will fail
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));

      let callCount = 0;
      mockExec.mockImplementation(() => {
        callCount++;
        if (callCount === 1) return ""; // typecheck passes
        // unit stage fails
        const err = new Error("fail") as Error & {
          status: number;
          stdout: string;
          stderr: string;
        };
        err.status = 1;
        err.stdout = "FAIL  src/foo.test.ts";
        err.stderr = "";
        throw err;
      });

      const engine = new VerificationEngine("/project", {
        stages: ["typecheck", "lint", "unit"],
        execSyncFn: mockExec,
      });
      const report = engine.verify();

      expect(report.overallPassed).toBe(false);
      // typecheck passes, lint skips (auto-pass), unit fails
      expect(report.stages[0]!.passed).toBe(true);
      expect(report.stages[1]!.passed).toBe(true); // lint skipped = pass
      expect(report.stages[2]!.passed).toBe(false);
      expect(report.fixSuggestions.length).toBeGreaterThan(0);
    });

    it("returns empty stages report when no stages configured", () => {
      const engine = new VerificationEngine("/project", {
        stages: [],
        execSyncFn: mockExec,
      });
      const report = engine.verify();

      expect(report.stages).toHaveLength(0);
      expect(report.overallPassed).toBe(true);
      expect(report.pdseScore).toBe(0);
    });

    it("computes PDSE score in the report", () => {
      mockExistsSync.mockImplementation(
        (p: string) => p.includes("tsconfig.json") || p.includes(".eslintrc.js"),
      );
      mockExec.mockReturnValue("");

      const engine = new VerificationEngine("/project", {
        stages: ["typecheck", "lint"],
        execSyncFn: mockExec,
      });
      const report = engine.verify();

      expect(report.pdseScore).toBe(1.0);
      expect(report.timestamp).toBeDefined();
      expect(report.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("stops early when a critical stage fails", () => {
      // typecheck config exists, it will fail
      mockExistsSync.mockImplementation(
        (p: string) =>
          p.includes("tsconfig.json") ||
          p.includes(".eslintrc.js") ||
          p.includes("vitest.config.ts"),
      );

      mockExec.mockImplementation(() => {
        const err = new Error("fail") as Error & {
          status: number;
          stdout: string;
          stderr: string;
        };
        err.status = 1;
        err.stdout = "src/foo.ts:1:1 - error TS2345: Type mismatch";
        err.stderr = "";
        throw err;
      });

      const engine = new VerificationEngine("/project", {
        stages: ["typecheck", "lint", "unit"],
        execSyncFn: mockExec,
      });
      const report = engine.verify();

      // typecheck fails → lint and unit should be skipped
      expect(report.stages[0]!.passed).toBe(false);
      expect(report.stages[1]!.exitCode).toBe(-1); // skipped
      expect(report.stages[2]!.exitCode).toBe(-1); // skipped

      // execSync should only be called once (for typecheck)
      expect(mockExec).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 6. selfCorrectLoop (5 tests)
  // =========================================================================

  describe("selfCorrectLoop", () => {
    it("returns corrected=true on successful retry", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));

      let callCount = 0;
      mockExec.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          const err = new Error("fail") as Error & {
            status: number;
            stdout: string;
            stderr: string;
          };
          err.status = 1;
          err.stdout = "src/a.ts:1:1 - error TS2345: Bad type";
          err.stderr = "";
          throw err;
        }
        // Second call succeeds
        return "";
      });

      const fixFn = vi.fn().mockReturnValue("fixed");
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
        maxFixAttempts: 3,
      });

      const loop = engine.selfCorrectLoop("typecheck", fixFn);
      expect(loop.corrected).toBe(true);
      expect(loop.attempts).toBe(2);
      expect(loop.finalResult.passed).toBe(true);
      expect(fixFn).toHaveBeenCalledTimes(1);
    });

    it("gives up after maxFixAttempts", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));

      let errorNum = 0;
      mockExec.mockImplementation(() => {
        errorNum++;
        const err = new Error("fail") as Error & {
          status: number;
          stdout: string;
          stderr: string;
        };
        err.status = 1;
        // Different error each time to avoid signature repeat
        err.stdout = `src/a.ts:${errorNum}:1 - error TS2345: Error variant ${errorNum}`;
        err.stderr = "";
        throw err;
      });

      const fixFn = vi.fn().mockReturnValue("attempted");
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
        maxFixAttempts: 2,
      });

      const loop = engine.selfCorrectLoop("typecheck", fixFn);
      expect(loop.corrected).toBe(false);
      expect(loop.attempts).toBe(2);
      expect(fixFn).toHaveBeenCalledTimes(1); // called between attempt 1 and 2
    });

    it("detects repeated error signature and stops early", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));

      // Always return the same error
      mockExec.mockImplementation(() => {
        const err = new Error("fail") as Error & {
          status: number;
          stdout: string;
          stderr: string;
        };
        err.status = 1;
        err.stdout = "src/a.ts:10:1 - error TS2345: Same error every time";
        err.stderr = "";
        throw err;
      });

      const fixFn = vi.fn().mockReturnValue("fix");
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
        maxFixAttempts: 5,
      });

      const loop = engine.selfCorrectLoop("typecheck", fixFn);
      expect(loop.corrected).toBe(false);
      // Should stop at attempt 2 because signature repeats
      expect(loop.attempts).toBe(2);
      expect(loop.errorSignatures).toHaveLength(1);
    });

    it("passes fix prompt to fixFn", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));

      let callCount = 0;
      mockExec.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          const err = new Error("fail") as Error & {
            status: number;
            stdout: string;
            stderr: string;
          };
          err.status = 1;
          err.stdout = "src/b.ts:5:3 - error TS2322: Type mismatch";
          err.stderr = "";
          throw err;
        }
        return "";
      });

      const fixFn = vi.fn().mockReturnValue("fixed");
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
        maxFixAttempts: 3,
      });

      engine.selfCorrectLoop("typecheck", fixFn);

      expect(fixFn).toHaveBeenCalledTimes(1);
      const prompt = fixFn.mock.calls[0]![0] as string;
      expect(prompt).toContain("TypeScript");
      expect(prompt).toContain("src/b.ts");
    });

    it("runs only once when no fixFn provided", () => {
      mockExistsSync.mockImplementation((p: string) => p.includes("tsconfig.json"));

      mockExec.mockImplementation(() => {
        const err = new Error("fail") as Error & {
          status: number;
          stdout: string;
          stderr: string;
        };
        err.status = 1;
        err.stdout = "src/a.ts:1:1 - error TS2345: Error";
        err.stderr = "";
        throw err;
      });

      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
        maxFixAttempts: 5,
      });

      const loop = engine.selfCorrectLoop("typecheck");
      expect(loop.corrected).toBe(false);
      expect(loop.attempts).toBe(1);
      expect(mockExec).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 7. generateFixPrompt (3 tests)
  // =========================================================================

  describe("generateFixPrompt", () => {
    it("formats parsed errors with stage context", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const result: VerificationStageResult = {
        stage: "typecheck",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: 100,
        errorCount: 1,
        parsedErrors: [
          {
            file: "src/foo.ts",
            line: 10,
            column: 5,
            message: "Type 'string' is not assignable",
            errorType: "typescript",
            code: "TS2345",
          },
        ],
      };

      const prompt = engine.generateFixPrompt(result);
      expect(prompt).toContain("TypeScript");
      expect(prompt).toContain("src/foo.ts:10");
      expect(prompt).toContain("TS2345");
    });

    it("includes stage-specific context for lint stage", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const result: VerificationStageResult = {
        stage: "lint",
        passed: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationMs: 50,
        errorCount: 1,
        parsedErrors: [
          {
            file: "src/bar.ts",
            line: 3,
            column: 1,
            message: "Unexpected any",
            errorType: "eslint",
            code: "@typescript-eslint/no-explicit-any",
          },
        ],
      };

      const prompt = engine.generateFixPrompt(result);
      expect(prompt).toContain("linting");
      expect(prompt).toContain("ESLint");
    });

    it("falls back to raw output when no parsable errors", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });
      const result: VerificationStageResult = {
        stage: "unit",
        passed: false,
        exitCode: 1,
        stdout: "Something unexpected happened",
        stderr: "",
        durationMs: 200,
        errorCount: 0,
        parsedErrors: [],
      };

      const prompt = engine.generateFixPrompt(result);
      expect(prompt).toContain("unit");
      expect(prompt).toContain("Something unexpected happened");
      expect(prompt).toContain("Raw output");
    });
  });

  // =========================================================================
  // 8. computePDSEScore (3 tests)
  // =========================================================================

  describe("computePDSEScore", () => {
    it("returns 1.0 when all stages pass", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });

      const results: VerificationStageResult[] = [
        makeResult("typecheck", true),
        makeResult("lint", true),
        makeResult("unit", true),
      ];

      expect(engine.computePDSEScore(results)).toBe(1.0);
    });

    it("returns 0.0 when all stages fail", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });

      const results: VerificationStageResult[] = [
        makeResult("typecheck", false),
        makeResult("lint", false),
        makeResult("unit", false),
      ];

      expect(engine.computePDSEScore(results)).toBe(0.0);
    });

    it("weights stages correctly for partial pass", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
      });

      // typecheck passes (0.25), lint fails (0.15), unit passes (0.35)
      const results: VerificationStageResult[] = [
        makeResult("typecheck", true),
        makeResult("lint", false),
        makeResult("unit", true),
      ];

      const score = engine.computePDSEScore(results);
      // expected: (0.25 + 0.35) / (0.25 + 0.15 + 0.35) = 0.60 / 0.75 = 0.8
      expect(score).toBeCloseTo(0.8, 5);
    });
  });

  // =========================================================================
  // 9. passesGate (2 tests)
  // =========================================================================

  describe("passesGate", () => {
    it("passes when pdseScore is at or above threshold", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
        pdseGate: 0.85,
      });

      const report: VerificationReport = {
        stages: [],
        overallPassed: true,
        pdseScore: 0.9,
        fixSuggestions: [],
        totalDurationMs: 100,
        timestamp: new Date().toISOString(),
      };

      expect(engine.passesGate(report)).toBe(true);

      // Exactly at threshold
      report.pdseScore = 0.85;
      expect(engine.passesGate(report)).toBe(true);
    });

    it("fails when pdseScore is below threshold", () => {
      const engine = new VerificationEngine("/project", {
        execSyncFn: mockExec,
        pdseGate: 0.85,
      });

      const report: VerificationReport = {
        stages: [],
        overallPassed: false,
        pdseScore: 0.5,
        fixSuggestions: [],
        totalDurationMs: 100,
        timestamp: new Date().toISOString(),
      };

      expect(engine.passesGate(report)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Helper — create a minimal VerificationStageResult for score tests
// ---------------------------------------------------------------------------

function makeResult(
  stage: import("./verification-engine.js").VerificationStage,
  passed: boolean,
): VerificationStageResult {
  return {
    stage,
    passed,
    exitCode: passed ? 0 : 1,
    stdout: "",
    stderr: "",
    durationMs: 0,
    errorCount: 0,
    parsedErrors: [],
  };
}
