import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "../npm-runner.mjs";
import {
  buildReadinessArtifact,
  mergeGateSources,
  readExternalGateEvidence,
  readPersistedGateEvidence,
  readQuickstartProofEvidence,
  readReleaseDoctorEvidence,
  resolveCommitSha,
  writeQuickstartProofReceipt,
  writeReadinessArtifact,
} from "./readiness-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const commitSha = resolveCommitSha(repoRoot, process.env);
const readmePath = resolve(repoRoot, "README.md");
const dryRun = process.argv.slice(2).includes("--dry");

function parseQuickStartCommands(readmeText) {
  const match = readmeText.match(/## Quick Start\s+```bash\s+([\s\S]*?)```/i);
  if (!match) {
    return [];
  }

  return match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runNpmScript(scriptName) {
  const result = spawnNpm(["run", scriptName], repoRoot);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  return {
    passed: result.status === 0,
    detail:
      result.status === 0
        ? output.split(/\r?\n/).slice(-2).join(" ")
        : output || `exit ${result.status}`,
  };
}

function createStep(name, status, detail, command = null) {
  return {
    name,
    status,
    detail,
    command,
  };
}

const readmeText = readFileSync(readmePath, "utf8");
const quickstartCommands = parseQuickStartCommands(readmeText);
const steps = [];
const blockers = [];
const actions = [];

if (
  quickstartCommands.length >= 3 &&
  quickstartCommands[0] === "npm install -g @dantecode/cli" &&
  quickstartCommands[1].includes("API_KEY") &&
  quickstartCommands[2].startsWith('dantecode "')
) {
  steps.push(
    createStep(
      "README quickstart block",
      "pass",
      `Parsed ${quickstartCommands.length} quickstart command(s) from README.md.`,
    ),
  );
} else {
  const detail =
    quickstartCommands.length > 0
      ? `Unexpected README quickstart commands: ${quickstartCommands.join(" | ")}`
      : "Could not find the Quick Start bash block in README.md.";
  steps.push(createStep("README quickstart block", "fail", detail));
  blockers.push(detail);
}

if (dryRun) {
  steps.push(
    createStep("CLI smoke", "unknown", "Dry run: CLI smoke not executed.", "npm run smoke:cli"),
  );
  steps.push(
    createStep(
      "Install smoke",
      "unknown",
      "Dry run: install smoke not executed.",
      "npm run smoke:install",
    ),
  );
  steps.push(
    createStep(
      "Skill import smoke",
      "unknown",
      "Dry run: skill import smoke not executed.",
      "npm run smoke:skill-import",
    ),
  );
  actions.push(
    "Run npm run release:prove-quickstart without --dry to execute the quickstart proof commands.",
  );
} else {
  for (const [label, scriptName, blockerMessage] of [
    ["CLI smoke", "smoke:cli", "CLI smoke failed."],
    ["Install smoke", "smoke:install", "Install smoke failed."],
    ["Skill import smoke", "smoke:skill-import", "Skill import smoke failed."],
  ]) {
    const result = runNpmScript(scriptName);
    steps.push(
      createStep(label, result.passed ? "pass" : "fail", result.detail, `npm run ${scriptName}`),
    );
    if (!result.passed) {
      blockers.push(blockerMessage);
    }
  }
}

const externalEvidence = readExternalGateEvidence(repoRoot, { currentCommitSha: commitSha });
const liveProviderReceipt = externalEvidence.receipts.liveProvider;
if (liveProviderReceipt?.status === "pass") {
  steps.push(
    createStep(
      "Live provider receipt",
      "pass",
      `Same-commit provider receipt passed at ${liveProviderReceipt.generatedAt}.`,
      "npm run release:gate:live-provider",
    ),
  );
} else if (liveProviderReceipt?.status === "fail") {
  const detail = "Same-commit provider receipt recorded a failed live provider gate.";
  steps.push(
    createStep("Live provider receipt", "fail", detail, "npm run release:gate:live-provider"),
  );
  blockers.push(detail);
} else {
  const detail =
    "Same-commit live provider receipt is missing or unknown. Generate it with real credentials.";
  steps.push(
    createStep("Live provider receipt", "unknown", detail, "npm run release:gate:live-provider"),
  );
  actions.push(detail);
}

const receipt = writeQuickstartProofReceipt(repoRoot, {
  source: "quickstart-proof",
  commitSha,
  generatedAt: new Date().toISOString(),
  readmeQuickstart: {
    sourcePath: readmePath,
    commands: quickstartCommands,
  },
  summary: {
    canClaimQuickstart: blockers.length === 0 && actions.length === 0,
    blockerCount: blockers.length,
    actionCount: actions.length,
    blockers,
    actions,
  },
  steps,
});

const persistedEvidence = readPersistedGateEvidence(repoRoot, { currentCommitSha: commitSha });
const releaseDoctorEvidence = readReleaseDoctorEvidence(repoRoot, { currentCommitSha: commitSha });
const quickstartEvidence = readQuickstartProofEvidence(repoRoot, { currentCommitSha: commitSha });
const readinessArtifact = buildReadinessArtifact({
  commitSha,
  gates: mergeGateSources(externalEvidence.gates, persistedEvidence.gates),
  releaseDoctorReceipt: releaseDoctorEvidence.receipt,
  quickstartProofReceipt: quickstartEvidence.receipt,
  generatedAt: new Date().toISOString(),
  unknownMessage:
    "Some gates are still unknown for the current commit. Run the remaining external checks or CI jobs to resolve them.",
});
const readinessPaths = writeReadinessArtifact(repoRoot, readinessArtifact);

console.log("DanteCode Quickstart Proof");
console.log("=========================");
console.log(`Commit: ${commitSha.slice(0, 12)}`);
console.log(`Status: ${receipt.artifact.status}`);
console.log(`Claimable: ${receipt.artifact.summary.canClaimQuickstart}`);
console.log(`Receipt: ${receipt.filePath}`);
console.log(`Markdown: ${receipt.mdPath}`);
console.log(`Readiness: ${readinessPaths.jsonPath}`);

for (const step of steps) {
  console.log(`- [${step.status}] ${step.name}: ${step.detail}`);
}

if (!dryRun && blockers.length > 0) {
  process.exitCode = 1;
}
