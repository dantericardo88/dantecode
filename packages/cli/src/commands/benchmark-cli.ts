// ============================================================================
// @dantecode/cli — standalone benchmark runner
//
// Runs /benchmark swe-bench without requiring an active REPL session.
// Designed for CI, cron jobs, and cold-start measurement.
//
// Usage:
//   node dist/commands/benchmark-cli.js [--instances N] [--parallel N] [--local] [--output PATH]
//   npm run benchmark -- --instances 50 --local --output results.json
// ============================================================================

import { benchmarkCommand } from "./benchmark.js";

const rawArgs = process.argv.slice(2);
const projectRoot = process.cwd();

// If first arg looks like a subcommand (swe-bench / report), pass through as-is.
// Otherwise default to "swe-bench" so bare invocation runs the benchmark.
const subcommand =
  rawArgs[0] === "report" ? "report" : "swe-bench";

const flagArgs = subcommand === "swe-bench" && rawArgs[0] !== "swe-bench"
  ? rawArgs.join(" ")         // bare flags: --instances 5 --local
  : rawArgs.slice(1).join(" "); // explicit subcommand: swe-bench --instances 5

const fullArgs = `${subcommand} ${flagArgs}`.trim();

try {
  const result = await benchmarkCommand(fullArgs, projectRoot);
  process.stdout.write(result + "\n");
  process.exit(0);
} catch (err) {
  process.stderr.write(`[benchmark] Fatal error: ${String(err)}\n`);
  process.exit(1);
}
