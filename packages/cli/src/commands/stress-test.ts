// ============================================================================
// @dantecode/cli — /stress-test command
//
// Runs DanteCode's built-in SWE-bench TypeScript instances through the VM
// evaluator. Two modes:
//
// Self-validation (default): Uses reference patches — proves the evaluator works.
// Real agent (--real):        Invokes runAgentLoop on each problem — measures
//                             actual agent pass@1.
//
// Usage:
//   /stress-test [--instances N] [--output PATH] [--real]
//   /stress-test --instances 5 --real
//   /stress-test --instances 20
//   /stress-test --instances all
// ============================================================================

import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";

interface StressTestOptions {
  instances: number | "all";
  output?: string;
  real: boolean;
}

function parseArgs(args: string): StressTestOptions {
  const opts: StressTestOptions = { instances: 5, real: false };
  const parts = args.trim().split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "--instances" && parts[i + 1]) {
      const next = parts[i + 1]!;
      opts.instances = next === "all" ? "all" : parseInt(next, 10) || 5;
      i++;
    } else if (part === "--output" && parts[i + 1]) {
      opts.output = parts[i + 1];
      i++;
    } else if (part === "--real" || part === "--agent") {
      opts.real = true;
    }
  }
  return opts;
}

/**
 * Builds a headless agent runner that invokes runAgentLoop in silent/taskMode.
 * Uses readOrInitializeState so it works even in a fresh project directory.
 */
async function buildHeadlessAgentRunner(
  projectRoot: string,
): Promise<(problemStatement: string, instanceId: string) => Promise<string | null>> {
  const { readOrInitializeState } = await import("@dantecode/core");
  const { runAgentLoop } = await import("../agent-loop.js");

  const state = await readOrInitializeState(projectRoot);
  const now = new Date().toISOString();

  return async (problemStatement: string, instanceId: string): Promise<string | null> => {
    const session = {
      id: `stress-${instanceId}-${randomUUID().slice(0, 8)}`,
      projectRoot,
      messages: [] as import("@dantecode/config-types").SessionMessage[],
      activeFiles: [] as string[],
      readOnlyFiles: [] as string[],
      model: state.model.default,
      createdAt: now,
      updatedAt: now,
      agentStack: [] as import("@dantecode/config-types").AgentFrame[],
      todoList: [] as import("@dantecode/config-types").TodoItem[],
    };

    try {
      const result = await runAgentLoop(problemStatement, session, {
        state,
        verbose: false,
        enableGit: false,
        enableSandbox: false,
        silent: true,
        taskMode: "stress-test",
        postEditLint: false,
        executionProfile: "benchmark",
      });
      // Extract the last assistant message as the agent's code output
      const last = [...result.messages].reverse().find((m) => m.role === "assistant");
      if (!last) return null;
      return typeof last.content === "string"
        ? last.content
        : JSON.stringify(last.content);
    } catch {
      return null;
    }
  };
}

interface StressRunResult {
  instanceId: string;
  passed: boolean;
  error?: string;
  durationMs: number;
  evalMode: "vm" | "scaffold";
}

/**
 * The core stress-test runner. Two modes:
 *
 * Self-validation (default): Runs reference patches through the VM evaluator —
 *   proves the evaluation harness is correct.
 *
 * Real agent (--real flag or explicit agentRunner):
 *   Invokes runAgentLoop on each problem statement and measures true pass@1.
 */
export async function runStressTest(
  args: string,
  projectRoot: string,
  agentRunner?: (problemStatement: string, instanceId: string) => Promise<string | null>,
): Promise<string> {
  const opts = parseArgs(args);

  // Build a real agent runner if --real flag is set and no explicit runner provided
  if (opts.real && !agentRunner) {
    try {
      agentRunner = await buildHeadlessAgentRunner(projectRoot);
    } catch (e) {
      return `Error: Could not build headless agent runner — ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  // Dynamic import to avoid circular deps
  const { InstanceLoader } = await import("@dantecode/swe-bench-runner");
  const { runTestPatch } = await import("@dantecode/swe-bench-runner");
  const { ReportGenerator } = await import("@dantecode/swe-bench-runner");

  const loader = new InstanceLoader(join(projectRoot, ".dantecode/swe-bench-cache"));
  const subset = opts.instances === "all" ? undefined : opts.instances;
  const instances = await loader.loadInstances({ subset });

  if (instances.length === 0) {
    return "No instances found. Run with --instances all to load built-in instances.";
  }

  const lines: string[] = [
    `Running stress test on ${instances.length} instance${instances.length !== 1 ? "s" : ""}...`,
    "",
  ];

  const results: StressRunResult[] = [];
  let passCount = 0;

  for (const instance of instances) {
    const start = Date.now();
    let agentOutput: string | null = null;
    let evalMode: "vm" | "scaffold" = "scaffold";

    if (agentRunner) {
      // Real agent mode — run the agent and evaluate its output
      try {
        agentOutput = await agentRunner(instance.problem_statement, instance.instance_id);
      } catch (e) {
        agentOutput = null;
      }
      evalMode = "vm";
    } else {
      // Self-validation mode: use reference patch to validate the evaluator itself
      agentOutput = instance.patch;
      evalMode = "vm";
    }

    let passed = false;
    let error: string | undefined;

    if (agentOutput !== null) {
      try {
        const vmResult = await runTestPatch(agentOutput, instance.test_patch, instance.instance_id);
        passed = vmResult.passed;
        error = vmResult.error;
      } catch (e) {
        passed = false;
        error = e instanceof Error ? e.message : String(e);
      }
    } else {
      error = "scaffold-mode: no agent output";
    }

    const durationMs = Date.now() - start;
    if (passed) passCount++;

    results.push({
      instanceId: instance.instance_id,
      passed,
      error,
      durationMs,
      evalMode,
    });

    const status = passed ? "✓" : "✗";
    const suffix = error && !passed ? ` — ${error.slice(0, 60)}` : "";
    lines.push(`  ${status} ${instance.instance_id} (${durationMs}ms)${suffix}`);
  }

  const passRate = results.length > 0 ? passCount / results.length : 0;
  const passPercent = (passRate * 100).toFixed(1);
  const evalModeStr = agentRunner ? "real agent (runAgentLoop)" : "self-validation (reference patches)";

  lines.push("");
  lines.push("─".repeat(60));
  lines.push(`Results — ${evalModeStr}`);
  lines.push(`  Instances: ${results.length}`);
  lines.push(`  Passed:    ${passCount}/${results.length}`);
  lines.push(`  pass@1:    ${passPercent}%`);
  lines.push("");

  if (!agentRunner) {
    lines.push("Note: Self-validation mode — tests run against reference patches.");
    lines.push("Use 'dantecode stress-test --real' to run the live agent.");
    lines.push("");
  } else {
    lines.push("Real agent mode — results reflect actual agent capabilities.");
    lines.push("");
  }

  // Save report if requested
  const outputPath =
    opts.output ??
    join(
      projectRoot,
      ".dantecode/stress-test-results",
      `stress-test-${Date.now()}.json`,
    );

  // Build EvalReport
  const generator = new ReportGenerator();
  const report = generator.generateReport(
    results.map((r) => ({
      instance_id: r.instanceId,
      resolved: r.passed,
      error: r.error,
      durationMs: r.durationMs,
    })),
    { runId: `stress_${Date.now().toString(36)}` },
  );

  try {
    await mkdir(join(projectRoot, ".dantecode/stress-test-results"), {
      recursive: true,
    });
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
    lines.push(`Report saved: ${outputPath}`);
  } catch {
    // Non-fatal: report generation failure shouldn't break the output
  }

  return lines.join("\n");
}
