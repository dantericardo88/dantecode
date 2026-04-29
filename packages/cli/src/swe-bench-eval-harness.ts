// ============================================================================
// packages/cli/src/swe-bench-eval-harness.ts
//
// Real SWE-bench eval harness (Sprint BE — dim 5).
// Shallow-clones the actual target repo, checks out the exact base commit,
// applies the patch with `git apply`, and optionally runs the test command.
// ============================================================================

import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";

const execFileAsync = promisify(execFile);

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface SWEBenchInstance {
  instanceId: string;
  /** Full git clone URL, e.g. "https://github.com/django/django" */
  repoUrl: string;
  /** Git commit SHA to checkout (the base commit before the fix) */
  baseCommit: string;
  /** The solution patch in unified diff format */
  patch: string;
  /** Shell command to run the failing tests, e.g. "python -m pytest tests/test_auth.py -x" */
  testCmd?: string;
  /** Max seconds to wait for test execution. Default 60. */
  testTimeoutSecs?: number;
}

export interface SWEBenchEvalResult {
  instanceId: string;
  cloneSucceeded: boolean;
  checkoutSucceeded: boolean;
  patchApplicable: boolean;
  testsPassed?: boolean;   // undefined when testCmd not provided
  testOutput?: string;
  errorReason?: string;
  workDir: string;         // temp dir used (already cleaned up after eval)
  durationMs: number;
}

export interface SWEBenchEvalLog {
  instanceId: string;
  repoUrl: string;
  baseCommit: string;
  result: SWEBenchEvalResult;
  timestamp: string;
}

export interface SWEBenchEvalStats {
  totalInstances: number;
  cloneSuccessRate: number;
  patchApplicableRate: number;
  testPassRate: number;   // only for instances where testCmd was provided
}

// ----------------------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------------------

/** Split a shell command string into an argv array, honouring simple quoting. */
function splitCmd(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === " " && !inSingle && !inDouble) {
      if (current.length > 0) { parts.push(current); current = ""; }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

// ----------------------------------------------------------------------------
// evalSWEBenchInstance
// ----------------------------------------------------------------------------

/**
 * Evaluate a SWE-bench instance by:
 * 1. Shallow-cloning the repo at depth=50
 * 2. Checking out the exact baseCommit
 * 3. Applying the patch with `git apply`
 * 4. Optionally running the testCmd and capturing output
 * 5. Cleaning up the temp dir
 *
 * Network errors produce cloneSucceeded=false without throwing.
 */
/** Run a step on the eval workdir and stamp the matching `success` flag on
 *  `result`. Returns true when the step passed. */
async function runEvalStep(
  result: SWEBenchEvalResult,
  flagName: "cloneSucceeded" | "checkoutSucceeded" | "patchApplicable",
  errorPrefix: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  try {
    await fn();
    result[flagName] = true;
    return true;
  } catch (e: unknown) {
    result.errorReason = `${errorPrefix}: ${(e as Error).message ?? String(e)}`;
    return false;
  }
}

async function runEvalTestCommand(workDir: string, testCmd: string, timeoutSecs: number | undefined, result: SWEBenchEvalResult): Promise<void> {
  const timeoutMs = (timeoutSecs ?? 60) * 1000;
  const argv = splitCmd(testCmd);
  const exe = argv[0]!;
  const args = argv.slice(1);
  try {
    const r = await execFileAsync(exe, args, { cwd: workDir, timeout: timeoutMs });
    result.testsPassed = true;
    result.testOutput = (r.stdout ?? "").slice(0, 2000);
  } catch (e: unknown) {
    result.testsPassed = false;
    const err = e as { stdout?: string; stderr?: string };
    result.testOutput = ((err.stdout ?? "") + (err.stderr ?? "")).slice(0, 2000);
  }
}

export async function evalSWEBenchInstance(
  instance: SWEBenchInstance,
  workBaseDir?: string,
): Promise<SWEBenchEvalResult> {
  const start = Date.now();
  const workDir = join(workBaseDir ?? tmpdir(), `swe-eval-${instance.instanceId}-${Date.now()}`);
  const result: SWEBenchEvalResult = {
    instanceId: instance.instanceId,
    cloneSucceeded: false,
    checkoutSucceeded: false,
    patchApplicable: false,
    workDir,
    durationMs: 0,
  };

  try {
    await mkdir(workDir, { recursive: true });

    if (!await runEvalStep(result, "cloneSucceeded", "clone failed", async () => {
      await execFileAsync("git", ["clone", "--depth", "50", instance.repoUrl, workDir], { timeout: 120_000 });
    })) return finalize(result, start);

    if (!await runEvalStep(result, "checkoutSucceeded", "checkout failed", async () => {
      await execFileAsync("git", ["checkout", instance.baseCommit], { cwd: workDir, timeout: 30_000 });
    })) return finalize(result, start);

    const patchPath = join(workDir, "_eval.patch");
    await writeFile(patchPath, instance.patch, "utf-8");
    if (!await runEvalStep(result, "patchApplicable", "patch failed", async () => {
      await execFileAsync("git", ["apply", patchPath], { cwd: workDir, timeout: 30_000 });
    })) return finalize(result, start);

    if (instance.testCmd) {
      await runEvalTestCommand(workDir, instance.testCmd, instance.testTimeoutSecs, result);
    }
  } catch (e: unknown) {
    result.errorReason = `unexpected: ${(e as Error).message ?? String(e)}`;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => void 0);
  }

  return finalize(result, start);
}

function finalize(result: SWEBenchEvalResult, start: number): SWEBenchEvalResult {
  result.durationMs = Date.now() - start;
  return result;
}

// ----------------------------------------------------------------------------
// Persistence helpers
// ----------------------------------------------------------------------------

const DEFAULT_LOG_PATH = ".danteforge/swe-bench-eval-log.json";

function resolveLogPath(projectRoot?: string): string {
  return join(projectRoot ?? process.cwd(), DEFAULT_LOG_PATH);
}

/**
 * Append a SWEBenchEvalLog entry to .danteforge/swe-bench-eval-log.json.
 * Uses JSONL append — one JSON object per line.
 */
export function recordSWEBenchEval(log: SWEBenchEvalLog, projectRoot?: string): void {
  const logPath = resolveLogPath(projectRoot);
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(log) + "\n", "utf-8");
}

/** Read and parse all JSONL entries from the eval log. */
export function loadSWEBenchEvalLog(projectRoot?: string): SWEBenchEvalLog[] {
  const logPath = resolveLogPath(projectRoot);
  try {
    const raw = readFileSync(logPath, "utf-8");
    return raw
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0)
      .map((line: string) => JSON.parse(line) as SWEBenchEvalLog);
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Stats
// ----------------------------------------------------------------------------

/**
 * Compute aggregate stats from a set of eval log entries.
 * testPassRate is computed only over instances where testCmd output was
 * captured (i.e. testsPassed is not undefined).
 */
export function getSWEBenchEvalStats(logs: SWEBenchEvalLog[]): SWEBenchEvalStats {
  if (logs.length === 0) {
    return {
      totalInstances: 0,
      cloneSuccessRate: 0,
      patchApplicableRate: 0,
      testPassRate: 0,
    };
  }

  const total = logs.length;
  const cloned = logs.filter((l) => l.result.cloneSucceeded).length;
  const patched = logs.filter((l) => l.result.patchApplicable).length;

  const testedLogs = logs.filter((l) => l.result.testsPassed !== undefined);
  const testPassed = testedLogs.filter((l) => l.result.testsPassed === true).length;

  return {
    totalInstances: total,
    cloneSuccessRate: cloned / total,
    patchApplicableRate: patched / total,
    testPassRate: testedLogs.length > 0 ? testPassed / testedLogs.length : 0,
  };
}
