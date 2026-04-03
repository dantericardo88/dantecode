import { spawnSync } from "node:child_process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";

function quoteWindowsArg(arg) {
  if (!/[\s"]/u.test(arg)) {
    return arg;
  }

  return `"${arg.replace(/(\\*)"/g, "$1$1\\\"").replace(/(\\+)$/g, "$1$1")}"`;
}

function runStep(label, command, args) {
  console.log(`\n[execution-quality] ${label}`);
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
      console.error(`[execution-quality] spawn failed: ${result.error.message}`);
    }
    process.exit(result.status ?? 1);
  }
}

// Build prep only: package export consumers rely on dist for config-types/core.
runStep("build config-types (prep)", npmCmd, ["run", "build", "--workspace=packages/config-types"]);
runStep("build core (prep)", npmCmd, ["run", "build", "--workspace=packages/core"]);

// Actual proof gates start here.
runStep("typecheck core", npmCmd, ["run", "typecheck", "--workspace=packages/core"]);
runStep("typecheck cli", npmCmd, ["run", "typecheck", "--workspace=packages/cli"]);
runStep("typecheck vscode", npmCmd, ["run", "typecheck", "--workspace=packages/vscode"]);

runStep("shared engine tests", npxCmd, [
  "vitest",
  "run",
  "--run",
  "packages/core/src/execution-policy.test.ts",
]);
runStep("cli hot-path tests", npxCmd, [
  "vitest",
  "run",
  "--run",
  "packages/cli/src/agent-loop.test.ts",
  "packages/cli/src/integration-test-retry.test.ts",
  "packages/cli/src/execution-policy-contract.test.ts",
]);
runStep("vscode hot-path tests", npxCmd, [
  "vitest",
  "run",
  "--run",
  "packages/vscode/src/execution-policy-contract.test.ts",
]);

console.log("\n[execution-quality] PASS");
