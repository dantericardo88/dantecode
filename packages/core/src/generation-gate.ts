// ============================================================================
// @dantecode/core — AppGenerationGate + runGenerationWithGate + repairAndRetry
// Sprint AT/AW/BB — Dim 10: post-file gate for app generation with repair loop.
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GenerationFileSpec {
  filePath: string;
  content: string;
}

export interface AppGenerationFileResult {
  filePath: string;
  passed: boolean;
  errorCount: number;
  /** post - pre error count (positive = regression) */
  errorDelta: number;
}

export interface AppGenerationReport {
  sessionId: string;
  totalFiles: number;
  passedFiles: number;
  failedFiles: number;
  results: AppGenerationFileResult[];
  totalErrorDelta: number;
  typeRegressionFiles: string[];
}

export interface GenerationWithGateResult {
  passed: boolean;
  haltedAt?: string;
  filesWritten: string[];
  totalErrorDelta: number;
  typeRegressionFiles: string[];
}

export interface RepairResult {
  finallyPassed: boolean;
  attemptsMade: number;
}

export interface StackTemplate {
  stack: string;
  scaffoldHint: string;
  entryPoints: string[];
  typecheckCmd: string;
  testCmd: string;
}

/**
 * Async executor for shell commands — injectable for tests.
 * Receives (cmd, args, options) and returns { stdout, stderr, exitCode }.
 */
export type ExecFn = (
  cmd: string,
  args: string[],
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

// ─── Default exec implementation ─────────────────────────────────────────────

function defaultExecFn(
  cmd: string,
  args: string[],
  options: { cwd: string; timeout: number },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return execFileAsync(cmd, args, { cwd: options.cwd, timeout: options.timeout })
    .then(({ stdout, stderr }) => ({ stdout, stderr, exitCode: 0 }))
    .catch((err: { stdout?: string; stderr?: string; code?: number }) => ({
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      exitCode: err.code ?? 1,
    }));
}

// ─── AppGenerationGate ───────────────────────────────────────────────────────

/**
 * Gates each generated file through a typecheck step.
 * Records pass/fail results and exposes a summary report.
 */
export class AppGenerationGate {
  private readonly _sessionId: string;
  private readonly _projectRoot: string;
  private readonly _results: AppGenerationFileResult[] = [];

  constructor(sessionId: string, projectRoot: string) {
    this._sessionId = sessionId;
    this._projectRoot = projectRoot;
  }

  /**
   * Run tsc --noEmit in packageDir and count error lines.
   * Accepts an optional execFn for test injection.
   */
  async getBaselineErrorCount(
    packageDir: string,
    execFn: ExecFn = defaultExecFn,
  ): Promise<number> {
    try {
      const { stdout } = await execFn("npx", ["tsc", "--noEmit"], {
        cwd: packageDir,
        timeout: 15_000,
      });
      return (stdout.match(/error TS\d+|error:/gi) ?? []).length;
    } catch {
      return 0;
    }
  }

  /**
   * Check a single generated file using the template's typecheckCmd.
   * When typecheckCmd is empty the file always passes (unknown stack).
   */
  async checkFile(
    filePath: string,
    template: StackTemplate,
    execFn: ExecFn = defaultExecFn,
  ): Promise<AppGenerationFileResult> {
    let errorDelta = 0;
    let passed = true;

    if (template.typecheckCmd && template.typecheckCmd.trim()) {
      try {
        const parts = template.typecheckCmd.split(/\s+/);
        const cmd = parts[0]!;
        const args = parts.slice(1);
        const { stdout } = await execFn(cmd, args, {
          cwd: this._projectRoot,
          timeout: 15_000,
        });
        const errors = (stdout.match(/error TS\d+|error:/gi) ?? []).length;
        errorDelta = errors;
        passed = errorDelta <= 0;
      } catch {
        passed = false;
      }
    }

    const result: AppGenerationFileResult = {
      filePath,
      passed,
      errorCount: errorDelta,
      errorDelta,
    };
    this._results.push(result);
    return result;
  }

  /** Return aggregated report across all checkFile calls in this session. */
  getReport(): AppGenerationReport {
    const passedFiles = this._results.filter((r) => r.passed).length;
    const typeRegressionFiles = this._results
      .filter((r) => r.errorDelta > 0)
      .map((r) => r.filePath);
    return {
      sessionId: this._sessionId,
      totalFiles: this._results.length,
      passedFiles,
      failedFiles: this._results.length - passedFiles,
      results: [...this._results],
      totalErrorDelta: this._results.reduce((sum, r) => sum + r.errorDelta, 0),
      typeRegressionFiles,
    };
  }
}

// ─── runGenerationWithGate ────────────────────────────────────────────────────

/**
 * Write each file in order, calling the gate after each write.
 * Halts immediately if the gate returns false for any file.
 */
export async function runGenerationWithGate(
  files: GenerationFileSpec[],
  writeFn: (spec: GenerationFileSpec) => Promise<void>,
  gate: (filePath: string) => Promise<boolean>,
): Promise<GenerationWithGateResult> {
  const filesWritten: string[] = [];
  const typeRegressionFiles: string[] = [];

  for (const spec of files) {
    await writeFn(spec);
    filesWritten.push(spec.filePath);
    const passed = await gate(spec.filePath);
    if (!passed) {
      typeRegressionFiles.push(spec.filePath);
      return {
        passed: false,
        haltedAt: spec.filePath,
        filesWritten,
        totalErrorDelta: 0,
        typeRegressionFiles,
      };
    }
  }

  return { passed: true, filesWritten, totalErrorDelta: 0, typeRegressionFiles };
}

// ─── IncrementalVerifyGate ───────────────────────────────────────────────────

/**
 * Async executor for incremental verify — injectable for tests.
 * Signature matches ExecFn but is a distinct named alias used by incrementalVerifyGate.
 */
export type IncrementalExecFn = (
  cmd: string,
  args: string[],
  options: { cwd: string; timeout: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

export interface IncrementalVerifyResult {
  filePath: string;
  passed: boolean;
  output: string;
  errorCount: number;
}

/**
 * Run the template's typecheckCmd (e.g. `npx tsc --noEmit`) in the directory
 * of the written file to detect type regressions after each file write.
 * When typecheckCmd is empty the result is always passed=true.
 */
export async function incrementalVerifyGate(
  filePath: string,
  template: StackTemplate,
  execFn?: IncrementalExecFn,
): Promise<IncrementalVerifyResult> {
  if (!template.typecheckCmd || !template.typecheckCmd.trim()) {
    return { filePath, passed: true, output: "", errorCount: 0 };
  }

  const fn = execFn ?? defaultExecFn;
  const [cmd, ...args] = template.typecheckCmd.split(" ");
  const projectDir = filePath.split("/").slice(0, -1).join("/") || ".";

  try {
    const { stdout, stderr, exitCode } = await fn(cmd!, args, {
      cwd: projectDir,
      timeout: 15_000,
    });
    const output = stdout + stderr;
    const errorCount = (output.match(/error TS\d+|error:/gi) ?? []).length;
    return { filePath, passed: exitCode === 0, output, errorCount };
  } catch {
    return { filePath, passed: false, output: "typecheck failed", errorCount: 1 };
  }
}

// ─── detectProjectStack ───────────────────────────────────────────────────────

/**
 * Detect the stack template from directory contents.
 * Reads package.json / pyproject.toml / go.mod in order.
 * Falls back to { stack: "unknown", ... } when none are found.
 */
export async function detectProjectStack(projectDir: string): Promise<StackTemplate> {
  try {
    const { readFile } = await import("node:fs/promises");
    try {
      const pkg = await readFile(`${projectDir}/package.json`, "utf-8");
      const json = JSON.parse(pkg) as { dependencies?: Record<string, string> };
      const deps = json.dependencies ?? {};
      if ("react" in deps) {
        return {
          stack: "react-ts-app",
          scaffoldHint: "React TypeScript app",
          entryPoints: ["src/index.tsx"],
          typecheckCmd: "npx tsc --noEmit",
          testCmd: "npm test",
        };
      }
      return {
        stack: "typescript-node",
        scaffoldHint: "TypeScript Node.js project",
        entryPoints: ["src/index.ts"],
        typecheckCmd: "npx tsc --noEmit",
        testCmd: "npm test",
      };
    } catch { /* no package.json */ }
    try {
      await readFile(`${projectDir}/pyproject.toml`, "utf-8");
      return {
        stack: "python-cli",
        scaffoldHint: "Python CLI project",
        entryPoints: ["main.py"],
        typecheckCmd: "",
        testCmd: "pytest",
      };
    } catch { /* no pyproject.toml */ }
    try {
      await readFile(`${projectDir}/go.mod`, "utf-8");
      return {
        stack: "go-service",
        scaffoldHint: "Go service",
        entryPoints: ["main.go"],
        typecheckCmd: "go build ./...",
        testCmd: "go test ./...",
      };
    } catch { /* no go.mod */ }
  } catch { /* ignore */ }
  return { stack: "unknown", scaffoldHint: "", entryPoints: [], typecheckCmd: "", testCmd: "" };
}

// ─── repairAndRetry ───────────────────────────────────────────────────────────

/**
 * Attempt to write + gate each file up to maxAttempts times.
 * On retries (attempt > 1) a [Repair hint] comment containing errorContext
 * is prepended to each file's content.
 */
export async function repairAndRetry(
  files: GenerationFileSpec[],
  errorContext: string,
  writeFn: (spec: GenerationFileSpec) => Promise<void>,
  gate: (filePath: string) => Promise<boolean>,
  maxAttempts = 3,
): Promise<RepairResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let allPassed = true;
    for (const spec of files) {
      const content =
        attempt > 1
          ? `// [Repair hint] ${errorContext}\n${spec.content}`
          : spec.content;
      await writeFn({ ...spec, content });
      const ok = await gate(spec.filePath);
      if (!ok) {
        allPassed = false;
        break;
      }
    }
    if (allPassed) return { finallyPassed: true, attemptsMade: attempt };
  }
  return { finallyPassed: false, attemptsMade: maxAttempts };
}
