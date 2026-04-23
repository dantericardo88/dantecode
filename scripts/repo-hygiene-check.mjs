import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const ignoredSentinels = [
  ".claude/worktrees/example",
  "benchmarks/swe-bench/.swe-bench-workspace/example",
  ".danteforge/oss-repos/example",
  ".danteforge/STATE.yaml",
  ".danteforge/CURRENT_STATE.md",
  "repo/example",
  "screenshot-to-code/example",
  "twinny/example",
  "void/example",
];

const trackedBoundaryRoots = [
  ".claude/worktrees",
  "benchmarks/swe-bench/.swe-bench-workspace",
  ".danteforge/oss-repos",
  ".danteforge/OSS_REPORT.md",
  "repo",
];

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
}

let hasFailure = false;

console.log("Repo Hygiene Check");
console.log("==================");

for (const sentinel of ignoredSentinels) {
  const result = run("git", ["check-ignore", "-q", sentinel]);
  if (result.status === 0) {
    console.log(`[PASS] ignored: ${sentinel}`);
  } else {
    hasFailure = true;
    console.log(`[FAIL] not ignored: ${sentinel}`);
  }
}

const trackedResult = run("git", ["ls-files", ...trackedBoundaryRoots]);
const trackedEntries = (trackedResult.stdout ?? "")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);

if (trackedEntries.length === 0) {
  console.log("[PASS] no tracked local-only boundary paths remain");
} else {
  hasFailure = true;
  console.log("[FAIL] tracked local-only boundary paths detected:");
  for (const entry of trackedEntries) {
    console.log(`  - ${entry}`);
  }
}

if (hasFailure) {
  console.log("\nNext steps:");
  console.log("1. Update .gitignore for missing local-only paths.");
  console.log("2. Remove tracked local-only paths from the index with `git rm --cached`.");
  process.exit(1);
}

console.log("\nRepo hygiene boundary looks good.");
