/**
 * test-repair.ts
 *
 * Post-apply test repair loop following Aider's base_coder.py pattern.
 * Automatically fixes test failures after code mutations.
 */

import { execSync } from "node:child_process";
import { parseTestOutput, type TestFailure } from "./test-parsers.js";
import type { EventEngine } from "../event-engine.js";
import { buildRuntimeEvent } from "@dantecode/runtime-spine";
import { randomUUID } from "node:crypto";

// Re-export TestFailure for convenience
export type { TestFailure } from "./test-parsers.js";

export interface TestConfig {
  command: string; // e.g., "npm test"
  maxRetries: number; // default: 3
  runBeforeMutations: boolean; // Run baseline test, default: true
  runner?: "vitest" | "jest" | "pytest" | "go"; // For parser selection
}

export interface TestResult {
  success: boolean;
  failures: TestFailure[];
  baselineFailures?: TestFailure[]; // Failures before mutations
  newFailures: TestFailure[]; // New failures introduced
  iteration: number; // Which retry iteration this result is from
}

export interface RunTestRepairOptions {
  config: TestConfig;
  projectRoot: string;
  eventEngine?: EventEngine;
  taskId?: string;
  /** Baseline failures from before mutations - if provided, skips baseline run */
  baselineFailures?: TestFailure[];
  /** Injectable exec function for testing */
  execFn?: (command: string, options: any) => Buffer;
}

/**
 * Run test command and parse output
 */
function runTests(
  command: string,
  projectRoot: string,
  runner: "vitest" | "jest" | "pytest" | "go" | undefined,
  execFn?: (command: string, options: any) => Buffer,
): { output: string; failures: TestFailure[] } {
  const exec = execFn || execSync;

  try {
    const output = exec(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    const outputStr = typeof output === "string" ? output : output.toString("utf-8");
    const failures = parseTestOutput(outputStr, runner);

    return { output: outputStr, failures };
  } catch (error: any) {
    // Test runners return non-zero exit code when tests fail
    const output = error.stdout?.toString("utf-8") || error.stderr?.toString("utf-8") || "";
    const failures = parseTestOutput(output, runner);

    return { output, failures };
  }
}

/**
 * Compare baseline and current failures to find NEW failures
 */
function findNewFailures(baseline: TestFailure[], current: TestFailure[]): TestFailure[] {
  const newFailures: TestFailure[] = [];

  // Create a set of baseline failure keys for fast lookup
  const baselineKeys = new Set(baseline.map((f) => `${f.testFile}::${f.testName}`));

  // Find current failures that don't exist in baseline
  for (const failure of current) {
    const key = `${failure.testFile}::${failure.testName}`;
    if (!baselineKeys.has(key)) {
      newFailures.push(failure);
    }
  }

  return newFailures;
}

/**
 * Format test failures for display
 */
export function formatTestFailures(failures: TestFailure[]): string {
  if (failures.length === 0) {
    return "No test failures found.";
  }

  const failuresByFile = new Map<string, TestFailure[]>();

  for (const failure of failures) {
    const existing = failuresByFile.get(failure.testFile) || [];
    existing.push(failure);
    failuresByFile.set(failure.testFile, existing);
  }

  const lines: string[] = [];
  lines.push(`Found ${failures.length} test failure(s) in ${failuresByFile.size} file(s):\n`);

  for (const [file, fileFailures] of failuresByFile.entries()) {
    lines.push(`${file}:`);

    for (const failure of fileFailures) {
      lines.push(`  ● ${failure.testName}`);
      lines.push(`    ${failure.error}`);

      if (failure.stackTrace) {
        const stackLines = failure.stackTrace.split("\n").slice(0, 3); // First 3 lines
        for (const stackLine of stackLines) {
          lines.push(`      at ${stackLine}`);
        }
      }

      lines.push(""); // Blank line between tests
    }
  }

  return lines.join("\n");
}

/**
 * Run test repair loop
 *
 * Follows Aider pattern:
 * 1. Run baseline tests (if configured and not provided)
 * 2. Run tests after mutations
 * 3. Compare: only repair NEW failures
 * 4. Feed failures to model for fixes
 * 5. Retry with max iterations
 */
export async function runTestRepair(options: RunTestRepairOptions): Promise<TestResult> {
  const {
    config,
    projectRoot,
    eventEngine,
    taskId,
    baselineFailures: providedBaseline,
    execFn,
  } = options;

  const effectiveTaskId = taskId || randomUUID();
  const startedAt = new Date().toISOString();

  // Emit started event
  if (eventEngine) {
    await eventEngine.emit(
      buildRuntimeEvent({
        kind: "run.repair.test.started",
        taskId: effectiveTaskId,
        payload: {
          maxRetries: config.maxRetries,
          runBeforeMutations: config.runBeforeMutations,
          baselineProvided: !!providedBaseline,
        },
      }),
    );
  }

  const iteration = 0;
  let baselineFailures: TestFailure[] | undefined = providedBaseline;
  let currentFailures: TestFailure[] = [];

  try {
    // Step 1: Run baseline tests (if configured and not provided)
    if (config.runBeforeMutations && !providedBaseline) {
      const baselineResult = runTests(config.command, projectRoot, config.runner, execFn);
      baselineFailures = baselineResult.failures;
    }

    // Step 2: Run tests after mutations
    const testResult = runTests(config.command, projectRoot, config.runner, execFn);
    currentFailures = testResult.failures;

    // Step 3: Determine new failures
    const newFailures = baselineFailures
      ? findNewFailures(baselineFailures, currentFailures)
      : currentFailures;

    // If no new failures, we're done
    if (newFailures.length === 0) {
      const result: TestResult = {
        success: true,
        failures: currentFailures,
        baselineFailures,
        newFailures: [],
        iteration: 0,
      };

      await emitCompletedEvent(eventEngine, effectiveTaskId, result, startedAt);
      return result;
    }

    // Return failures for model to fix
    // Note: The actual retry loop with model fixes happens in agent-loop.ts
    // This function just detects and reports NEW failures
    const result: TestResult = {
      success: false,
      failures: currentFailures,
      baselineFailures,
      newFailures,
      iteration,
    };

    await emitCompletedEvent(eventEngine, effectiveTaskId, result, startedAt);
    return result;
  } catch (error: any) {
    // Emit failed completion event
    const result: TestResult = {
      success: false,
      failures: currentFailures,
      baselineFailures,
      newFailures: currentFailures,
      iteration,
    };

    await emitCompletedEvent(eventEngine, effectiveTaskId, result, startedAt, error);
    return result;
  }
}

async function emitCompletedEvent(
  eventEngine: EventEngine | undefined,
  taskId: string,
  result: TestResult,
  startedAt: string,
  error?: Error,
): Promise<void> {
  if (!eventEngine) return;

  const completedAt = new Date().toISOString();
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  await eventEngine.emit(
    buildRuntimeEvent({
      kind: "run.repair.test.completed",
      taskId,
      payload: {
        success: result.success,
        totalFailures: result.failures.length,
        baselineFailures: result.baselineFailures?.length || 0,
        newFailures: result.newFailures.length,
        iteration: result.iteration,
        durationMs,
        error: error?.message,
      },
    }),
  );
}
