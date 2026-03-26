import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifacts = [
  {
    label: "release-doctor",
    path: resolve(repoRoot, "artifacts/readiness/release-doctor.json"),
  },
  {
    label: "quickstart-proof",
    path: resolve(repoRoot, "artifacts/readiness/quickstart-proof.json"),
  },
  {
    label: "current-readiness",
    path: resolve(repoRoot, "artifacts/readiness/current-readiness.json"),
  },
];

function getGitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readArtifactCommitSha(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Expected readiness artifact was not generated: ${filePath}`);
  }

  const artifact = JSON.parse(readFileSync(filePath, "utf8"));
  return String(artifact.commitSha ?? "").trim();
}

function main() {
  const gitHead = getGitHead();

  runNodeScript(resolve(repoRoot, "scripts/release-doctor.mjs"));
  runNodeScript(resolve(repoRoot, "scripts/release/verify-quickstart.mjs"), [
    ...(process.env.DANTECODE_RELEASE_SYNC_DRY === "1" ? ["--dry"] : []),
  ]);
  runNodeScript(resolve(repoRoot, "scripts/release/generate-readiness.mjs"));

  const mismatches = artifacts
    .map((artifact) => ({
      ...artifact,
      commitSha: readArtifactCommitSha(artifact.path),
    }))
    .filter((artifact) => artifact.commitSha !== gitHead);

  if (mismatches.length > 0) {
    const mismatchSummary = mismatches
      .map(
        (artifact) =>
          `${artifact.label} recorded ${artifact.commitSha || "unknown"} instead of git HEAD ${gitHead}`,
      )
      .join("\n");
    throw new Error(`Generated readiness proof does not match git HEAD.\n${mismatchSummary}`);
  }

  console.log(`release:sync verified same-commit readiness for git HEAD ${gitHead.slice(0, 12)}.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
