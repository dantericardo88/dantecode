// ============================================================================
// packages/vscode/src/auto-test-runner.ts
// Sprint 36 — Dim 19: Auto-test-after-write (8→9)
//
// When the agent writes a file that matches a test pattern, automatically
// detect the test framework and run the appropriate test command.
// Results are surfaced as a "test_run_result" outbound webview message.
// ============================================================================

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { TestFrameworkDetector } from "./test-framework-detector.js";

const exec = promisify(execCb);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TestRunResult {
  /** The file that triggered the auto-run */
  triggeredBy: string;
  /** Shell command that was executed */
  command: string;
  /** Exit code (0 = pass) */
  exitCode: number;
  /** Combined stdout + stderr output (truncated to 8000 chars) */
  output: string;
  /** true iff exit code is 0 */
  passed: boolean;
  /** Wall-clock duration in ms */
  duration_ms: number;
}

// ─── Test file pattern ────────────────────────────────────────────────────────

const TEST_FILE_PATTERNS = [
  /\.test\.[cm]?[jt]sx?$/,   // .test.ts / .test.js / .test.tsx / .test.mts etc.
  /\.spec\.[cm]?[jt]sx?$/,   // .spec.ts / .spec.js
  /__tests__\//,              // any file under __tests__/
  /\/tests?\//,               // any file under tests/ or test/
  /test_\w+\.py$/,            // Python: test_foo.py
  /\w+_test\.py$/,            // Python: foo_test.py
  /\w+_test\.go$/,            // Go: foo_test.go
];

/**
 * Returns true if the given file path looks like a test file.
 */
export function isTestFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return TEST_FILE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Returns true if the written file is adjacent to / part of a test
 * (i.e., a source file that has a corresponding test file that should be re-run).
 * This is a heuristic — if the file is in `src/` and has a test pattern
 * sibling, we still want to run tests.
 *
 * For Sprint 36 we only auto-run when the written file IS a test file.
 */
export function shouldAutoRunTests(filePath: string): boolean {
  return isTestFile(filePath);
}

// ─── AutoTestRunner ───────────────────────────────────────────────────────────

export class AutoTestRunner {
  private readonly detector: TestFrameworkDetector;

  constructor(detector?: TestFrameworkDetector) {
    this.detector = detector ?? new TestFrameworkDetector();
  }

  /**
   * Run tests for the given file path if it is a test file.
   * Uses TestFrameworkDetector to find the right command, then scopes
   * the run to the specific file where possible.
   *
   * Returns null if `filePath` is not a test file.
   */
  async runIfTestFile(
    filePath: string,
    workspaceRoot: string,
    timeoutMs = 30_000,
  ): Promise<TestRunResult | null> {
    if (!shouldAutoRunTests(filePath)) {
      return null;
    }

    const absPath = resolve(workspaceRoot, filePath);
    const framework = await this.detector.detectFramework(workspaceRoot);

    // Build a file-scoped command
    const command = buildFileTestCommand(framework.runCommand, absPath, framework.name);

    const start = Date.now();
    let output = "";
    let exitCode = 0;

    try {
      const { stdout, stderr } = await exec(command, {
        cwd: workspaceRoot,
        timeout: timeoutMs,
        env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
      });
      output = [stdout, stderr].filter(Boolean).join("\n");
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number };
      output = [execErr.stdout, execErr.stderr].filter(Boolean).join("\n");
      exitCode = execErr.code ?? 1;
    }

    // Truncate to prevent giant webview messages
    if (output.length > 8000) {
      output = output.slice(0, 8000) + "\n...(truncated)";
    }

    return {
      triggeredBy: filePath,
      command,
      exitCode,
      output,
      passed: exitCode === 0,
      duration_ms: Date.now() - start,
    };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Build a file-scoped test command for the given framework.
 * Falls back to running the full suite if file-scoped isn't feasible.
 */
function buildFileTestCommand(baseCommand: string, absFilePath: string, frameworkName: string): string {
  const quoted = JSON.stringify(absFilePath);

  switch (frameworkName) {
    case "vitest":
      return `${baseCommand} ${quoted}`;
    case "jest":
      return `${baseCommand} --testPathPattern=${quoted}`;
    case "pytest":
      return `${baseCommand} ${quoted}`;
    case "mocha":
      return `${baseCommand} ${quoted}`;
    case "go-testing": {
      // Go doesn't run a single file — run the package directory
      const dir = absFilePath.replace(/[/\\][^/\\]+$/, "");
      return `go test ${JSON.stringify(dir)}`;
    }
    default:
      return baseCommand;
  }
}
