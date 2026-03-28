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
  writeExternalGateReceipt,
  writeReadinessArtifact,
} from "./readiness-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const GATE_RUNNERS = {
  windowsSmoke: {
    label: "Windows smoke",
    npmArgs: ["run", "smoke:external"],
    canSkip: () => process.platform !== "win32",
    skipDetail: "windowsSmoke is only proven when run on Windows.",
  },
  liveProvider: {
    label: "Live provider smoke",
    npmArgs: ["run", "smoke:provider", "--", "--require-provider"],
    canSkip: () =>
      ![
        process.env.GROK_API_KEY,
        process.env.XAI_API_KEY,
        process.env.ANTHROPIC_API_KEY,
        process.env.OPENAI_API_KEY,
      ].some(Boolean),
    skipDetail:
      "No supported provider credentials detected. Set GROK_API_KEY, XAI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY.",
  },
  publishDryRun: {
    label: "Publish dry-run",
    npmArgs: ["run", "publish:dry-run"],
    canSkip: () => false,
    skipDetail: "",
  },
};

function usage() {
  console.log(
    "Usage: node scripts/release/run-external-gate.mjs <windowsSmoke|liveProvider|publishDryRun> [--dry]",
  );
  console.log(
    "  --dry  Check pre-conditions only (credentials, platform) without running the gate.",
  );
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const gateName = args.find((a) => !a.startsWith("--"));

if (!gateName || !(gateName in GATE_RUNNERS)) {
  usage();
  process.exitCode = 1;
  process.exit();
}

const gateRunner = GATE_RUNNERS[gateName];
const commitSha = resolveCommitSha(repoRoot, process.env);
const generatedAt = new Date().toISOString();
const command = `npm ${gateRunner.npmArgs.join(" ")}`;

let status = "unknown";
let detail = gateRunner.skipDetail;

if (dryRun) {
  // Dry-run: validate pre-conditions without executing the gate command.
  const wouldSkip = gateRunner.canSkip();
  if (wouldSkip) {
    console.log(`\n${gateRunner.label} (dry-run): pre-conditions NOT met — gate would be skipped`);
    console.log(`Reason: ${gateRunner.skipDetail}`);
  } else {
    console.log(`\n${gateRunner.label} (dry-run): pre-conditions satisfied — ready to run`);
    console.log(`Command: ${command}`);
    console.log(`Run without --dry to execute and record the gate result.`);
  }
  process.exit(0);
} else if (!gateRunner.canSkip()) {
  const result = spawnNpm(gateRunner.npmArgs, repoRoot);
  const combinedOutput = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();

  if (result.error) {
    status = "fail";
    detail = result.error.message;
  } else {
    status = result.status === 0 ? "pass" : "fail";
    detail = combinedOutput || `Command exited with status ${result.status ?? "unknown"}.`;
  }

  if (combinedOutput) {
    process.stdout.write(`${combinedOutput}\n`);
  }
}

const receipt = writeExternalGateReceipt(repoRoot, {
  gateName,
  status,
  source: "external-gate-runner",
  command,
  detail,
  commitSha,
  generatedAt,
});

const externalEvidence = readExternalGateEvidence(repoRoot, { currentCommitSha: commitSha });
const persistedEvidence = readPersistedGateEvidence(repoRoot, { currentCommitSha: commitSha });
const releaseDoctorEvidence = readReleaseDoctorEvidence(repoRoot, { currentCommitSha: commitSha });
const quickstartProofEvidence = readQuickstartProofEvidence(repoRoot, {
  currentCommitSha: commitSha,
});
const artifact = buildReadinessArtifact({
  commitSha,
  gates: mergeGateSources(externalEvidence.gates, persistedEvidence.gates),
  releaseDoctorReceipt: releaseDoctorEvidence.receipt,
  quickstartProofReceipt: quickstartProofEvidence.receipt,
  generatedAt,
  unknownMessage:
    "Some gates are still unknown for the current commit. Run the remaining external checks or CI jobs to resolve them.",
});
const outputPaths = writeReadinessArtifact(repoRoot, artifact);

console.log(`\n${gateRunner.label}: ${status}`);
console.log(`Receipt: ${receipt.filePath}`);
console.log(`Readiness: ${outputPaths.jsonPath}`);

if (status === "fail") {
  process.exitCode = 1;
}
