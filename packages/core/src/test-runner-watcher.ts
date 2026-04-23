// packages/core/src/test-runner-watcher.ts
// Test runner integration — closes dim 19 (Test runner integration: 8→9) gap.
//
// Harvested from: Continue.dev test output context provider, Cursor test runner panel.
//
// Provides:
//   - Auto-detect test runner (vitest, jest, mocha, pytest, cargo test)
//   - Parse test results from stdout (pass/fail/skip counts, error details)
//   - Stream test output into agent context
//   - Format failure summaries for AI prompt injection

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TestRunner = "vitest" | "jest" | "mocha" | "pytest" | "cargo" | "go-test" | "unknown";

export type TestStatus = "passed" | "failed" | "skipped" | "pending";

export interface TestCase {
  /** Test name / description */
  name: string;
  /** Suite / file the test belongs to */
  suite?: string;
  /** Pass / fail / skip */
  status: TestStatus;
  /** Duration in milliseconds (if available) */
  durationMs?: number;
  /** Error message / stack trace for failures */
  errorMessage?: string;
}

export interface TestRunResult {
  /** Which runner was used */
  runner: TestRunner;
  /** All test cases parsed from output */
  tests: TestCase[];
  /** Total passed */
  passed: number;
  /** Total failed */
  failed: number;
  /** Total skipped */
  skipped: number;
  /** Total test count */
  total: number;
  /** Whether the overall run succeeded */
  success: boolean;
  /** Raw stdout (truncated to maxOutputChars) */
  rawOutput: string;
  /** Duration of the run in ms (if parseable) */
  durationMs?: number;
}

// ─── Runner Detection ─────────────────────────────────────────────────────────

/**
 * Detect which test runner is configured in the project.
 * Reads package.json scripts section and looks for runner-specific config files.
 */
export function detectTestRunner(
  projectRoot: string,
  readFileFn: (path: string) => string | null = defaultReadFile,
): TestRunner {
  // Try package.json scripts
  const pkgJson = readFileFn(`${projectRoot}/package.json`);
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson) as { scripts?: Record<string, string>; devDependencies?: Record<string, string> };
      const testScript = pkg.scripts?.test ?? "";
      const devDeps = Object.keys(pkg.devDependencies ?? {});
      if (/vitest/.test(testScript) || devDeps.includes("vitest")) return "vitest";
      if (/jest/.test(testScript) || devDeps.includes("jest")) return "jest";
      if (/mocha/.test(testScript) || devDeps.includes("mocha")) return "mocha";
    } catch { /* ignore */ }
  }

  // Config file presence
  if (readFileFn(`${projectRoot}/vitest.config.ts`) || readFileFn(`${projectRoot}/vitest.config.js`)) return "vitest";
  if (readFileFn(`${projectRoot}/jest.config.ts`) || readFileFn(`${projectRoot}/jest.config.js`)) return "jest";
  if (readFileFn(`${projectRoot}/.mocharc.yml`) || readFileFn(`${projectRoot}/.mocharc.js`)) return "mocha";
  if (readFileFn(`${projectRoot}/pytest.ini`) || readFileFn(`${projectRoot}/pyproject.toml`)) return "pytest";
  if (readFileFn(`${projectRoot}/Cargo.toml`)) return "cargo";
  if (readFileFn(`${projectRoot}/go.mod`)) return "go-test";

  return "unknown";
}

function defaultReadFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

// ─── Output Parsers ───────────────────────────────────────────────────────────

/**
 * Parse vitest / jest output (both use similar TAP-like stdout format).
 * Handles: ✓ / ✗ / ● patterns, "Tests: X passed, Y failed" summary line.
 */
export function parseVitestOutput(raw: string): Omit<TestRunResult, "runner" | "rawOutput"> {
  const tests: TestCase[] = [];

  // Individual test lines: " ✓ test name (Xms)" or " ✗ test name" or "× test name"
  const passRe = /[✓√]\s+(.+?)(?:\s+\((\d+)ms\))?$/gm;
  const failRe = /[✗×✕]\s+(.+?)(?:\s+\((\d+)ms\))?$/gm;
  const skipRe = /[-↓⊙]\s+(.+)$/gm;

  let m: RegExpExecArray | null;
  while ((m = passRe.exec(raw)) !== null) {
    tests.push({ name: m[1]!.trim(), status: "passed", durationMs: m[2] ? parseInt(m[2], 10) : undefined });
  }
  while ((m = failRe.exec(raw)) !== null) {
    tests.push({ name: m[1]!.trim(), status: "failed", durationMs: m[2] ? parseInt(m[2], 10) : undefined });
  }
  while ((m = skipRe.exec(raw)) !== null) {
    tests.push({ name: m[1]!.trim(), status: "skipped" });
  }

  // Extract error messages for failures (lines after "● test name" or "FAIL")
  const errorBlocks = raw.matchAll(/●\s+(.+?)\n([\s\S]+?)(?=\n●|\n✓|\nTests:|\n$)/g);
  for (const block of errorBlocks) {
    const testName = block[1]!.trim();
    const errorMsg = block[2]!.trim().slice(0, 500);
    const existing = tests.find((t) => t.name === testName && t.status === "failed");
    if (existing) existing.errorMessage = errorMsg;
  }

  // Summary line: "Tests  3 passed | 1 failed | 2 skipped" or "Tests: 3 passed, 1 failed"
  const summaryRe = /Tests?[:\s]+(?:(\d+)\s+passed)?[,|\s]*(?:(\d+)\s+failed)?[,|\s]*(?:(\d+)\s+skipped)?/i;
  const summaryMatch = raw.match(summaryRe);

  const passed = summaryMatch?.[1] ? parseInt(summaryMatch[1], 10) : tests.filter((t) => t.status === "passed").length;
  const failed = summaryMatch?.[2] ? parseInt(summaryMatch[2], 10) : tests.filter((t) => t.status === "failed").length;
  const skipped = summaryMatch?.[3] ? parseInt(summaryMatch[3], 10) : tests.filter((t) => t.status === "skipped").length;

  // Duration
  const durMatch = raw.match(/Duration\s+([\d.]+)s/);
  const durationMs = durMatch ? Math.round(parseFloat(durMatch[1]!) * 1000) : undefined;

  return { tests, passed, failed, skipped, total: passed + failed + skipped, success: failed === 0, durationMs };
}

/**
 * Parse pytest output.
 * Handles: "PASSED", "FAILED", "SKIPPED" per-test lines, and summary "passed/failed".
 */
export function parsePytestOutput(raw: string): Omit<TestRunResult, "runner" | "rawOutput"> {
  const tests: TestCase[] = [];

  const lineRe = /^(.+?)\s+(PASSED|FAILED|SKIPPED|ERROR)\s*/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(raw)) !== null) {
    const name = m[1]!.trim();
    const statusStr = m[2]!;
    const status: TestStatus =
      statusStr === "PASSED" ? "passed" :
      statusStr === "SKIPPED" ? "skipped" :
      "failed";
    tests.push({ name, status });
  }

  // Summary: "3 passed, 1 failed, 2 skipped in 0.5s"
  const summaryRe = /(\d+)\s+passed(?:,\s+(\d+)\s+failed)?(?:,\s+(\d+)\s+skipped)?(?:\s+in\s+([\d.]+)s)?/;
  const s = raw.match(summaryRe);
  const passed = s?.[1] ? parseInt(s[1], 10) : tests.filter((t) => t.status === "passed").length;
  const failed = s?.[2] ? parseInt(s[2], 10) : tests.filter((t) => t.status === "failed").length;
  const skipped = s?.[3] ? parseInt(s[3], 10) : tests.filter((t) => t.status === "skipped").length;
  const durationMs = s?.[4] ? Math.round(parseFloat(s[4]) * 1000) : undefined;

  return { tests, passed, failed, skipped, total: passed + failed + skipped, success: failed === 0, durationMs };
}

/**
 * Parse `cargo test` output.
 * Handles: "test name ... ok", "test name ... FAILED", summary "test result: X passed; Y failed"
 */
export function parseCargoTestOutput(raw: string): Omit<TestRunResult, "runner" | "rawOutput"> {
  const tests: TestCase[] = [];

  const lineRe = /^test\s+(.+?)\s+\.\.\.\s+(ok|FAILED|ignored)/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(raw)) !== null) {
    const name = m[1]!.trim();
    const statusStr = m[2]!;
    const status: TestStatus = statusStr === "ok" ? "passed" : statusStr === "ignored" ? "skipped" : "failed";
    tests.push({ name, status });
  }

  const summaryRe = /test result:[^.]+\. (\d+) passed; (\d+) failed; (\d+) ignored/;
  const s = raw.match(summaryRe);
  const passed = s?.[1] ? parseInt(s[1], 10) : tests.filter((t) => t.status === "passed").length;
  const failed = s?.[2] ? parseInt(s[2], 10) : tests.filter((t) => t.status === "failed").length;
  const skipped = s?.[3] ? parseInt(s[3], 10) : tests.filter((t) => t.status === "skipped").length;

  return { tests, passed, failed, skipped, total: passed + failed + skipped, success: failed === 0 };
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

function parseOutput(runner: TestRunner, raw: string): Omit<TestRunResult, "runner" | "rawOutput"> {
  switch (runner) {
    case "vitest":
    case "jest":
    case "mocha":
      return parseVitestOutput(raw);
    case "pytest":
      return parsePytestOutput(raw);
    case "cargo":
      return parseCargoTestOutput(raw);
    default:
      return { tests: [], passed: 0, failed: 0, skipped: 0, total: 0, success: true };
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export interface RunTestsOptions {
  /** Project root directory */
  projectRoot: string;
  /** Override auto-detected runner */
  runner?: TestRunner;
  /** Extra args to pass to the test command */
  extraArgs?: string[];
  /** Max characters of raw output to store (default: 20000) */
  maxOutputChars?: number;
  /** Timeout in ms (default: 120000) */
  timeoutMs?: number;
  /** Injected spawnSync for testing */
  spawnSyncFn?: typeof spawnSync;
  /** Injected readFile for runner detection */
  readFileFn?: (path: string) => string | null;
}

const RUNNER_COMMANDS: Record<TestRunner, { cmd: string; args: string[] }> = {
  vitest: { cmd: "npx", args: ["vitest", "run", "--reporter=verbose"] },
  jest: { cmd: "npx", args: ["jest", "--verbose"] },
  mocha: { cmd: "npx", args: ["mocha", "--reporter", "spec"] },
  pytest: { cmd: "python", args: ["-m", "pytest", "-v"] },
  cargo: { cmd: "cargo", args: ["test", "--", "--nocapture"] },
  "go-test": { cmd: "go", args: ["test", "./...", "-v"] },
  unknown: { cmd: "npm", args: ["test"] },
};

/**
 * Run the test suite and parse results.
 * Uses spawnSync to capture output synchronously (safe for short test runs).
 * For long-running suites, use the streaming variant below.
 */
export function runTests(options: RunTestsOptions): TestRunResult {
  const {
    projectRoot,
    extraArgs = [],
    maxOutputChars = 20_000,
    timeoutMs = 120_000,
    spawnSyncFn = spawnSync,
    readFileFn,
  } = options;

  const runner = options.runner ?? detectTestRunner(projectRoot, readFileFn);
  const { cmd, args } = RUNNER_COMMANDS[runner];

  const result = spawnSyncFn(cmd, [...args, ...extraArgs], {
    cwd: projectRoot,
    encoding: "utf-8",
    timeout: timeoutMs,
    env: { ...process.env, CI: "true", FORCE_COLOR: "0" },
  });

  const stdout = (result.stdout as string) ?? "";
  const stderr = (result.stderr as string) ?? "";
  const combined = (stdout + "\n" + stderr).slice(0, maxOutputChars);

  const parsed = parseOutput(runner, combined);

  return {
    runner,
    rawOutput: combined,
    ...parsed,
  };
}

// ─── Formatter ────────────────────────────────────────────────────────────────

export interface TestResultFormatOptions {
  /** Show individual test names (default: false — only failures) */
  showAllTests?: boolean;
  /** Max failures to show details for (default: 10) */
  maxFailureDetails?: number;
  /** Max raw output lines to include (default: 0 = omit) */
  rawOutputLines?: number;
}

/**
 * Format test results for AI prompt injection.
 */
export function formatTestResultForPrompt(result: TestRunResult, opts: TestResultFormatOptions = {}): string {
  const { showAllTests = false, maxFailureDetails = 10, rawOutputLines = 0 } = opts;

  const lines: string[] = ["## Test Results"];

  const icon = result.success ? "✅" : "❌";
  lines.push(`${icon} ${result.runner}: ${result.passed}/${result.total} passed | ${result.failed} failed | ${result.skipped} skipped`);
  if (result.durationMs !== undefined) {
    lines.push(`Duration: ${(result.durationMs / 1000).toFixed(2)}s`);
  }
  lines.push("");

  if (result.failed > 0) {
    lines.push("**Failures:**");
    const failures = result.tests.filter((t) => t.status === "failed").slice(0, maxFailureDetails);
    for (const f of failures) {
      lines.push(`  ✗ ${f.suite ? f.suite + " > " : ""}${f.name}`);
      if (f.errorMessage) {
        const errLines = f.errorMessage.split("\n").slice(0, 5).join("\n    ");
        lines.push(`    ${errLines}`);
      }
    }
    if (result.failed > maxFailureDetails) {
      lines.push(`  … and ${result.failed - maxFailureDetails} more failures`);
    }
    lines.push("");
  }

  if (showAllTests && result.tests.length > 0) {
    lines.push("**All tests:**");
    for (const t of result.tests) {
      const icon2 = t.status === "passed" ? "✓" : t.status === "skipped" ? "○" : "✗";
      lines.push(`  ${icon2} ${t.name}`);
    }
    lines.push("");
  }

  if (rawOutputLines > 0 && result.rawOutput) {
    const rawLines = result.rawOutput.split("\n").slice(0, rawOutputLines).join("\n");
    lines.push("**Raw output (truncated):**");
    lines.push("```");
    lines.push(rawLines);
    lines.push("```");
  }

  return lines.join("\n");
}

/**
 * Get a compact one-line status for embedding in status bars or compact context.
 */
export function getTestStatusLine(result: TestRunResult): string {
  const icon = result.success ? "✅" : "❌";
  return `${icon} tests: ${result.passed}/${result.total} (${result.failed} failed)`;
}

/**
 * Get only the failed test names, for quick re-run targeting.
 */
export function getFailedTestNames(result: TestRunResult): string[] {
  return result.tests.filter((t) => t.status === "failed").map((t) => t.name);
}
