import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const READINESS_GATE_NAMES = [
  "typecheck",
  "lint",
  "test",
  "build",
  "windowsSmoke",
  "antiStub",
  "liveProvider",
  "publishDryRun",
];

export const LOCAL_GATE_NAMES = ["typecheck", "lint", "test", "build", "antiStub"];
export const EXTERNAL_GATE_NAMES = ["windowsSmoke", "liveProvider", "publishDryRun"];
export const EXTERNAL_GATE_RECEIPT_FILES = {
  windowsSmoke: "windows-smoke.json",
  liveProvider: "live-provider.json",
  publishDryRun: "publish-dry-run.json",
};
export const RELEASE_DOCTOR_RECEIPT_FILE = "release-doctor.json";
export const QUICKSTART_PROOF_RECEIPT_FILE = "quickstart-proof.json";

const ENV_GATE_MAP = {
  typecheck: "GATE_TYPECHECK",
  lint: "GATE_LINT",
  test: "GATE_TEST",
  build: "GATE_BUILD",
  windowsSmoke: "GATE_WINDOWS_SMOKE",
  antiStub: "GATE_ANTI_STUB",
  liveProvider: "GATE_LIVE_PROVIDER",
  publishDryRun: "GATE_PUBLISH_DRY_RUN",
};

const RELEASE_CHECK_GATE_MAP = {
  "Build (turbo)": "build",
  "Tests (turbo)": "test",
  "Typecheck (turbo)": "typecheck",
  "Anti-stub scan": "antiStub",
  "Lint (turbo)": "lint",
};

export function normalizeGateStatus(value) {
  if (value === "pass" || value === "fail") {
    return value;
  }

  return "unknown";
}

export function createGateRecord(seed = {}) {
  const gates = {};

  for (const gateName of READINESS_GATE_NAMES) {
    gates[gateName] = normalizeGateStatus(seed[gateName]);
  }

  return gates;
}

export function readEnvGates(env = process.env) {
  const gates = {};

  for (const [gateName, envVar] of Object.entries(ENV_GATE_MAP)) {
    gates[gateName] = normalizeGateStatus(env[envVar]);
  }

  return createGateRecord(gates);
}

export function mapReleaseCheckResultsToGates(results) {
  const gates = createGateRecord();

  for (const result of results) {
    const gateName = RELEASE_CHECK_GATE_MAP[result.name];
    if (!gateName) {
      continue;
    }

    gates[gateName] = result.passed ? "pass" : "fail";
  }

  return gates;
}

export function mergeGateSources(...sources) {
  const merged = createGateRecord();

  for (const gateName of READINESS_GATE_NAMES) {
    for (const source of sources) {
      const value = normalizeGateStatus(source?.[gateName]);
      if (value === "unknown") {
        continue;
      }

      merged[gateName] = value;
      break;
    }
  }

  return merged;
}

function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function resolveCommitSha(repoRoot, env = process.env) {
  let commitSha = env.GITHUB_SHA ?? "unknown";

  if (commitSha !== "unknown") {
    return commitSha;
  }

  try {
    commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    commitSha = "unknown";
  }

  return commitSha;
}

export function readPersistedGateEvidence(repoRoot, options = {}) {
  const currentCommitSha = options.currentCommitSha ?? "unknown";
  const evidencePaths = [
    resolve(repoRoot, "artifacts/readiness/local-gates.json"),
    resolve(repoRoot, "artifacts/readiness/current-readiness.json"),
  ];

  for (const filePath of evidencePaths) {
    const evidence = readJsonIfExists(filePath);
    if (!evidence?.gates) {
      continue;
    }

    const evidenceCommitSha = String(evidence.commitSha ?? "").trim();
    const hasCurrentCommit = currentCommitSha && currentCommitSha !== "unknown";
    if (hasCurrentCommit && evidenceCommitSha && evidenceCommitSha !== currentCommitSha) {
      continue;
    }

    return {
      commitSha: evidenceCommitSha || null,
      sourcePath: filePath,
      gates: createGateRecord(evidence.gates),
    };
  }

  return {
    commitSha: null,
    sourcePath: null,
    gates: createGateRecord(),
  };
}

export function readExternalGateEvidence(repoRoot, options = {}) {
  const currentCommitSha = options.currentCommitSha ?? "unknown";
  const gates = createGateRecord();
  const sourcePaths = [];
  const receipts = {};

  for (const [gateName, fileName] of Object.entries(EXTERNAL_GATE_RECEIPT_FILES)) {
    const filePath = resolve(repoRoot, "artifacts/readiness/external", fileName);
    const receipt = readJsonIfExists(filePath);
    if (!receipt) {
      continue;
    }

    const evidenceCommitSha = String(receipt.commitSha ?? "").trim();
    const hasCurrentCommit = currentCommitSha && currentCommitSha !== "unknown";
    if (hasCurrentCommit && evidenceCommitSha && evidenceCommitSha !== currentCommitSha) {
      continue;
    }

    const hasRecordedDetail =
      (typeof receipt.detail === "string" && receipt.detail.trim().length > 0) ||
      (Array.isArray(receipt.artifacts) && receipt.artifacts.length > 0);
    if (!hasRecordedDetail) {
      continue;
    }

    gates[gateName] = normalizeGateStatus(receipt.status ?? receipt.gateStatus);
    receipts[gateName] = {
      ...receipt,
      sourcePath: filePath,
    };
    sourcePaths.push(filePath);
  }

  return {
    gates,
    receipts,
    sourcePaths,
  };
}

export function readReleaseDoctorEvidence(repoRoot, options = {}) {
  const currentCommitSha = options.currentCommitSha ?? "unknown";
  const filePath = resolve(repoRoot, "artifacts/readiness", RELEASE_DOCTOR_RECEIPT_FILE);
  const receipt = readJsonIfExists(filePath);
  if (!receipt) {
    return {
      receipt: null,
      sourcePath: null,
    };
  }

  const evidenceCommitSha = String(receipt.commitSha ?? "").trim();
  const hasCurrentCommit = currentCommitSha && currentCommitSha !== "unknown";
  if (hasCurrentCommit && evidenceCommitSha && evidenceCommitSha !== currentCommitSha) {
    return {
      receipt: null,
      sourcePath: null,
    };
  }

  return {
    receipt: {
      ...receipt,
      sourcePath: filePath,
    },
    sourcePath: filePath,
  };
}

export function readQuickstartProofEvidence(repoRoot, options = {}) {
  const currentCommitSha = options.currentCommitSha ?? "unknown";
  const filePath = resolve(repoRoot, "artifacts/readiness", QUICKSTART_PROOF_RECEIPT_FILE);
  const receipt = readJsonIfExists(filePath);
  if (!receipt) {
    return {
      receipt: null,
      sourcePath: null,
    };
  }

  const evidenceCommitSha = String(receipt.commitSha ?? "").trim();
  const hasCurrentCommit = currentCommitSha && currentCommitSha !== "unknown";
  if (hasCurrentCommit && evidenceCommitSha && evidenceCommitSha !== currentCommitSha) {
    return {
      receipt: null,
      sourcePath: null,
    };
  }

  return {
    receipt: {
      ...receipt,
      sourcePath: filePath,
    },
    sourcePath: filePath,
  };
}

function summarizeReleaseDoctor(receipt) {
  if (!receipt) {
    return {
      checked: false,
      canPublish: false,
      blockerCount: 0,
      actionCount: 0,
      readyCount: 0,
      generatedAt: null,
      sourcePath: null,
      blockers: [],
      actions: [],
    };
  }

  const summary = receipt.summary ?? {};
  const hasChecks = Array.isArray(receipt.checks) && receipt.checks.length > 0;
  return {
    checked: true,
    canPublish: hasChecks && Number(summary.blockerCount ?? 0) === 0,
    blockerCount: Number(summary.blockerCount ?? 0),
    actionCount: Number(summary.actionCount ?? 0),
    readyCount: Number(summary.readyCount ?? 0),
    generatedAt: receipt.generatedAt ?? null,
    sourcePath: receipt.sourcePath ?? null,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    actions: Array.isArray(summary.actions) ? summary.actions : [],
  };
}

function summarizeQuickstartProof(receipt) {
  if (!receipt) {
    return {
      checked: false,
      canClaimQuickstart: false,
      blockerCount: 0,
      actionCount: 0,
      generatedAt: null,
      sourcePath: null,
      blockers: [],
      actions: [],
      steps: [],
    };
  }

  const summary = receipt.summary ?? {};
  const hasReadmeCommands =
    Array.isArray(receipt.readmeQuickstart?.commands) &&
    receipt.readmeQuickstart.commands.length > 0;
  const hasSteps = Array.isArray(receipt.steps) && receipt.steps.length > 0;
  return {
    checked: true,
    canClaimQuickstart: hasReadmeCommands && hasSteps && Boolean(summary.canClaimQuickstart),
    blockerCount: Number(summary.blockerCount ?? 0),
    actionCount: Number(summary.actionCount ?? 0),
    generatedAt: receipt.generatedAt ?? null,
    sourcePath: receipt.sourcePath ?? null,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    actions: Array.isArray(summary.actions) ? summary.actions : [],
    steps: Array.isArray(receipt.steps) ? receipt.steps : [],
  };
}

export function collectOpenReadinessRequirements(
  gates,
  releaseDoctorReceipt,
  quickstartProofReceipt,
) {
  const requirements = {
    privateReady: [],
    publicReady: [],
  };

  for (const gateName of LOCAL_GATE_NAMES) {
    if (gates[gateName] !== "pass") {
      const message = `Gate "${gateName}" must pass. Current status: ${gates[gateName]}.`;
      requirements.privateReady.push(message);
      requirements.publicReady.push(message);
    }
  }

  for (const gateName of ["windowsSmoke", "publishDryRun"]) {
    if (gates[gateName] !== "pass") {
      const message = `Gate "${gateName}" must pass. Current status: ${gates[gateName]}.`;
      requirements.privateReady.push(message);
      requirements.publicReady.push(message);
    }
  }

  if (gates.liveProvider !== "pass") {
    requirements.publicReady.push(
      `Gate "liveProvider" must pass. Current status: ${gates.liveProvider}.`,
    );
  }

  const releaseDoctor = summarizeReleaseDoctor(releaseDoctorReceipt);
  if (!releaseDoctor.checked) {
    requirements.publicReady.push(
      "Release doctor receipt is missing for the current commit. Run `npm run release:doctor` to validate publish blockers.",
    );
  } else if (!releaseDoctor.canPublish) {
    for (const blocker of releaseDoctor.blockers) {
      requirements.publicReady.push(`Release doctor blocker: ${blocker}`);
    }
  }

  const quickstartProof = summarizeQuickstartProof(quickstartProofReceipt);
  if (!quickstartProof.checked) {
    requirements.publicReady.push(
      "Quickstart proof receipt is missing for the current commit. Run `npm run release:prove-quickstart` to validate the README quickstart path.",
    );
  } else if (!quickstartProof.canClaimQuickstart) {
    for (const blocker of quickstartProof.blockers) {
      requirements.publicReady.push(`Quickstart proof blocker: ${blocker}`);
    }
    if (quickstartProof.blockers.length === 0 && quickstartProof.actions.length === 0) {
      requirements.publicReady.push(
        "Quickstart proof exists for the current commit but does not yet support the public claim. Rerun `npm run release:prove-quickstart` after the remaining prerequisites are satisfied.",
      );
    }
    for (const action of quickstartProof.actions) {
      requirements.publicReady.push(`Quickstart proof action: ${action}`);
    }
  }

  return requirements;
}

export function computeReadinessStatus(gates, options = {}) {
  const blockers = [];
  const openRequirements = collectOpenReadinessRequirements(
    gates,
    options.releaseDoctorReceipt,
    options.quickstartProofReceipt,
  );

  for (const [gateName, value] of Object.entries(gates)) {
    if (value === "fail") {
      blockers.push(`Gate "${gateName}" failed`);
    }
  }

  if (blockers.length > 0) {
    return { status: "blocked", blockers, openRequirements };
  }

  if (
    LOCAL_GATE_NAMES.every((gateName) => gates[gateName] === "pass") &&
    EXTERNAL_GATE_NAMES.every((gateName) => gates[gateName] === "unknown")
  ) {
    return { status: "local-green-external-pending", blockers, openRequirements };
  }

  if (
    LOCAL_GATE_NAMES.every((gateName) => gates[gateName] === "pass") &&
    gates.windowsSmoke === "pass" &&
    gates.liveProvider !== "fail" &&
    gates.publishDryRun === "pass"
  ) {
    return {
      status:
        gates.liveProvider === "pass" &&
        gates.publishDryRun === "pass" &&
        summarizeReleaseDoctor(options.releaseDoctorReceipt).canPublish &&
        summarizeQuickstartProof(options.quickstartProofReceipt).canClaimQuickstart
          ? "public-ready"
          : "private-ready",
      blockers,
      openRequirements,
    };
  }

  blockers.push(
    options.unknownMessage ??
      "Some gates are still unknown. Run the remaining local or external checks to resolve them.",
  );

  return { status: "blocked", blockers, openRequirements };
}

export function buildReadinessArtifact(options) {
  const gates = createGateRecord(options.gates);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const commitSha = options.commitSha ?? "unknown";
  const releaseDoctor = summarizeReleaseDoctor(options.releaseDoctorReceipt);
  const quickstartProof = summarizeQuickstartProof(options.quickstartProofReceipt);
  const { status, blockers, openRequirements } = computeReadinessStatus(gates, {
    unknownMessage: options.unknownMessage,
    releaseDoctorReceipt: options.releaseDoctorReceipt,
    quickstartProofReceipt: options.quickstartProofReceipt,
  });

  return {
    status,
    scope: "repo-proof",
    commitSha,
    gitCommit: commitSha, // Alias for freshness guard compatibility
    timestamp: generatedAt, // Alias for freshness guard compatibility
    generatedAt,
    gates,
    blockers,
    openRequirements,
    releaseDoctor,
    quickstartProof,
  };
}

export function writeLocalGateEvidence(repoRoot, options) {
  const filePath = resolve(repoRoot, "artifacts/readiness/local-gates.json");
  const artifact = {
    source: options.source ?? "local",
    commitSha: options.commitSha ?? "unknown",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    gates: createGateRecord(options.gates),
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  return { artifact, filePath };
}

export function writeExternalGateReceipt(repoRoot, options) {
  const fileName = EXTERNAL_GATE_RECEIPT_FILES[options.gateName];
  if (!fileName) {
    throw new Error(`Unknown external readiness gate: ${options.gateName}`);
  }

  const filePath = resolve(repoRoot, "artifacts/readiness/external", fileName);
  const artifact = {
    gateName: options.gateName,
    status: normalizeGateStatus(options.status),
    source: options.source ?? "external-gate-runner",
    command: options.command ?? null,
    detail: options.detail ?? null,
    artifacts: [...(options.artifacts ?? [])],
    commitSha: options.commitSha ?? "unknown",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  return { artifact, filePath };
}

export function writeReleaseDoctorReceipt(repoRoot, options) {
  const filePath = resolve(repoRoot, "artifacts/readiness", RELEASE_DOCTOR_RECEIPT_FILE);
  const commitSha = options.commitSha ?? "unknown";
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const artifact = {
    source: options.source ?? "release-doctor",
    commitSha,
    gitCommit: commitSha, // Alias for freshness guard compatibility
    timestamp: generatedAt, // Alias for freshness guard compatibility
    generatedAt,
    summary: {
      readyCount: Number(options.summary?.readyCount ?? 0),
      actionCount: Number(options.summary?.actionCount ?? 0),
      blockerCount: Number(options.summary?.blockerCount ?? 0),
      blockers: [...(options.summary?.blockers ?? [])],
      actions: [...(options.summary?.actions ?? [])],
    },
    checks: [...(options.checks ?? [])],
  };

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");

  return { artifact, filePath };
}

export function writeQuickstartProofReceipt(repoRoot, options) {
  const filePath = resolve(repoRoot, "artifacts/readiness", QUICKSTART_PROOF_RECEIPT_FILE);
  const mdPath = resolve(repoRoot, "artifacts/readiness", "quickstart-proof.md");
  const commitSha = options.commitSha ?? "unknown";
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const status =
    Number(options.summary?.blockerCount ?? 0) > 0
      ? "fail"
      : Number(options.summary?.actionCount ?? 0) > 0
        ? "unknown"
        : "pass";
  const artifact = {
    source: options.source ?? "quickstart-proof",
    commitSha,
    gitCommit: commitSha, // Alias for freshness guard compatibility
    timestamp: generatedAt, // Alias for freshness guard compatibility
    generatedAt,
    status,
    readmeQuickstart: {
      sourcePath: options.readmeQuickstart?.sourcePath ?? null,
      commands: [...(options.readmeQuickstart?.commands ?? [])],
    },
    summary: {
      canClaimQuickstart: Boolean(options.summary?.canClaimQuickstart),
      blockerCount: Number(options.summary?.blockerCount ?? 0),
      actionCount: Number(options.summary?.actionCount ?? 0),
      blockers: [...(options.summary?.blockers ?? [])],
      actions: [...(options.summary?.actions ?? [])],
    },
    steps: [...(options.steps ?? [])],
  };

  const stepRows = artifact.steps
    .map(
      (step) => `| ${step.name} | ${step.status} | ${step.command ?? ""} | ${step.detail ?? ""} |`,
    )
    .join("\n");
  const mdContent =
    `# DanteCode Quickstart Proof\n\n` +
    `**Status:** ${artifact.status}  \n` +
    `**Commit:** \`${String(artifact.commitSha).slice(0, 12)}\`  \n` +
    `**Generated:** ${artifact.generatedAt}  \n` +
    `**Claimable:** ${artifact.summary.canClaimQuickstart}\n\n` +
    `## README Quick Start\n\n` +
    (artifact.readmeQuickstart.commands.length > 0
      ? `\`\`\`bash\n${artifact.readmeQuickstart.commands.join("\n")}\n\`\`\`\n\n`
      : "_missing quickstart command block_\n\n") +
    `## Steps\n\n` +
    `| Step | Status | Command | Detail |\n` +
    `|------|--------|---------|--------|\n` +
    stepRows +
    "\n\n" +
    `## Blockers\n\n` +
    (artifact.summary.blockers.length > 0
      ? artifact.summary.blockers.map((item) => `- ${item}`).join("\n")
      : "- none") +
    "\n\n" +
    `## Actions\n\n` +
    (artifact.summary.actions.length > 0
      ? artifact.summary.actions.map((item) => `- ${item}`).join("\n")
      : "- none") +
    "\n";

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  writeFileSync(mdPath, mdContent, "utf8");

  return { artifact, filePath, mdPath };
}

export function writeReadinessArtifact(repoRoot, artifact) {
  const outPath = resolve(repoRoot, "artifacts/readiness/current-readiness.json");
  const mdPath = resolve(repoRoot, "artifacts/readiness/current-readiness.md");
  const gateRows = Object.entries(artifact.gates)
    .map(([name, value]) => `| ${name} | ${value} |`)
    .join("\n");
  const requirementSections = Object.entries(artifact.openRequirements ?? {})
    .filter(([, requirements]) => Array.isArray(requirements) && requirements.length > 0)
    .map(
      ([target, requirements]) =>
        `## Open Requirements (${target})\n\n${requirements.map((item) => `- ${item}`).join("\n")}\n`,
    )
    .join("\n");
  const releaseDoctorSection = artifact.releaseDoctor?.checked
    ? `\n## Release Doctor\n\n` +
      `- canPublish: ${artifact.releaseDoctor.canPublish}\n` +
      `- blockers: ${artifact.releaseDoctor.blockerCount}\n` +
      `- actions: ${artifact.releaseDoctor.actionCount}\n`
    : `\n## Release Doctor\n\n- missing same-commit release doctor receipt\n`;
  const quickstartSection = artifact.quickstartProof?.checked
    ? `\n## Quickstart Proof\n\n` +
      `- canClaimQuickstart: ${artifact.quickstartProof.canClaimQuickstart}\n` +
      `- blockers: ${artifact.quickstartProof.blockerCount}\n` +
      `- actions: ${artifact.quickstartProof.actionCount}\n`
    : `\n## Quickstart Proof\n\n- missing same-commit quickstart proof receipt\n`;
  const blockerSection =
    artifact.blockers.length > 0
      ? `\n## Blockers\n\n${artifact.blockers.map((blocker) => `- ${blocker}`).join("\n")}\n`
      : "";
  const mdContent =
    `# DanteCode Readiness\n\n` +
    `**Status:** ${artifact.status}  \n` +
    `**Scope:** ${artifact.scope ?? "repo-proof"}  \n` +
    `**Commit:** \`${String(artifact.commitSha).slice(0, 12)}\`  \n` +
    `**Generated:** ${artifact.generatedAt}\n\n` +
    `## Gates\n\n` +
    `| Gate | Status |\n` +
    `|------|--------|\n` +
    gateRows +
    "\n" +
    releaseDoctorSection +
    quickstartSection +
    blockerSection;
  const mdWithRequirements = mdContent + (requirementSections ? `\n${requirementSections}` : "");

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
  writeFileSync(mdPath, mdWithRequirements, "utf8");

  return {
    jsonPath: outPath,
    mdPath,
  };
}
