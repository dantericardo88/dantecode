// ============================================================================
// Verification Engine — multi-stage QA pipeline with self-correction
// Harvested from Aider test-driven loops + OpenHands critic model + Qwen QA.
// Runs typecheck → lint → unit tests with auto-discovery, PDSE scoring,
// and structured error feedback for targeted fixes.
// ============================================================================

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
} from "./error-parser.js";
import type { ParsedError } from "./error-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported verification stages, ordered by typical execution sequence. */
export type VerificationStage =
  | "typecheck"
  | "lint"
  | "unit"
  | "integration"
  | "smoke";

/** Result of running a single verification stage. */
export interface VerificationStageResult {
  stage: VerificationStage;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  errorCount: number;
  parsedErrors: ParsedError[];
}

/** Full verification report across all stages. */
export interface VerificationReport {
  stages: VerificationStageResult[];
  overallPassed: boolean;
  pdseScore: number;
  fixSuggestions: string[];
  totalDurationMs: number;
  timestamp: string;
}

/** Auto-detected test runner information. */
export interface TestRunnerInfo {
  /** Detected runner name. */
  runner: string; // "vitest" | "jest" | "pytest" | "go" | "cargo" | "unknown"
  /** The command to run tests. */
  command: string;
  /** Path to config file if found. */
  configFile?: string;
}

/** Configuration options for the verification engine. */
export interface VerificationEngineOptions {
  /** Stages to run, in order. Default: ["typecheck", "lint", "unit"] */
  stages: VerificationStage[];
  /** Maximum fix attempts in the self-correction loop. Default: 3 */
  maxFixAttempts: number;
  /** PDSE gate threshold (0–1). Default: 0.85 */
  pdseGate: number;
  /** Auto-discover test runner if true. Default: true */
  autoDiscoverTests: boolean;
  /** Per-stage timeout in ms. Default: 60000 */
  timeout: number;
  /** Injectable execSync for testing. */
  execSyncFn?: typeof execSync;
}

// ---------------------------------------------------------------------------
// Stage weight map — used for PDSE scoring
// ---------------------------------------------------------------------------

/** Importance weights per stage. Sum = 1.0. */
const STAGE_WEIGHTS: Record<VerificationStage, number> = {
  typecheck: 0.25,
  lint: 0.15,
  unit: 0.35,
  integration: 0.15,
  smoke: 0.1,
};

/** Stages that block subsequent stages when they fail. */
const CRITICAL_STAGES: Set<VerificationStage> = new Set([
  "typecheck",
  "lint",
]);

// ---------------------------------------------------------------------------
// Default options
// ---------------------------------------------------------------------------

const DEFAULT_OPTIONS: Required<VerificationEngineOptions> = {
  stages: ["typecheck", "lint", "unit"],
  maxFixAttempts: 3,
  pdseGate: 0.85,
  autoDiscoverTests: true,
  timeout: 60000,
  execSyncFn: execSync,
};

// ---------------------------------------------------------------------------
// VerificationEngine
// ---------------------------------------------------------------------------

/**
 * Multi-stage verification pipeline with self-correction capabilities.
 *
 * Runs a configurable sequence of stages (typecheck, lint, unit, integration,
 * smoke) and computes a PDSE (Pass-rate Driven Stage Effectiveness) score.
 * Includes a self-correction loop that feeds structured error output back to
 * a fix function for iterative repair.
 */
export class VerificationEngine {
  private readonly projectRoot: string;
  private readonly options: Required<VerificationEngineOptions>;
  private readonly exec: typeof execSync;

  constructor(
    projectRoot: string,
    options?: Partial<VerificationEngineOptions>,
  ) {
    this.projectRoot = projectRoot;
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      // If execSyncFn was provided via options, use it; otherwise default
      execSyncFn: options?.execSyncFn ?? DEFAULT_OPTIONS.execSyncFn,
    };
    this.exec = this.options.execSyncFn;
  }

  // -------------------------------------------------------------------------
  // Test runner auto-detection
  // -------------------------------------------------------------------------

  /**
   * Auto-detect the test framework used by this project.
   *
   * Checks for config files in order of preference:
   *   vitest.config.ts/js → jest.config.ts/js → pytest.ini / pyproject.toml
   *   → go.mod → Cargo.toml → unknown
   */
  detectTestRunner(): TestRunnerInfo {
    const check = (file: string): boolean =>
      existsSync(join(this.projectRoot, file));

    // Vitest
    if (check("vitest.config.ts")) {
      return {
        runner: "vitest",
        command: "npx vitest run",
        configFile: "vitest.config.ts",
      };
    }
    if (check("vitest.config.js")) {
      return {
        runner: "vitest",
        command: "npx vitest run",
        configFile: "vitest.config.js",
      };
    }

    // Jest
    if (check("jest.config.ts")) {
      return {
        runner: "jest",
        command: "npx jest",
        configFile: "jest.config.ts",
      };
    }
    if (check("jest.config.js")) {
      return {
        runner: "jest",
        command: "npx jest",
        configFile: "jest.config.js",
      };
    }

    // Pytest
    if (check("pytest.ini")) {
      return {
        runner: "pytest",
        command: "pytest",
        configFile: "pytest.ini",
      };
    }
    if (check("setup.cfg")) {
      return {
        runner: "pytest",
        command: "pytest",
        configFile: "setup.cfg",
      };
    }
    if (check("pyproject.toml")) {
      return {
        runner: "pytest",
        command: "pytest",
        configFile: "pyproject.toml",
      };
    }

    // Go
    if (check("go.mod")) {
      return {
        runner: "go",
        command: "go test ./...",
        configFile: "go.mod",
      };
    }

    // Cargo (Rust)
    if (check("Cargo.toml")) {
      return {
        runner: "cargo",
        command: "cargo test",
        configFile: "Cargo.toml",
      };
    }

    return {
      runner: "unknown",
      command: "echo 'No test runner detected'",
    };
  }

  // -------------------------------------------------------------------------
  // Stage commands
  // -------------------------------------------------------------------------

  /**
   * Build the shell command for a given verification stage.
   *
   * Returns "skip" if the stage's prerequisite config is missing
   * (e.g., typecheck without tsconfig.json).
   */
  getStageCommand(stage: VerificationStage): string {
    const check = (file: string): boolean =>
      existsSync(join(this.projectRoot, file));

    switch (stage) {
      case "typecheck": {
        if (!check("tsconfig.json")) return "skip";
        return "npx tsc --noEmit";
      }
      case "lint": {
        const hasEslint =
          check(".eslintrc") ||
          check(".eslintrc.js") ||
          check(".eslintrc.json") ||
          check(".eslintrc.yml") ||
          check(".eslintrc.yaml") ||
          check("eslint.config.js") ||
          check("eslint.config.mjs") ||
          check("eslint.config.ts");
        if (!hasEslint) return "skip";
        return "npx eslint . --max-warnings=0";
      }
      case "unit": {
        const runner = this.detectTestRunner();
        return runner.command;
      }
      case "integration": {
        const runner = this.detectTestRunner();
        if (runner.runner === "vitest") {
          return "npx vitest run --reporter=verbose";
        }
        if (runner.runner === "jest") {
          return "npx jest --verbose";
        }
        return `${runner.command} --verbose`;
      }
      case "smoke": {
        const runner = this.detectTestRunner();
        if (runner.runner === "vitest") {
          return "npx vitest run --bail 1";
        }
        if (runner.runner === "jest") {
          return "npx jest --bail";
        }
        return `${runner.command} --bail`;
      }
      default:
        return "skip";
    }
  }

  // -------------------------------------------------------------------------
  // Single-stage execution
  // -------------------------------------------------------------------------

  /**
   * Execute a single verification stage and return a structured result.
   *
   * If the command is "skip" (missing config), returns a passing result
   * with zero duration.
   */
  runStage(stage: VerificationStage): VerificationStageResult {
    const command = this.getStageCommand(stage);

    // If this stage has no applicable tool, auto-pass
    if (command === "skip") {
      return {
        stage,
        passed: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 0,
        errorCount: 0,
        parsedErrors: [],
      };
    }

    const start = Date.now();
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      stdout = this.exec(command, {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: this.options.timeout,
        stdio: ["pipe", "pipe", "pipe"],
      }) as string;
    } catch (err: unknown) {
      // execSync throws on non-zero exit codes
      const execError = err as {
        status?: number;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        message?: string;
      };
      exitCode = execError.status ?? 1;
      stdout =
        typeof execError.stdout === "string"
          ? execError.stdout
          : (execError.stdout?.toString("utf-8") ?? "");
      stderr =
        typeof execError.stderr === "string"
          ? execError.stderr
          : (execError.stderr?.toString("utf-8") ?? "");

      // If stderr is empty, check for timeout message
      if (!stderr && execError.message) {
        stderr = execError.message;
      }
    }

    const durationMs = Date.now() - start;
    const combinedOutput = `${stdout}\n${stderr}`;
    const parsedErrors = parseVerificationErrors(combinedOutput);

    return {
      stage,
      passed: exitCode === 0,
      exitCode,
      stdout,
      stderr,
      durationMs,
      errorCount: parsedErrors.length,
      parsedErrors,
    };
  }

  // -------------------------------------------------------------------------
  // Full pipeline
  // -------------------------------------------------------------------------

  /**
   * Run the full multi-stage verification pipeline.
   *
   * Stages execute in the configured order. If a critical stage (typecheck,
   * lint) fails, subsequent stages are skipped unless all stages were
   * explicitly requested.
   *
   * @param _changedFiles - Reserved for future scoped testing. Currently unused.
   */
  verify(_changedFiles?: string[]): VerificationReport {
    const stageResults: VerificationStageResult[] = [];
    let earlyStop = false;

    for (const stage of this.options.stages) {
      if (earlyStop) {
        // Record skipped stages
        stageResults.push({
          stage,
          passed: false,
          exitCode: -1,
          stdout: "",
          stderr: "Skipped — previous critical stage failed",
          durationMs: 0,
          errorCount: 0,
          parsedErrors: [],
        });
        continue;
      }

      const result = this.runStage(stage);
      stageResults.push(result);

      // Early termination on critical stage failure
      if (!result.passed && CRITICAL_STAGES.has(stage)) {
        earlyStop = true;
      }
    }

    const pdseScore = this.computePDSEScore(stageResults);
    const overallPassed = stageResults.every((r) => r.passed);
    const totalDurationMs = stageResults.reduce(
      (sum, r) => sum + r.durationMs,
      0,
    );

    // Generate fix suggestions from failed stages
    const fixSuggestions: string[] = [];
    for (const result of stageResults) {
      if (!result.passed && result.parsedErrors.length > 0) {
        const prompt = formatErrorsForFixPrompt(result.parsedErrors);
        if (prompt) {
          fixSuggestions.push(`[${result.stage}] ${prompt}`);
        }
      }
    }

    return {
      stages: stageResults,
      overallPassed,
      pdseScore,
      fixSuggestions,
      totalDurationMs,
      timestamp: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Self-correction loop
  // -------------------------------------------------------------------------

  /**
   * Run a stage repeatedly, applying fixes between attempts.
   *
   * The loop:
   *  1. Run the stage
   *  2. If passed → return success
   *  3. Generate a fix prompt from errors
   *  4. Call fixFn (if provided) with the prompt
   *  5. Track error signatures to detect repeated (stuck) failures
   *  6. Repeat up to maxFixAttempts
   *
   * If no fixFn is provided, the loop only runs once (no correction possible).
   */
  selfCorrectLoop(
    stage: VerificationStage,
    fixFn?: (prompt: string) => string,
  ): {
    corrected: boolean;
    attempts: number;
    finalResult: VerificationStageResult;
    errorSignatures: string[];
  } {
    const errorSignatures: string[] = [];
    let attempts = 0;
    let result: VerificationStageResult;

    const maxAttempts = fixFn ? this.options.maxFixAttempts : 1;

    for (let i = 0; i < maxAttempts; i++) {
      attempts++;
      result = this.runStage(stage);

      if (result.passed) {
        return {
          corrected: attempts > 1,
          attempts,
          finalResult: result,
          errorSignatures,
        };
      }

      // Compute error signature for stuck-loop detection
      const sig = computeErrorSignature(result.parsedErrors);
      if (errorSignatures.includes(sig)) {
        // Same error set seen before — further fixes won't help
        return {
          corrected: false,
          attempts,
          finalResult: result,
          errorSignatures,
        };
      }
      errorSignatures.push(sig);

      // Apply fix (if we have a fixFn and more attempts remain)
      if (fixFn && i < maxAttempts - 1) {
        const prompt = this.generateFixPrompt(result);
        fixFn(prompt);
      }
    }

    // Exhausted all attempts without passing
    return {
      corrected: false,
      attempts,
      finalResult: result!,
      errorSignatures,
    };
  }

  // -------------------------------------------------------------------------
  // Fix prompt generation
  // -------------------------------------------------------------------------

  /**
   * Build a stage-specific fix prompt from a failed verification result.
   *
   * Combines generic error formatting from the error-parser with
   * stage-appropriate context to guide the LLM toward targeted repairs.
   */
  generateFixPrompt(result: VerificationStageResult): string {
    const errorBlock = formatErrorsForFixPrompt(result.parsedErrors);

    if (!errorBlock) {
      // No parsable errors — fall back to raw output
      const output = result.stderr || result.stdout;
      return [
        `Stage "${result.stage}" failed (exit code ${result.exitCode}).`,
        "",
        "Raw output:",
        output.slice(0, 2000),
        "",
        "Analyze the output above and fix the underlying issues.",
      ].join("\n");
    }

    const stageContext: Record<VerificationStage, string> = {
      typecheck:
        "Fix these TypeScript type errors. Do not add `any` casts — resolve the types correctly.",
      lint: "Fix these linting violations. Follow the project's ESLint rules strictly.",
      unit: "Fix these failing unit tests. Ensure the implementation matches the test expectations.",
      integration:
        "Fix these integration test failures. Check API contracts and data flow.",
      smoke:
        "Fix these smoke test failures. Verify the basic happy-path works end-to-end.",
    };

    return [
      stageContext[result.stage],
      "",
      errorBlock,
    ].join("\n");
  }

  // -------------------------------------------------------------------------
  // PDSE scoring
  // -------------------------------------------------------------------------

  /**
   * Compute the PDSE (Pass-rate Driven Stage Effectiveness) score.
   *
   * Each stage contributes its weight to the total score if it passed.
   * Only stages actually run contribute; the weights are re-normalized
   * so the score is always on a 0–1 scale.
   */
  computePDSEScore(results: VerificationStageResult[]): number {
    if (results.length === 0) return 0;

    let totalWeight = 0;
    let passedWeight = 0;

    for (const r of results) {
      const w = STAGE_WEIGHTS[r.stage] ?? 0;
      totalWeight += w;
      if (r.passed) {
        passedWeight += w;
      }
    }

    if (totalWeight === 0) return 0;
    return passedWeight / totalWeight;
  }

  // -------------------------------------------------------------------------
  // Gate check
  // -------------------------------------------------------------------------

  /**
   * Check whether a verification report meets the PDSE gate threshold.
   */
  passesGate(report: VerificationReport): boolean {
    return report.pdseScore >= this.options.pdseGate;
  }
}
