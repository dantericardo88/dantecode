/**
 * generate-readiness.mjs
 *
 * Rebuilds artifacts/readiness/current-readiness.json from the best available
 * same-commit evidence:
 *   1. Explicit GATE_* CI env vars
 *   2. Local receipts written by scripts/release-check.mjs
 *   3. Existing current-readiness.json for the same commit
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReadinessArtifact,
  mergeGateSources,
  readEnvGates,
  readExternalGateEvidence,
  readPersistedGateEvidence,
  readQuickstartProofEvidence,
  readReleaseDoctorEvidence,
  resolveCommitSha,
  writeReadinessArtifact,
} from "./readiness-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const commitSha = resolveCommitSha(repoRoot, process.env);
const envGates = readEnvGates(process.env);
const externalEvidence = readExternalGateEvidence(repoRoot, { currentCommitSha: commitSha });
const persistedEvidence = readPersistedGateEvidence(repoRoot, { currentCommitSha: commitSha });
const releaseDoctorEvidence = readReleaseDoctorEvidence(repoRoot, { currentCommitSha: commitSha });
const quickstartProofEvidence = readQuickstartProofEvidence(repoRoot, {
  currentCommitSha: commitSha,
});
const gates = mergeGateSources(envGates, externalEvidence.gates, persistedEvidence.gates);
const artifact = buildReadinessArtifact({
  commitSha,
  gates,
  releaseDoctorReceipt: releaseDoctorEvidence.receipt,
  quickstartProofReceipt: quickstartProofEvidence.receipt,
  generatedAt: new Date().toISOString(),
  unknownMessage:
    persistedEvidence.sourcePath || externalEvidence.sourcePaths.length > 0
      ? "Some gates are still unknown for the current commit. Run the remaining external checks or CI jobs to resolve them."
      : "No gate evidence exists for the current commit. Run `npm run release:check` locally or rerun CI with GATE_* env vars set.",
});
const outputPaths = writeReadinessArtifact(repoRoot, artifact);

const STATUS_LABEL = {
  blocked: "\x1b[31mBLOCKED\x1b[0m",
  "local-green-external-pending": "\x1b[33mLOCAL-GREEN / EXTERNAL-PENDING\x1b[0m",
  "private-ready": "\x1b[32mPRIVATE-READY\x1b[0m",
  "public-ready": "\x1b[32mPUBLIC-READY\x1b[0m",
};

console.log(`\nDanteCode Readiness - ${new Date().toISOString()}`);
console.log(`Commit: ${commitSha.slice(0, 12)}`);
console.log(`Status: ${STATUS_LABEL[artifact.status] ?? artifact.status}`);
console.log(
  `Evidence: ${
    [
      persistedEvidence.sourcePath,
      releaseDoctorEvidence.sourcePath,
      quickstartProofEvidence.sourcePath,
      ...externalEvidence.sourcePaths,
    ]
      .filter(Boolean)
      .join(", ") || "env-only / none"
  }\n`,
);

const GATE_ICON = {
  pass: "\x1b[32m+\x1b[0m",
  fail: "\x1b[31mx\x1b[0m",
  unknown: "\x1b[2m?\x1b[0m",
};
for (const [name, value] of Object.entries(artifact.gates)) {
  console.log(`  ${GATE_ICON[value] ?? "?"} ${name.padEnd(14)} ${value}`);
}

if (artifact.blockers.length > 0) {
  console.log("\nBlockers:");
  for (const blocker of artifact.blockers) {
    console.log(`  * ${blocker}`);
  }
}

if (
  Array.isArray(artifact.openRequirements?.publicReady) &&
  artifact.openRequirements.publicReady.length > 0
) {
  console.log("\nOpen requirements (publicReady):");
  for (const requirement of artifact.openRequirements.publicReady) {
    console.log(`  - ${requirement}`);
  }
}

console.log(`\nWritten: ${outputPaths.jsonPath}`);
console.log(`Markdown: ${outputPaths.mdPath}\n`);

if (artifact.status === "blocked") process.exitCode = 1;
