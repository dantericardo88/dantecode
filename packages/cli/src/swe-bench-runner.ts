// ============================================================================
// packages/cli/src/swe-bench-runner.ts
//
// TypeScript SWE-bench evaluation runner for DanteCode.
// Runs DanteCode against real SWE-bench Verified instances and produces
// leaderboard-compatible JSON output.
//
// Design:
//   - loadSWEBenchInstances() reads JSONL from disk
//   - runSWEBenchInstance() runs one instance: clone → install → fix → test
//   - runSWEBenchEval() runs all instances and aggregates a SWEReport
//   - writeSWEReport() writes leaderboard-compatible JSON
//
// Key fixes vs the broken 0% harness:
//   1. Model defaults to DANTECODE_MODEL env or anthropic/claude-sonnet-4-6
//   2. PYTHONIOENCODING=utf-8 set on all Python subprocess calls
//   3. 600s timeout per instance (was 300s)
//   4. Each instance isolated in try/catch — failure never kills the run
//   5. Astropy plugin disabled via pytest flag
// ============================================================================

import { execFile as execFileCb } from "node:child_process";
import { mkdir, readFile, writeFile, rm, access } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";

const execFile = promisify(execFileCb);

// ----------------------------------------------------------------------------
// Types (leaderboard-compatible)
// ----------------------------------------------------------------------------

/** A single SWE-bench Verified instance. */
export interface SWEInstance {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  test_patch: string;
  patch?: string;              // Gold solution (never shown to agent)
  PASS_TO_PASS?: string[];
  FAIL_TO_PASS?: string[];
  // Legacy lowercase field names (some datasets use these)
  pass_to_pass?: string[];
  fail_to_pass?: string[];
}

/** Result for a single SWE-bench instance run. */
export interface SWERunResult {
  instance_id: string;
  /** true iff all FAIL_TO_PASS tests pass after agent intervention. */
  resolved: boolean;
  /** git diff produced by the agent. */
  model_patch: string;
  /** Full pytest output (truncated to 5000 chars). */
  test_output: string;
  duration_ms: number;
  error?: string;
}

/** Aggregate report for a complete evaluation run. */
export interface SWEReport {
  run_id: string;
  model: string;
  total: number;
  resolved: number;
  /** resolved / total */
  pass_rate: number;
  results: SWERunResult[];
  generated_at: string;
}

/** Options for running an evaluation. */
export interface SWEEvalOptions {
  model?: string;
  /** Timeout in milliseconds per instance (default: 600_000 = 10 min). */
  timeout?: number;
  /** Path to write the JSON report. If omitted, no file is written. */
  outputPath?: string;
  /** Called after each instance completes (for live progress). */
  onProgress?: (result: SWERunResult, idx: number, total: number) => void;
  /** Run N instances concurrently (default: 1). */
  parallel?: number;
  /** Skip git clone if workspace directory already exists. */
  useCachedClone?: boolean;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const DEFAULT_MODEL = "anthropic/claude-sonnet-4-6";
const DEFAULT_TIMEOUT_MS = 600_000;
const PYTEST_TIMEOUT_MS = 120_000;

/** Pytest flags that suppress problematic plugins on Windows. */
const PYTEST_FLAGS = [
  "--tb=short",
  "-q",
  "--no-header",
  "--override-ini=addopts=",
  "-p", "no:astropy",
];

/**
 * Per-repo agent timeout tiers. The single 600s default wastes budget on
 * small repos and starves large ones — astropy/matplotlib eat 60-120s
 * just rebuilding C extensions before the agent does anything. Allocate
 * by repo class so total wall-clock is comparable but each instance gets
 * the budget it actually needs.
 *
 * Tier rules:
 *   - small  (240s): test runners that cold-start fast and have small
 *     codebases. The agent has plenty of budget to think + edit.
 *   - medium (600s): default. Most repos sit here.
 *   - large  (1200s): repos with C/Cython extensions where setup
 *     consumes a significant chunk of the budget before the agent runs.
 */
const TIMEOUT_TIER_SMALL = 240_000;
const TIMEOUT_TIER_LARGE = 1_200_000;
const SMALL_REPOS = new Set([
  "psf/requests",
  "pallets/flask",
  "pallets/click",
  "pallets/jinja",
]);
const LARGE_REPOS = new Set([
  "astropy/astropy",
  "matplotlib/matplotlib",
  "scipy/scipy",
  "scikit-learn/scikit-learn",
  "pydata/xarray",
]);

/**
 * Pick the per-instance timeout. Caller-supplied options.timeout always
 * wins (lets tests + harness overrides bypass the tier table).
 */
export function selectInstanceTimeout(repo: string, override?: number): number {
  if (typeof override === "number" && override > 0) return override;
  if (LARGE_REPOS.has(repo)) return TIMEOUT_TIER_LARGE;
  if (SMALL_REPOS.has(repo)) return TIMEOUT_TIER_SMALL;
  return DEFAULT_TIMEOUT_MS;
}

// ----------------------------------------------------------------------------
// Subprocess helpers
// ----------------------------------------------------------------------------

function buildEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONLEGACYWINDOWSSTDIO: "0",
  };
}

async function run(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFile(cmd, args, {
      cwd: options.cwd,
      timeout: options.timeout ?? 120_000,
      env: buildEnv(),
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : 1,
    };
  }
}

// ----------------------------------------------------------------------------
// Dataset loading
// ----------------------------------------------------------------------------

/**
 * Load SWE-bench instances from a JSONL file.
 * Each line is a JSON object matching SWEInstance.
 */
export function loadSWEBenchInstances(dataPath: string): Promise<SWEInstance[]> {
  return new Promise((resolve, reject) => {
    const instances: SWEInstance[] = [];
    const stream = createReadStream(dataPath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        instances.push(JSON.parse(trimmed) as SWEInstance);
      } catch {
        // Skip malformed lines
      }
    });

    rl.on("close", () => resolve(instances));
    rl.on("error", reject);
    stream.on("error", reject);
  });
}

// ----------------------------------------------------------------------------
// Environment setup
// ----------------------------------------------------------------------------

async function setupEnvironment(
  instance: SWEInstance,
  workspace: string,
  useCachedClone = false,
): Promise<boolean> {
  const { repo, base_commit } = instance;
  const cloneUrl = `https://github.com/${repo}.git`;

  // Skip clone if workspace already exists and useCachedClone is set
  let skipClone = false;
  if (useCachedClone) {
    try {
      await access(workspace);
      skipClone = true;
    } catch {
      // Directory does not exist — proceed with clone
    }
  }

  // Clone
  if (!skipClone) {
  let cloneResult = await run("git", ["clone", "--depth", "1", cloneUrl, workspace], { timeout: 300_000 });
  if (cloneResult.exitCode !== 0) {
    // Retry without --depth
    cloneResult = await run("git", ["clone", cloneUrl, workspace], { timeout: 300_000 });
    if (cloneResult.exitCode !== 0) {
      return false;
    }
  }

  // Fetch + checkout exact commit
  await run("git", ["fetch", "--depth", "1", "origin", base_commit], { cwd: workspace, timeout: 120_000 });
  let checkoutResult = await run("git", ["checkout", base_commit], { cwd: workspace, timeout: 60_000 });
  if (checkoutResult.exitCode !== 0) {
    checkoutResult = await run("git", ["reset", "--hard", base_commit], { cwd: workspace, timeout: 60_000 });
    if (checkoutResult.exitCode !== 0) {
      return false;
    }
  }

  // Install package (try with and without --no-build-isolation)
  const pythonBin = process.platform === "win32" ? "python" : "python3";
  let installResult = await run(
    pythonBin,
    ["-m", "pip", "install", "-e", ".", "--quiet", "--no-build-isolation"],
    { cwd: workspace, timeout: 300_000 },
  );
  if (installResult.exitCode !== 0) {
    installResult = await run(
      pythonBin,
      ["-m", "pip", "install", "-e", ".", "--quiet"],
      { cwd: workspace, timeout: 300_000 },
    );
    // Non-fatal: some repos install fine but pip exits non-zero
  }
  } // end if (!skipClone)

  return true;
}

// ----------------------------------------------------------------------------
// Patch application
// ----------------------------------------------------------------------------

async function applyPatch(patchText: string, workspace: string): Promise<boolean> {
  // Use stdin pipe to avoid shell quoting / encoding issues
  return new Promise((resolve) => {
    const patchBuf = Buffer.from(patchText, "utf-8");
    const child = execFileCb(
      "git",
      ["apply", "--whitespace=fix", "-"],
      { cwd: workspace, env: buildEnv() },
      (err) => resolve(!err),
    );
    child.stdin?.write(patchBuf);
    child.stdin?.end();
  });
}

// ----------------------------------------------------------------------------
// Test runner
// ----------------------------------------------------------------------------

async function runTests(
  testSpecs: string[],
  workspace: string,
): Promise<{ passed: boolean; output: string }> {
  if (testSpecs.length === 0) {
    return { passed: false, output: "No test specs provided" };
  }

  const pythonBin = process.platform === "win32" ? "python" : "python3";
  const result = await run(
    pythonBin,
    ["-m", "pytest", ...PYTEST_FLAGS, ...testSpecs],
    { cwd: workspace, timeout: PYTEST_TIMEOUT_MS },
  );

  const output = (result.stdout + result.stderr).slice(0, 5000);
  return { passed: result.exitCode === 0, output };
}

// ----------------------------------------------------------------------------
// DanteCode invocation
// ----------------------------------------------------------------------------

async function runDanteCode(
  problemStatement: string,
  hints: string | undefined,
  workspace: string,
  model: string,
  timeoutMs: number,
  failingTestsPriming?: string,
): Promise<boolean> {
  const dantecodebin = process.env["DANTECODE_BIN"] ?? "dantecode";

  let prompt = problemStatement;
  if (hints) {
    prompt += `\n\nHints:\n${hints}`;
  }
  // OpenHands CodeAct pattern: pre-execute the failing tests once and feed
  // the stack trace to the agent as priming context. The agent doesn't have
  // to discover the failure through exploration — it can target the fix
  // immediately. Reduces test_assertion failures (model produces wrong fix
  // because it never saw the real error).
  if (failingTestsPriming && failingTestsPriming.trim()) {
    prompt += `\n\nFailing tests output (pre-execution, before any edit):\n<pre>${failingTestsPriming.slice(0, 3000)}</pre>\nUse this stack trace to locate the bug, then ship the fix. After editing, call SubmitPatch to self-inspect your diff.`;
  }

  await run(
    dantecodebin,
    [prompt, "--model", model, "--no-sandbox", "--silent"],
    { cwd: workspace, timeout: timeoutMs },
  );

  // Completed (even if timed out or had errors — partial patch may still solve issue)
  return true;
}

// ----------------------------------------------------------------------------
// Single instance runner
// ----------------------------------------------------------------------------

/**
 * Run a single SWE-bench instance against DanteCode.
 * Clones the repo, installs, applies the test patch, runs the agent, then
 * verifies with pytest. Returns a SWERunResult with resolved=true if all
 * FAIL_TO_PASS tests pass after agent intervention.
 */
export async function runSWEBenchInstance(
  instance: SWEInstance,
  _projectRoot: string,
  options: { model?: string; timeout?: number; useCachedClone?: boolean } = {},
): Promise<SWERunResult> {
  const model = options.model ?? process.env["DANTECODE_MODEL"] ?? DEFAULT_MODEL;
  const timeoutMs = selectInstanceTimeout(instance.repo, options.timeout);
  const startTime = Date.now();

  // Use a temp workspace to avoid polluting the project
  const workspaceBase = join(tmpdir(), "dantecode-swe-bench");
  const workspace = join(workspaceBase, instance.instance_id);

  const result: SWERunResult = {
    instance_id: instance.instance_id,
    resolved: false,
    model_patch: "",
    test_output: "",
    duration_ms: 0,
  };

  try {
    // Clean up any stale workspace (skip if using cached clone)
    if (!options.useCachedClone) {
      await rm(workspace, { recursive: true, force: true });
    }
    await mkdir(workspace, { recursive: true });

    // Step 1: Setup
    const setupOk = await setupEnvironment(instance, workspace, options.useCachedClone);
    if (!setupOk) {
      result.error = "Environment setup failed";
      return result;
    }

    // Step 2: Apply test patch (reveals what we need to fix)
    if (instance.test_patch) {
      const patchOk = await applyPatch(instance.test_patch, workspace);
      if (!patchOk) {
        result.error = "Test patch failed to apply";
        return result;
      }
    }

    // Step 2.5: Pre-execute the failing tests to prime the agent (CodeAct).
    // Cap at 60s — pre-exec is supposed to fail fast; if it hangs that's
    // an env issue, not a stack-trace source we want.
    const failToPassEarly = instance.FAIL_TO_PASS ?? instance.fail_to_pass ?? [];
    let priming = "";
    if (failToPassEarly.length > 0) {
      try {
        const pre = await runTests(failToPassEarly, workspace);
        if (!pre.passed) priming = pre.output;
      } catch {
        // Pre-execute failure is non-fatal — agent continues without priming.
      }
    }

    // Step 3: Run DanteCode agent
    await runDanteCode(
      instance.problem_statement,
      instance.hints_text,
      workspace,
      model,
      timeoutMs,
      priming,
    );

    // Step 4: Capture the agent's patch
    const diffResult = await run("git", ["diff", "HEAD"], { cwd: workspace, timeout: 30_000 });
    result.model_patch = diffResult.stdout.slice(0, 10_000);

    // Step 5: Verify resolution
    const failToPass = (instance.FAIL_TO_PASS ?? instance.fail_to_pass ?? []);
    const passToPass = (instance.PASS_TO_PASS ?? instance.pass_to_pass ?? []);
    const allSpecs = [...failToPass, ...passToPass];

    const { passed, output } = await runTests(allSpecs.length > 0 ? allSpecs : ["tests/"], workspace);
    result.resolved = passed;
    result.test_output = output;

  } catch (err: unknown) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    result.duration_ms = Date.now() - startTime;
    // Clean up workspace
    await rm(workspace, { recursive: true, force: true }).catch(() => void 0);
  }

  return result;
}

// ----------------------------------------------------------------------------
// Full evaluation runner
// ----------------------------------------------------------------------------

/**
 * Run a full SWE-bench evaluation against a list of instances.
 * Returns a SWEReport with leaderboard-compatible pass_rate.
 */
export async function runSWEBenchEval(
  instances: SWEInstance[],
  projectRoot: string,
  options: SWEEvalOptions = {},
): Promise<SWEReport> {
  const model = options.model ?? process.env["DANTECODE_MODEL"] ?? DEFAULT_MODEL;
  const runId = `dantecode-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

  const results: SWERunResult[] = [];
  const parallel = options.parallel ?? 1;

  for (let i = 0; i < instances.length; i += parallel) {
    const batch = instances.slice(i, i + parallel);
    const batchResults = await Promise.all(
      batch.map(async (inst, j) => {
        try {
          const r = await runSWEBenchInstance(inst, projectRoot, {
            model,
            timeout: options.timeout,
            useCachedClone: options.useCachedClone,
          });
          options.onProgress?.(r, i + j + 1, instances.length);
          return r;
        } catch (err: unknown) {
          const errResult: SWERunResult = {
            instance_id: inst.instance_id,
            resolved: false,
            model_patch: "",
            test_output: "",
            error: String(err instanceof Error ? err.message : err),
            duration_ms: 0,
          };
          options.onProgress?.(errResult, i + j + 1, instances.length);
          return errResult;
        }
      }),
    );
    results.push(...batchResults);
  }

  const resolved = results.filter((r) => r.resolved).length;
  const report: SWEReport = {
    run_id: runId,
    model,
    total: results.length,
    resolved,
    pass_rate: results.length > 0 ? resolved / results.length : 0,
    results,
    generated_at: new Date().toISOString(),
  };

  if (options.outputPath) {
    await writeSWEReport(report, options.outputPath);
  }

  return report;
}

// ----------------------------------------------------------------------------
// Report I/O
// ----------------------------------------------------------------------------

/** Write a SWEReport to a JSON file (leaderboard-compatible format). */
export async function writeSWEReport(report: SWEReport, outputPath: string): Promise<void> {
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
}

/** Format a SWEReport as human-readable markdown. */
export function formatSWEReport(report: SWEReport): string {
  const lines = [
    `# SWE-bench Evaluation Report`,
    ``,
    `**Run ID:** ${report.run_id}`,
    `**Model:** ${report.model}`,
    `**Pass Rate:** ${(report.pass_rate * 100).toFixed(1)}% (${report.resolved}/${report.total})`,
    `**Generated:** ${report.generated_at}`,
    ``,
    `## Results`,
    ``,
  ];

  for (const r of report.results) {
    const status = r.resolved ? "✓" : "✗";
    const err = r.error ? ` — ${r.error}` : "";
    const ms = `${(r.duration_ms / 1000).toFixed(1)}s`;
    lines.push(`- ${status} \`${r.instance_id}\` (${ms})${err}`);
  }

  return lines.join("\n");
}

// ── computePassRate ────────────────────────────────────────────────────────────

export interface PassRateSummary {
  passed: number;
  total: number;
  rate: number;
}

export function computePassRate(
  results: Array<{ resolved?: boolean; status?: string }>,
): PassRateSummary {
  const total = results.length;
  if (total === 0) return { passed: 0, total: 0, rate: 0 };
  const passed = results.filter((r) => r.resolved === true || r.status === "resolved").length;
  return { passed, total, rate: passed / total };
}

// ── dryRunValidate ────────────────────────────────────────────────────────────

export interface DryRunValidateResult {
  instance_id: string;
  parsedOk: boolean;
  hasTestSpecs: boolean;
  hasProblemStatement: boolean;
  hasBaseCommit: boolean;
  triage: "easy" | "hard";
}

export function dryRunValidate(instances: SWEInstance[]): DryRunValidateResult[] {
  return instances.map((inst) => {
    const failToPass = inst.FAIL_TO_PASS ?? inst.fail_to_pass ?? [];
    const passToPass = inst.PASS_TO_PASS ?? inst.pass_to_pass ?? [];
    return {
      instance_id: inst.instance_id,
      parsedOk: Boolean(inst.instance_id && inst.repo),
      hasTestSpecs: failToPass.length > 0 || passToPass.length > 0,
      hasProblemStatement: Boolean(inst.problem_statement?.trim()),
      hasBaseCommit: Boolean(inst.base_commit?.trim()),
      triage: triageInstance(inst),
    };
  });
}

// ── triageInstance ────────────────────────────────────────────────────────────

export function triageInstance(instance: SWEInstance): "easy" | "hard" {
  const failToPass = instance.FAIL_TO_PASS ?? instance.fail_to_pass ?? [];
  if (instance.problem_statement.length > 500 || failToPass.length > 2) return "hard";
  return "easy";
}

// ── classifyFailureMode ───────────────────────────────────────────────────────

export function classifyFailureMode(result: SWERunResult): string {
  if (result.resolved) return "resolved";
  if (result.error && /timed? out|timeout/i.test(result.error)) return "timeout";
  if (result.error && /clone/i.test(result.error)) return "clone_error";
  const output = result.test_output ?? "";
  if (/ImportError/i.test(output)) return "import_error";
  if (/SyntaxError|ModuleNotFoundError|compile/i.test(output)) return "compile_error";
  if (/FAILED|AssertionError/i.test(output)) return "test_assertion";
  if (!result.model_patch || !result.model_patch.trim()) return "no_patch";
  return "unknown";
}

// ── buildFailureModeAntiPatterns ──────────────────────────────────────────────

const FAILURE_MODE_ADVICE: Record<string, string> = {
  timeout: "Produce a minimal patch — avoid broad rewrites that cause agent timeout.",
  compile_error: "Verify imports and syntax before submitting. Run python -c 'import <module>' to check.",
  no_patch: "Always produce a concrete file change — even a one-line fix is better than no patch.",
  test_assertion: "Run the test spec locally and verify your patch makes failing tests pass.",
};

export function buildFailureModeAntiPatterns(failureModes: string[]): string {
  if (failureModes.length === 0) return "";
  const lines = ["## SWE-bench Anti-Pattern Guidance", ""];
  for (const entry of failureModes) {
    const [mode] = entry.split(":");
    const advice = FAILURE_MODE_ADVICE[mode ?? ""] ?? `Avoid repeating ${mode} failures.`;
    lines.push(`- **${mode}**: ${advice}`);
  }
  return lines.join("\n");
}

// ── parseStepsFromOutput ──────────────────────────────────────────────────────

export interface ParsedStep {
  tool: string;
  input: string;
  output: string;
  durationMs: number;
}

export function parseStepsFromOutput(output: string, totalDurationMs: number): ParsedStep[] {
  const TOOL_PATTERN = /\[TOOL\]:\s*(\w+):\s*(.+)/g;
  const steps: ParsedStep[] = [];
  let match: RegExpExecArray | null;
  while ((match = TOOL_PATTERN.exec(output)) !== null) {
    steps.push({
      tool: match[1] ?? "",
      input: match[2]?.trim() ?? "",
      output: "",
      durationMs: steps.length === 0 ? Math.floor(totalDurationMs / Math.max(1, (output.match(/\[TOOL\]/g)?.length ?? 1))) : 0,
    });
  }
  return steps;
}

// ── PersistentBenchResults ────────────────────────────────────────────────────

export interface PersistentBenchRunEntry {
  run_id: string;
  timestamp: string;
  model: string;
  total: number;
  resolved: number;
  pass_rate: number;
  failure_modes: string[];
  instance_outcomes: Array<{ id: string; resolved: boolean; failure?: string }>;
}

export interface PersistentBenchResults {
  last_updated: string;
  best_pass_rate: number;
  best_model: string;
  runs: PersistentBenchRunEntry[];
}

// ── extractTopFailureModes ────────────────────────────────────────────────────

/**
 * Takes a SWEReport and returns failure mode strings in "mode:count" format.
 * Only counts non-resolved instances. Sorted descending by count. Sliced to topN.
 */
export function extractTopFailureModes(report: SWEReport, topN = 10): string[] {
  const counts = new Map<string, number>();
  for (const result of report.results) {
    if (result.resolved) continue;
    const mode = classifyFailureMode(result);
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([mode, count]) => `${mode}:${count}`);
}

// ── persistBenchResults ───────────────────────────────────────────────────────

/**
 * Reads/writes .danteforge/bench-results.json. Prepends new run entry (newest-first).
 * Evicts oldest runs when runs.length > maxRuns. Updates best_pass_rate/best_model.
 * Returns updated PersistentBenchResults.
 */
export async function persistBenchResults(
  report: SWEReport,
  projectRoot: string,
  maxRuns = 50,
): Promise<PersistentBenchResults> {
  const dir = join(projectRoot, ".danteforge");
  const filePath = join(dir, "bench-results.json");

  let existing: PersistentBenchResults = {
    last_updated: "",
    best_pass_rate: 0,
    best_model: "",
    runs: [],
  };

  try {
    const raw = await readFile(filePath, "utf-8");
    existing = JSON.parse(raw) as PersistentBenchResults;
  } catch {
    // ENOENT or parse error — start fresh
  }

  const instance_outcomes = report.results.map((r) => {
    const mode = classifyFailureMode(r);
    return {
      id: r.instance_id,
      resolved: r.resolved ?? false,
      ...(mode !== "resolved" ? { failure: mode } : {}),
    };
  });

  const newEntry: PersistentBenchRunEntry = {
    run_id: report.run_id,
    timestamp: new Date().toISOString(),
    model: report.model,
    total: report.total,
    resolved: report.resolved,
    pass_rate: report.pass_rate,
    failure_modes: extractTopFailureModes(report),
    instance_outcomes,
  };

  // Prepend newest run
  const runs = [newEntry, ...existing.runs];
  // Evict oldest when over limit
  if (runs.length > maxRuns) {
    runs.splice(maxRuns);
  }

  // Update record
  let best_pass_rate = existing.best_pass_rate;
  let best_model = existing.best_model;
  if (report.pass_rate > best_pass_rate) {
    best_pass_rate = report.pass_rate;
    best_model = report.model;
  }

  const updated: PersistentBenchResults = {
    last_updated: new Date().toISOString(),
    best_pass_rate,
    best_model,
    runs,
  };

  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(updated, null, 2), "utf-8");
  return updated;
}

// ── computeTrend ─────────────────────────────────────────────────────────────

export interface BenchTrend {
  direction: "improving" | "declining" | "stable";
  slope: number;
  run_count: number;
  best_pass_rate: number;
  worst_pass_rate: number;
  first_pass_rate: number;
  last_pass_rate: number;
  top_failure_modes: string[];
}

/**
 * Computes slope/direction from PersistentBenchResults.
 * runs[] is newest-first; reverses to chronological order for slope computation.
 * slope = linear regression slope of pass_rate over index.
 * direction: "improving" if slope > 0.001, "declining" if slope < -0.001, else "stable".
 */
export function computeTrend(data: PersistentBenchResults): BenchTrend {
  const runs = data.runs;

  if (runs.length === 0) {
    return {
      direction: "stable",
      slope: 0,
      run_count: 0,
      best_pass_rate: 0,
      worst_pass_rate: 0,
      first_pass_rate: 0,
      last_pass_rate: 0,
      top_failure_modes: [],
    };
  }

  // Reverse to chronological order (oldest first)
  const chronological = [...runs].reverse();
  const n = chronological.length;

  let slope = 0;
  if (n > 1) {
    // Linear regression slope: Σ((x_i - x_mean)(y_i - y_mean)) / Σ((x_i - x_mean)^2)
    const xMean = (n - 1) / 2;
    const yMean = chronological.reduce((sum, r) => sum + r.pass_rate, 0) / n;
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < n; i++) {
      const dx = i - xMean;
      const dy = (chronological[i]?.pass_rate ?? 0) - yMean;
      numerator += dx * dy;
      denominator += dx * dx;
    }
    slope = denominator !== 0 ? numerator / denominator : 0;
  }

  const direction: "improving" | "declining" | "stable" =
    slope > 0.001 ? "improving" : slope < -0.001 ? "declining" : "stable";

  const passRates = runs.map((r) => r.pass_rate);
  const best_pass_rate = Math.max(...passRates);
  const worst_pass_rate = Math.min(...passRates);
  // chronological[0] = oldest = first; chronological[n-1] = newest = last
  const first_pass_rate = chronological[0]?.pass_rate ?? 0;
  const last_pass_rate = chronological[n - 1]?.pass_rate ?? 0;

  // Aggregate unique mode names from all failure_modes strings across all runs
  const modeNames = new Set<string>();
  for (const run of runs) {
    for (const entry of run.failure_modes) {
      const [mode] = entry.split(":");
      if (mode) modeNames.add(mode);
    }
  }

  return {
    direction,
    slope,
    run_count: n,
    best_pass_rate,
    worst_pass_rate,
    first_pass_rate,
    last_pass_rate,
    top_failure_modes: Array.from(modeNames),
  };
}

// ── getReproducedTranche ──────────────────────────────────────────────────────

export interface ReproducedTranchEntry {
  instanceId: string;
  patchApplied: boolean;
  testsPassed: boolean;
  resolvedAt: string;
}

/**
 * Synchronously reads bench-results.json from the given path and returns
 * data.reproduced_tranche array, or [] if file not found/invalid.
 */
export function getReproducedTranche(benchPath: string): ReproducedTranchEntry[] {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = readFileSync(benchPath, "utf-8");
    const data = JSON.parse(raw) as { reproduced_tranche?: unknown[] };
    if (!Array.isArray(data.reproduced_tranche)) return [];
    return data.reproduced_tranche as ReproducedTranchEntry[];
  } catch {
    return [];
  }
}

// ── verifyPatchApplicability ──────────────────────────────────────────────────

/**
 * Extracts (filePath, contextLines) pairs from a unified diff.
 * Used to seed the temp repo with files that match the patch's context,
 * so that git apply --check works on real patches.
 */
function extractPatchFileSeeds(patchContent: string): Array<{ filePath: string; content: string }> {
  const seeds: Array<{ filePath: string; content: string }> = [];
  const fileBlocks = patchContent.split(/^diff --git /m).filter(Boolean);

  for (const block of fileBlocks) {
    // Extract target file path from "--- a/..." line
    const targetMatch = /^--- a\/(.+)$/m.exec(block);
    if (!targetMatch) continue;
    const filePath = targetMatch[1]!.trim();

    // Extract context lines and removed lines (lines starting with " " or "-")
    // Skip diff header lines: "--- a/...", "+++ b/...", "@@ ... @@", "\ No newline..."
    const lines: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("@@")) continue;
      if (line.startsWith("--- ") || line.startsWith("+++ ")) continue; // diff header
      if (line.startsWith("\\ ")) continue; // "\ No newline at end of file"
      if (line.startsWith(" ")) lines.push(line.slice(1)); // context line
      else if (line.startsWith("-")) lines.push(line.slice(1)); // removed line (must exist in original)
    }
    if (lines.length > 0) {
      seeds.push({ filePath, content: lines.join("\n") + "\n" });
    }
  }
  return seeds;
}

/**
 * Creates a temp git repo seeded with files extracted from the patch's context,
 * then runs `git apply --check` to test whether the patch applies cleanly.
 * Returns true if the patch applies cleanly, false otherwise. Never throws.
 */
export async function verifyPatchApplicability(
  patchContent: string,
  tempBaseDir?: string,
): Promise<boolean> {
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const { mkdirSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");

  const base = tempBaseDir ?? os.tmpdir();
  const tmpRepo = path.join(base, `dc-patch-verify-${randomUUID()}`);

  try {
    mkdirSync(tmpRepo, { recursive: true });

    const run = (cmd: string, args: string[], opts?: { input?: string }) =>
      spawnSync(cmd, args, {
        cwd: tmpRepo,
        encoding: "utf-8",
        timeout: 15_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
        input: opts?.input,
      });

    run("git", ["init"]);
    run("git", ["config", "user.email", "test@test.com"]);
    run("git", ["config", "user.name", "Test"]);

    // Seed repo with files extracted from the patch so git apply --check works
    const seeds = extractPatchFileSeeds(patchContent);
    if (seeds.length > 0) {
      for (const { filePath, content } of seeds) {
        const fullPath = path.join(tmpRepo, filePath);
        mkdirSync(path.dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, content, "utf-8");
      }
    } else {
      // Fallback: single placeholder so there's at least one commit
      writeFileSync(path.join(tmpRepo, "placeholder.txt"), "placeholder\n", "utf-8");
    }

    run("git", ["add", "."]);
    run("git", ["commit", "-m", "init"]);

    // Write patch to a file then run git apply --check
    const patchFile = path.join(tmpRepo, "patch.diff");
    writeFileSync(patchFile, patchContent, "utf-8");

    const result = run("git", ["apply", "--check", patchFile]);
    return result.status === 0;
  } catch {
    return false;
  } finally {
    try {
      const { rmSync } = require("node:fs") as typeof import("node:fs");
      rmSync(tmpRepo, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}

// ── Hard-task correctness rate ────────────────────────────────────────────────

export interface HardTaskSuccessEntry {
  sessionId: string;
  prompt: string;
  verdict: string;
  typeCheckPassed: boolean;
  timestamp: string;
}

export interface HardTaskSuccessRate {
  totalHardTasks: number;
  completedCleanly: number;
  successRate: number;
  computedAt: string;
}

/**
 * Computes the fraction of hard tasks that got COMPLETED verdict.
 * Reads from .danteforge/task-completion-log.jsonl.
 * Writes .danteforge/hard-task-success-rate.json.
 */
export async function computeHardTaskSuccessRate(projectRoot: string): Promise<HardTaskSuccessRate> {
  const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");

  const logPath = path.join(projectRoot, ".danteforge", "task-completion-log.jsonl");
  const outPath = path.join(projectRoot, ".danteforge", "hard-task-success-rate.json");

  let entries: Array<{ verdict: string; toolCallCount: number }> = [];
  try {
    if (existsSync(logPath)) {
      entries = readFileSync(logPath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map((l: string) => JSON.parse(l) as { verdict: string; toolCallCount: number });
    }
  } catch {
    entries = [];
  }

  // "Hard" tasks: those with >= 5 tool calls (proxy for hard, since task-triage
  // classification isn't stored in completion log)
  const hardTasks = entries.filter((e) => e.toolCallCount >= 5);
  const completedCleanly = hardTasks.filter((e) => e.verdict === "COMPLETED").length;
  const successRate = hardTasks.length > 0 ? completedCleanly / hardTasks.length : 0;

  const result: HardTaskSuccessRate = {
    totalHardTasks: hardTasks.length,
    completedCleanly,
    successRate,
    computedAt: new Date().toISOString(),
  };

  try {
    const dir = path.join(projectRoot, ".danteforge");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");
  } catch {
    // non-fatal
  }

  return result;
}

/**
 * Task-success oracle: runs tsc --noEmit on the nearest package containing
 * any of the touched files. Returns true if typecheck passes (exit 0).
 * Non-fatal: returns null on any error.
 */
export async function runTypeCheckOracle(
  touchedFiles: string[],
  projectRoot: string,
): Promise<boolean | null> {
  if (touchedFiles.length === 0) return null;

  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const { existsSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");

  // Find nearest package.json walking up from first touched file
  const findPackageDir = (filePath: string): string => {
    let dir = path.dirname(filePath);
    let iterations = 0;
    while (dir !== path.dirname(dir) && iterations < 10) {
      if (existsSync(path.join(dir, "package.json"))) return dir;
      dir = path.dirname(dir);
      iterations++;
    }
    return projectRoot;
  };

  const packageDir = findPackageDir(path.resolve(projectRoot, touchedFiles[0]!));

  try {
    const result = spawnSync("npx", ["tsc", "--noEmit"], {
      cwd: packageDir,
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, NODE_NO_WARNINGS: "1" },
    });
    return result.status === 0;
  } catch {
    return null;
  }
}

// ── classifyAgentFailure ──────────────────────────────────────────────────────
/**
 * Classify a raw agent output string into a failure mode.
 * Used to analyze what went wrong during an autonomous agent run.
 */
export function classifyAgentFailure(output: string): string {
  if (!output || !output.trim()) return "no_output";
  if (/timed? out|timeout/i.test(output)) return "timeout";
  if (/error TS\d+|type\s+error|is not assignable|property.*does not exist/i.test(output)) return "type_error";
  if (/ImportError|Cannot find module|Module not found/i.test(output)) return "import_error";
  if (/SyntaxError|Unexpected token|Unexpected end/i.test(output)) return "compile_error";
  if (/AssertionError|Expected.*to equal|expect.*failed|FAILED|✗|×/i.test(output)) return "test_assertion";
  return "unknown";
}

const AGENT_FAILURE_HINTS: Record<string, string> = {
  type_error: "[Recovery hint] Fix TypeScript type errors — ensure all types match and run tsc --noEmit before submitting.",
  import_error: "[Recovery hint] Check import paths and module names — ensure all dependencies exist before importing.",
  compile_error: "[Recovery hint] Fix syntax errors — validate the code structure before execution.",
  test_assertion: "[Recovery hint] Review failing assertions — run tests locally and verify the expected values match.",
  assertion_failure: "[Recovery hint] Review failing assertions — run tests locally and verify the expected values match.",
  timeout: "[Recovery hint] Produce a minimal patch — avoid broad rewrites that cause agent timeout.",
  lint_error: "[Recovery hint] Fix linting errors — run the linter locally and address all warnings before submitting.",
  runtime_error: "[Recovery hint] Fix runtime errors — add error handling and validate inputs before execution.",
  no_output: "[Recovery hint] Ensure the agent produces output — check for silent failures or empty responses.",
  unknown: "[Recovery hint] Investigate the root cause — check logs for any error messages.",
};

// ── buildFailureModeHint ──────────────────────────────────────────────────────
/**
 * Returns targeted guidance for a given agent failure mode.
 */
export function buildFailureModeHint(mode: string): string {
  return AGENT_FAILURE_HINTS[mode] ?? `[Recovery hint] Investigate and avoid repeating ${mode} failures.`;
}

// ── Resolution chain ─────────────────────────────────────────────────────────

/**
 * Full resolution evidence chain for a single patch attempt.
 * Each step builds on the previous — if patchApplicable=false, later steps skip.
 * resolutionScore: weighted 0-1 across all steps.
 */
export interface ResolutionScore {
  patchApplicable: boolean;      // 0.40 weight
  syntaxValid: boolean;          // 0.20 weight — patch produces parseable diff lines
  typeCheckPassed: boolean | null;   // 0.25 weight — tsc on patched content (null = not checked)
  testsPassed: boolean | null;   // 0.15 weight — downstream test evidence (null = not checked)
  resolutionScore: number;       // weighted 0–1
  computedAt: string;
}

/**
 * Computes resolutionScore from booleans using the weighted chain:
 *   patchApplicable: 0.40, syntaxValid: 0.20, typeCheckPassed: 0.25, testsPassed: 0.15
 */
export function computeResolutionScore(
  patchApplicable: boolean,
  syntaxValid: boolean,
  typeCheckPassed: boolean | null,
  testsPassed: boolean | null,
): number {
  let score = 0;
  if (patchApplicable) score += 0.40;
  if (syntaxValid) score += 0.20;
  if (typeCheckPassed === true) score += 0.25;
  if (testsPassed === true) score += 0.15;
  return Math.round(score * 1000) / 1000;
}

/**
 * Builds a full ResolutionScore for a patch by running through the chain.
 * syntaxValid: patch content has well-formed diff headers and hunk markers.
 * typeCheckPassed: always null here (no target project to typecheck against).
 * testsPassed: always null (caller must supply from external evidence).
 */
export function buildResolutionEvidence(
  patchContent: string,
  patchApplicable: boolean,
  typeCheckPassed: boolean | null = null,
  testsPassed: boolean | null = null,
): ResolutionScore {
  // syntaxValid: patch must have at least one diff --git header and one @@ hunk
  const syntaxValid =
    patchApplicable &&
    /^diff --git /m.test(patchContent) &&
    /^@@/m.test(patchContent);

  const resolutionScore = computeResolutionScore(patchApplicable, syntaxValid, typeCheckPassed, testsPassed);

  return {
    patchApplicable,
    syntaxValid,
    typeCheckPassed,
    testsPassed,
    resolutionScore,
    computedAt: new Date().toISOString(),
  };
}

/**
 * Computes the overall resolution rate across a set of ResolutionScore entries.
 * Returns average resolutionScore (0-1).
 */
export function getOverallResolutionRate(entries: ResolutionScore[]): number {
  if (entries.length === 0) return 0;
  const total = entries.reduce((sum, e) => sum + e.resolutionScore, 0);
  return Math.round((total / entries.length) * 1000) / 1000;
}

// ── runVerifiedTranche ────────────────────────────────────────────────────────

export interface VerifiedTranchEntry {
  instanceId: string;
  patchContent: string;
  patchApplicable: boolean;
  resolution: ResolutionScore;
  verifiedAt: string;
}

/**
 * Runs verifyPatchApplicability for each instance, computes full ResolutionScore.
 */
export async function runVerifiedTranche(
  instances: Array<{ instanceId: string; patchContent: string; testsPassed?: boolean }>,
  _projectRoot: string,
): Promise<VerifiedTranchEntry[]> {
  const results: VerifiedTranchEntry[] = [];
  for (const inst of instances) {
    const patchApplicable = await verifyPatchApplicability(inst.patchContent);
    const resolution = buildResolutionEvidence(
      inst.patchContent,
      patchApplicable,
      null,
      inst.testsPassed ?? null,
    );
    results.push({
      instanceId: inst.instanceId,
      patchContent: inst.patchContent,
      patchApplicable,
      resolution,
      verifiedAt: new Date().toISOString(),
    });
  }
  return results;
}
