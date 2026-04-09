// ============================================================================
// @dantecode/cli — /benchmark swe-bench command
//
// Subcommands:
//   benchmark swe-bench [--instances N] [--parallel N] [--local] [--output PATH]
//   benchmark report [--input PATH]
//
// The agentFn bridge:
//   1. Clones each instance repo into an isolated temp dir
//   2. Initialises .dantecode/STATE.yaml via readOrInitializeState()
//   3. Builds a minimal fresh Session (never spreads the REPL session)
//   4. Runs runAgentLoop non-interactively with executionProfile="benchmark"
//   5. Collects `git diff HEAD` as the patch
//
// Pattern source: packages/cli/src/commands/stress-test.ts buildHeadlessAgentRunner()
// ============================================================================

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Arg parsing helpers
// ---------------------------------------------------------------------------

function parseIntArg(parts: string[], flag: string): number | undefined {
  const idx = parts.indexOf(flag);
  if (idx === -1 || !parts[idx + 1]) return undefined;
  const n = parseInt(parts[idx + 1] ?? "", 10);
  return isNaN(n) ? undefined : n;
}

function parseStringArg(parts: string[], flag: string): string | undefined {
  const idx = parts.indexOf(flag);
  if (idx === -1 || !parts[idx + 1]) return undefined;
  return parts[idx + 1];
}

function formatDuration(ms: number): string {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const remainder = secs % 60;
  return mins > 0 ? `${mins}m ${remainder}s` : `${secs}s`;
}

// ---------------------------------------------------------------------------
// swe-bench subcommand
// ---------------------------------------------------------------------------

async function runSweBenchSubcommand(
  args: string,
  projectRoot: string,
): Promise<string> {
  const { runSWEBenchHarness } = await import("@dantecode/swe-bench");
  const { runAgentLoop } = await import("../agent-loop.js");
  const { readOrInitializeState } = await import("@dantecode/core");

  const parts = args.trim().split(/\s+/).filter(Boolean);
  const maxInstances = parseIntArg(parts, "--instances") ?? 5;
  const parallel = parseIntArg(parts, "--parallel") ?? 1;
  const useDocker = !parts.includes("--local");
  const outputFile = parseStringArg(parts, "--output");

  const cacheDir = join(projectRoot, ".dantecode", "swe-bench-cache");

  process.stdout.write(
    `[benchmark] Running SWE-bench (${maxInstances} instances, ${useDocker ? "Docker" : "local"})...\n`,
  );

  const result = await runSWEBenchHarness({
    maxInstances,
    parallel,
    useDocker,
    datasetOptions: { cacheDir },
    agentFn: async (problem: string, repo: string): Promise<string> => {
      // Normalize repo slug to full GitHub URL (e.g. "astropy/astropy" → "https://github.com/astropy/astropy.git")
      const repoUrl = repo.includes("://") ? repo : `https://github.com/${repo}.git`;
      const workDir = mkdtempSync(join(tmpdir(), "dc-bench-"));
      try {
        // 1. Clone the repo at HEAD
        execFileSync("git", ["clone", repoUrl, ".", "--depth=1", "--quiet"], {
          cwd: workDir,
          stdio: "pipe",
        });

        // 2. Initialise .dantecode/STATE.yaml — creates it if missing, reads it if present
        const benchState = await readOrInitializeState(workDir);

        // 3. Build a minimal FRESH session — never spread the REPL session
        //    (spreading carries wrong activeFiles, stale agentStack, old timestamps)
        //
        //    Override model to use whichever provider has an API key available.
        //    STATE.yaml may default to Grok — benchmark needs to work in any env.
        const availableModel = (() => {
          if (process.env["ANTHROPIC_API_KEY"]) {
            return {
              provider: "anthropic" as const,
              modelId: "claude-sonnet-4-6",
              maxTokens: 8192,
              temperature: 0.1,
              contextWindow: 200000,
              supportsVision: true,
              supportsToolCalls: true,
            };
          }
          if (process.env["OPENAI_API_KEY"]) {
            return {
              provider: "openai" as const,
              modelId: "gpt-4o",
              maxTokens: 8192,
              temperature: 0.1,
              contextWindow: 128000,
              supportsVision: true,
              supportsToolCalls: true,
            };
          }
          // Fall back to whatever STATE.yaml says — may fail if key not set
          return benchState.model.default;
        })();

        const now = new Date().toISOString();
        const benchSession = {
          id: `bench-${Date.now()}-${randomUUID().slice(0, 8)}`,
          projectRoot: workDir,
          messages: [] as import("@dantecode/config-types").SessionMessage[],
          activeFiles: [] as string[],
          readOnlyFiles: [] as string[],
          model: availableModel,
          createdAt: now,
          updatedAt: now,
          agentStack: [] as import("@dantecode/config-types").AgentFrame[],
          todoList: [] as import("@dantecode/config-types").TodoItem[],
        };

        // 4. Run the agent non-interactively
        await runAgentLoop(problem, benchSession, {
          state: benchState,
          verbose: false,
          enableGit: true,           // needed so git diff HEAD captures changes
          enableSandbox: false,
          silent: true,
          postEditLint: false,       // skip lint loop — not relevant for eval
          executionProfile: "benchmark",
          requiredRounds: 10,
        });

        // 5. Return the unified diff as the patch
        return execSync("git diff HEAD", {
          cwd: workDir,
          encoding: "utf-8",
        });
      } catch {
        return ""; // empty patch = this instance failed — not a crash
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    },
  });

  const rate = (result.score.resolvedRate * 100).toFixed(1);
  const lines = [
    "",
    `[benchmark] Score: ${result.score.resolved}/${result.score.total} resolved (${rate}%)`,
    `[benchmark] Duration: ${formatDuration(result.durationMs)}`,
    `[benchmark] Errors: ${result.score.errors}`,
  ];

  if (outputFile) {
    const outPath =
      outputFile.startsWith("/") || outputFile.startsWith(".")
        ? outputFile
        : join(projectRoot, outputFile);
    await writeFile(outPath, JSON.stringify(result, null, 2), "utf-8");
    lines.push(`[benchmark] Results written to ${outPath}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// report subcommand — reads an existing results JSON and prints a summary
// ---------------------------------------------------------------------------

async function runBenchmarkReportCommand(
  args: string,
  projectRoot: string,
): Promise<string> {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const inputFile = parseStringArg(parts, "--input");

  if (inputFile) {
    const inputPath =
      inputFile.startsWith("/") || inputFile.startsWith(".")
        ? inputFile
        : join(projectRoot, inputFile);

    if (!existsSync(inputPath)) {
      return `[benchmark] File not found: ${inputPath}`;
    }

    try {
      const raw = await readFile(inputPath, "utf-8");
      return formatResultJson(raw);
    } catch (e) {
      return `[benchmark] Failed to read report: ${String(e)}`;
    }
  }

  // Find most recent results file under .dantecode/benchmark-results/
  const resultsDir = join(projectRoot, ".dantecode", "benchmark-results");
  if (!existsSync(resultsDir)) {
    return "[benchmark] No benchmark results found. Run: /benchmark swe-bench";
  }

  try {
    const entries = await readdir(resultsDir);
    const jsonFiles = entries
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    if (jsonFiles.length === 0) {
      return "[benchmark] No result files found. Run: /benchmark swe-bench";
    }
    const raw = await readFile(join(resultsDir, jsonFiles[0] ?? ""), "utf-8");
    return formatResultJson(raw);
  } catch (e) {
    return `[benchmark] Error reading reports: ${String(e)}`;
  }
}

function formatResultJson(raw: string): string {
  try {
    const data = JSON.parse(raw) as {
      score?: {
        resolved?: number;
        total?: number;
        resolvedRate?: number;
        errors?: number;
      };
      durationMs?: number;
      instanceResults?: Array<{ instanceId: string; status: string }>;
    };
    const score = data.score;
    if (!score) return raw;

    const rate = ((score.resolvedRate ?? 0) * 100).toFixed(1);
    const lines = [
      `[benchmark] Score: ${score.resolved ?? 0}/${score.total ?? 0} resolved (${rate}%)`,
      `[benchmark] Errors: ${score.errors ?? 0}`,
    ];
    if (data.durationMs) {
      lines.push(`[benchmark] Duration: ${formatDuration(data.durationMs)}`);
    }
    if (data.instanceResults?.length) {
      lines.push("", "[benchmark] Instance breakdown:");
      for (const ir of data.instanceResults) {
        lines.push(`  ${ir.instanceId}: ${ir.status}`);
      }
    }
    return lines.join("\n");
  } catch {
    return raw;
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export async function benchmarkCommand(
  args: string,
  projectRoot: string,
): Promise<string> {
  const trimmed = args.trim();

  if (trimmed.startsWith("swe-bench")) {
    return runSweBenchSubcommand(
      trimmed.slice("swe-bench".length).trim(),
      projectRoot,
    );
  }

  if (trimmed.startsWith("report")) {
    return runBenchmarkReportCommand(
      trimmed.slice("report".length).trim(),
      projectRoot,
    );
  }

  return [
    "[benchmark] Usage:",
    "  /benchmark swe-bench [--instances N] [--parallel N] [--local] [--output PATH]",
    "  /benchmark report [--input PATH]",
    "",
    "Run /benchmark swe-bench to evaluate DanteCode against SWE-bench Verified.",
    "Add --local to skip Docker (uses local Python environment).",
    "Add --instances N to limit how many instances to run (default: 5).",
    "Add --output PATH to save the full JSON results.",
  ].join("\n");
}
