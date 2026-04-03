import { spawnSync } from "node:child_process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const pythonCmd = process.platform === "win32" ? "python" : (process.env.PYTHON ?? "python3");

function quoteWindowsArg(arg) {
  if (!/[\s"]/u.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function runStep(label, command, args) {
  console.log(`\n[benchmark-readiness] ${label}`);
  const result =
    process.platform === "win32" && command.toLowerCase().endsWith(".cmd")
      ? spawnSync(
          process.env.ComSpec ?? "cmd.exe",
          ["/d", "/s", "/c", [command, ...args].map(quoteWindowsArg).join(" ")],
          {
            stdio: "inherit",
            shell: false,
          },
        )
      : spawnSync(command, args, {
          stdio: "inherit",
          shell: false,
        });

  if (result.status !== 0) {
    if (result.error) {
      console.error(`[benchmark-readiness] spawn failed: ${result.error.message}`);
    }
    process.exit(result.status ?? 1);
  }
}

runStep("root build", npmCmd, ["run", "build"]);
runStep("root typecheck", npmCmd, ["run", "typecheck"]);
runStep("execution-quality gate", npmCmd, ["run", "check:execution-quality"]);
runStep("swe-bench smoke", pythonCmd, ["benchmarks/swe-bench/test_runner_smoke.py"]);
runStep("swe-bench dry-run coverage", pythonCmd, ["benchmarks/swe-bench/test_runner_dry_run.py"]);
runStep("swe-bench dry-run", pythonCmd, [
  "benchmarks/swe-bench/swe_bench_runner.py",
  "--dry-run",
  "--limit",
  "1",
  "--dantecode",
  "node packages/cli/dist/index.js",
  "--execution-profile",
  "benchmark",
]);

console.log("\n[benchmark-readiness] PASS");
