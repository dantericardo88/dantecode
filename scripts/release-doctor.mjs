import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";
import {
  readExternalGateEvidence,
  readQuickstartProofEvidence,
  resolveCommitSha,
  writeReleaseDoctorReceipt,
} from "./release/readiness-lib.mjs";
import {
  classifyCiProofCheck,
  classifyNpmPublishCheck,
  classifyProviderProofCheck,
  classifyReadinessArtifactCheck,
} from "./release/release-doctor-lib.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const statusPriority = {
  READY: 0,
  ACTION: 1,
  BLOCKER: 2,
};
const commitSha = resolveCommitSha(repoRoot, process.env);

/**
 * Check freshness of readiness artifacts (inline version for scripts)
 */
function checkArtifactFreshness(artifactPaths, currentCommit) {
  const artifacts = [];
  for (const artifactPath of artifactPaths) {
    const fullPath = resolve(repoRoot, artifactPath);
    if (!existsSync(fullPath)) {
      artifacts.push({
        name: artifactPath.split(/[/\\]/).pop(),
        stale: true,
        staleDuration: "missing file",
      });
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");
      const artifact = JSON.parse(content);
      const artifactCommit = artifact.gitCommit || artifact.commitSha || "";
      const stale = artifactCommit !== currentCommit;
      artifacts.push({
        name: artifactPath.split(/[/\\]/).pop(),
        stale,
        staleDuration: stale
          ? `commit ${artifactCommit.slice(0, 7)} != ${currentCommit.slice(0, 7)}`
          : undefined,
      });
    } catch {
      artifacts.push({
        name: artifactPath.split(/[/\\]/).pop(),
        stale: true,
        staleDuration: "parse error",
      });
    }
  }
  return artifacts;
}

function parseArgs(argv) {
  return {
    strict: argv.includes("--strict"),
  };
}

function parseVersion(value) {
  const match = value.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isVersionAtLeast(version, minimum) {
  if (!version) {
    return false;
  }

  if (version.major !== minimum.major) {
    return version.major > minimum.major;
  }
  if (version.minor !== minimum.minor) {
    return version.minor > minimum.minor;
  }

  return version.patch >= minimum.patch;
}

function runCommand(command, args, cwd = repoRoot) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
}

function readGitConfig(key) {
  const result = runCommand("git", ["config", "--get", key]);
  if (result.status !== 0) {
    return "";
  }

  return (result.stdout ?? "").trim();
}

function readOriginRemote() {
  const result = runCommand("git", ["remote", "get-url", "origin"]);
  if (result.status !== 0) {
    return "";
  }

  return (result.stdout ?? "").trim();
}

function parseGitHubRepoSlug(remoteUrl) {
  const trimmed = String(remoteUrl ?? "").trim();
  const match = trimmed.match(/github\.com[/:]([^/]+\/[^/.]+)(?:\.git)?$/i);
  return match?.[1] ?? "";
}

function readWorkingTreeChanges() {
  const result = runCommand("git", ["status", "--porcelain"]);
  if (result.status !== 0) {
    return [];
  }

  return (result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

function readNpmAuthState() {
  if (process.env.NPM_TOKEN) {
    return {
      ready: true,
      source: "NPM_TOKEN environment variable",
    };
  }

  const npmrcPaths = [join(repoRoot, ".npmrc"), join(homedir(), ".npmrc")];
  for (const npmrcPath of npmrcPaths) {
    if (!existsSync(npmrcPath)) {
      continue;
    }

    const content = readFileSync(npmrcPath, "utf8");
    if (content.includes("//registry.npmjs.org/:_authToken=") || content.includes("_authToken=")) {
      return {
        ready: true,
        source: npmrcPath,
      };
    }
  }

  return {
    ready: false,
    source: "",
  };
}

function listGitHubSecretNames(repoSlug) {
  if (!repoSlug) {
    return null;
  }

  const result = runCommand("gh", ["secret", "list", "--repo", repoSlug, "--json", "name"]);
  if (result.status !== 0) {
    return null;
  }

  try {
    const secrets = JSON.parse(result.stdout ?? "[]");
    return Array.isArray(secrets) ? secrets.map((secret) => String(secret.name ?? "")) : [];
  } catch {
    return null;
  }
}

function readCiProof(repoSlug, commitSha) {
  if (!repoSlug || !commitSha) {
    return null;
  }

  const result = runCommand("gh", [
    "run",
    "list",
    "--repo",
    repoSlug,
    "--workflow",
    "ci.yml",
    "--commit",
    commitSha,
    "--json",
    "databaseId,headSha,status,conclusion,url",
    "--limit",
    "5",
  ]);
  if (result.status !== 0) {
    return null;
  }

  try {
    const runs = JSON.parse(result.stdout ?? "[]");
    if (!Array.isArray(runs)) {
      return null;
    }
    return runs.find((run) => String(run.headSha ?? "") === commitSha) ?? null;
  } catch {
    return null;
  }
}

function detectProviderState() {
  const providerEnvGroups = [
    { label: "grok", vars: ["GROK_API_KEY", "XAI_API_KEY"] },
    { label: "anthropic", vars: ["ANTHROPIC_API_KEY"] },
    { label: "openai", vars: ["OPENAI_API_KEY"] },
  ];

  return providerEnvGroups
    .map((group) => ({
      label: group.label,
      vars: group.vars.filter((envVar) => Boolean(process.env[envVar])),
    }))
    .filter((group) => group.vars.length > 0);
}

function addCheck(collection, section, status, label, detail, action) {
  collection.push({
    section,
    status,
    label,
    detail,
    action,
  });
}

function printSection(title, checks) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));

  for (const check of checks) {
    console.log(`[${check.status}] ${check.label}`);
    if (check.detail) {
      console.log(`  ${check.detail}`);
    }
    if (check.action) {
      console.log(`  Next: ${check.action}`);
    }
  }
}

const args = parseArgs(process.argv);
const checks = [];
const quickstartProof = readQuickstartProofEvidence(repoRoot, {
  currentCommitSha: commitSha,
}).receipt;
const externalGateEvidence = readExternalGateEvidence(repoRoot, { currentCommitSha: commitSha });
const liveProviderReceipt = externalGateEvidence.receipts?.liveProvider ?? null;

addCheck(
  checks,
  "Toolchain",
  isVersionAtLeast(parseVersion(process.version), { major: 20, minor: 0, patch: 0 })
    ? "READY"
    : "BLOCKER",
  `Node.js ${process.version}`,
  "Requires Node.js 20 or newer for the OSS v1 toolchain.",
  "Install Node.js 20+ and rerun `npm ci`.",
);

const npmVersionResult = spawnNpm(["--version"], repoRoot);
const npmVersion = (npmVersionResult.stdout ?? "").trim();
addCheck(
  checks,
  "Toolchain",
  isVersionAtLeast(parseVersion(npmVersion), { major: 11, minor: 0, patch: 0 })
    ? "READY"
    : "BLOCKER",
  `npm ${npmVersion || "not detected"}`,
  "Requires npm 11 or newer for the canonical workspace flow.",
  "Install npm 11+ and rerun `npm ci`.",
);

const gitVersionResult = runCommand("git", ["--version"]);
addCheck(
  checks,
  "Toolchain",
  gitVersionResult.status === 0 ? "READY" : "BLOCKER",
  gitVersionResult.status === 0
    ? (gitVersionResult.stdout ?? "").trim()
    : "git is not available on PATH",
  "Git is required for repo mapping, worktrees, and public release flow.",
  "Install Git and rerun the release doctor.",
);

const gitUserName = readGitConfig("user.name");
const gitUserEmail = readGitConfig("user.email");
const placeholderName = !gitUserName || gitUserName === "Your Name";
const placeholderEmail =
  !gitUserEmail || gitUserEmail === "you@example.com" || !gitUserEmail.includes("@");

addCheck(
  checks,
  "Repo",
  placeholderName ? "BLOCKER" : "READY",
  placeholderName
    ? "Git user.name is missing or still uses the placeholder value."
    : `Git user.name: ${gitUserName}`,
  "Public pushes should use your real name so GitHub attribution and release history are correct.",
  'Run `git config --global user.name "Your Real Name"`.',
);

addCheck(
  checks,
  "Repo",
  placeholderEmail ? "BLOCKER" : "READY",
  placeholderEmail
    ? "Git user.email is missing or still uses the placeholder value."
    : `Git user.email: ${gitUserEmail}`,
  "Public pushes should use the email address linked to your GitHub account.",
  'Run `git config --global user.email "you@your-domain.com"`.',
);

const originRemote = readOriginRemote();
const repoSlug = parseGitHubRepoSlug(originRemote);
addCheck(
  checks,
  "Repo",
  originRemote ? "READY" : "BLOCKER",
  originRemote ? `origin remote: ${originRemote}` : "No git origin remote is configured.",
  "A remote is required before the first public push and Actions validation run.",
  "Create the GitHub repo in the browser, then run `git remote add origin <repo-url>`.",
);

const workingTreeChanges = readWorkingTreeChanges();
addCheck(
  checks,
  "Repo",
  workingTreeChanges.length === 0 ? "READY" : "ACTION",
  workingTreeChanges.length === 0
    ? "Working tree is clean."
    : `Working tree has ${workingTreeChanges.length} uncommitted path(s).`,
  "This is fine during development, but review or commit the release set before pushing.",
  "Run `git status --short` and commit the release-ready changes you want to publish.",
);

const ghVersionResult = runCommand("gh", ["--version"]);
if (ghVersionResult.status === 0) {
  const ghAuthResult = runCommand("gh", ["auth", "status"]);
  addCheck(
    checks,
    "Repo",
    ghAuthResult.status === 0 ? "READY" : "ACTION",
    ghAuthResult.status === 0
      ? "gh CLI is installed and authenticated."
      : "gh CLI is installed but not authenticated.",
    "GitHub CLI is optional. Browser repo creation plus `git push` is still the default fallback.",
    "Run `gh auth login` if you want CLI-based repo and release operations.",
  );
} else {
  addCheck(
    checks,
    "Repo",
    "ACTION",
    "gh CLI is not installed.",
    "GitHub CLI is optional. Browser repo creation plus `git push` still works.",
    "Install `gh` only if you want GitHub automation from the terminal.",
  );
}

const ciProof = readCiProof(repoSlug, commitSha);
{
  const ciCheck = classifyCiProofCheck({ ciProof, repoSlug, commitSha });
  addCheck(
    checks,
    "External Validation",
    ciCheck.status,
    ciCheck.label,
    ciCheck.detail,
    ciCheck.action,
  );
}

const cliArtifactPath = join(repoRoot, "packages", "cli", "dist", "index.js");
const coreArtifactPath = join(repoRoot, "packages", "core", "dist", "index.js");

addCheck(
  checks,
  "Artifacts",
  existsSync(cliArtifactPath) ? "READY" : "ACTION",
  existsSync(cliArtifactPath) ? "Built CLI artifact exists." : "Built CLI artifact is missing.",
  "The smoke checks and source install path expect a built CLI.",
  "Run `npm run build` before the full release sweep.",
);

addCheck(
  checks,
  "Artifacts",
  existsSync(coreArtifactPath) ? "READY" : "ACTION",
  existsSync(coreArtifactPath)
    ? "Built core runtime artifact exists."
    : "Built core runtime artifact is missing.",
  "The live provider smoke check expects the built core runtime.",
  "Run `npm run build` before `npm run smoke:provider -- --require-provider`.",
);

addCheck(
  checks,
  "Artifacts",
  existsSync(join(repoRoot, ".github", "workflows", "ci.yml")) &&
    existsSync(join(repoRoot, ".github", "workflows", "publish.yml"))
    ? "READY"
    : "ACTION",
  "GitHub Actions workflow files present.",
  "CI and publish automation are versioned with the repo and ready after the first push.",
  "",
);

const readinessPath = join(repoRoot, "artifacts", "readiness", "current-readiness.json");
let readinessArtifact = null;
if (existsSync(readinessPath)) {
  try {
    readinessArtifact = JSON.parse(readFileSync(readinessPath, "utf8"));
  } catch {
    readinessArtifact = null;
  }
}

const readinessArtifactCheck = classifyReadinessArtifactCheck({
  readinessArtifact,
  commitSha,
});
if (readinessArtifactCheck.status !== "READY") {
  addCheck(
    checks,
    "Artifacts",
    readinessArtifactCheck.status,
    readinessArtifactCheck.label,
    readinessArtifactCheck.detail,
    readinessArtifactCheck.action,
  );
}

// Check freshness of readiness artifacts (same-commit guard)
const artifactPaths = [
  "artifacts/readiness/current-readiness.json",
  "artifacts/readiness/quickstart-proof.json",
  "artifacts/readiness/release-doctor.json",
];
try {
  const artifacts = checkArtifactFreshness(artifactPaths, commitSha);
  const staleArtifacts = artifacts.filter((a) => a.stale);

  if (staleArtifacts.length > 0) {
    const staleNames = staleArtifacts.map((a) => a.name).join(", ");
    const oldestDuration = staleArtifacts[0]?.staleDuration ?? "unknown";

    addCheck(
      checks,
      "Artifacts",
      args.strict || process.env.CI ? "BLOCKER" : "ACTION",
      `${staleArtifacts.length} readiness artifact${staleArtifacts.length === 1 ? " is" : "s are"} stale`,
      `Stale: ${staleNames} (${oldestDuration})`,
      "Run `npm run generate-readiness` to refresh artifacts.",
    );
  } else {
    addCheck(
      checks,
      "Artifacts",
      "READY",
      "All readiness artifacts are fresh (same commit)",
      `Current commit: ${commitSha.slice(0, 7)}`,
      null,
    );
  }
} catch (error) {
  addCheck(
    checks,
    "Artifacts",
    "ACTION",
    "Failed to check readiness artifact freshness",
    error instanceof Error ? error.message : String(error),
    "Ensure git is working and artifacts exist.",
  );
}

if (readinessArtifactCheck.status === "READY") {
  const readiness = readinessArtifact;
  const s = readiness.status;
  const sha = String(readiness.commitSha ?? "").slice(0, 12);
  const publicRequirements = Array.isArray(readiness.openRequirements?.publicReady)
    ? readiness.openRequirements.publicReady
    : [];
  const summarizedRequirements =
    publicRequirements.length > 0
      ? publicRequirements.slice(0, 3).join("; ")
      : "Run `npm run release:sync` to refresh public-ready requirements.";

  if (s === "public-ready") {
    addCheck(
      checks,
      "Artifacts",
      "READY",
      `Readiness: public-ready (commit ${sha}).`,
      "All gated repo-proof checks pass for the current commit.",
      "Run `npm run release:doctor --strict` to confirm blockers are zero before publishing.",
    );
  } else if (s === "private-ready") {
    addCheck(
      checks,
      "Artifacts",
      "ACTION",
      `Readiness: private-ready (commit ${sha}).`,
      `Repo proof is private-ready. Public-ready still requires: ${summarizedRequirements}`,
      "Close the remaining public-ready requirements, then rerun `npm run release:sync`.",
    );
  } else if (s === "local-green-external-pending") {
    addCheck(
      checks,
      "Artifacts",
      "ACTION",
      `Readiness: local-green / external-pending (commit ${sha}).`,
      `Local gates are green. Remaining requirements: ${summarizedRequirements}`,
      "Run the missing external gates or CI jobs, then rerun `npm run release:sync`.",
    );
  } else {
    const blockerList = Array.isArray(readiness.blockers)
      ? readiness.blockers.join("; ")
      : "see artifacts/readiness/current-readiness.json";
    addCheck(
      checks,
      "Artifacts",
      "BLOCKER",
      `Readiness: blocked — ${blockerList}`,
      "One or more CI gates failed. Fix blockers before releasing.",
      "Fix failing gates, rerun CI, then `npm run release:sync` to update.",
    );
  }
}

const quickstartSummary = quickstartProof?.summary ?? {};
addCheck(
  checks,
  "Artifacts",
  !quickstartProof
    ? "BLOCKER"
    : quickstartSummary.canClaimQuickstart
      ? "READY"
      : Array.isArray(quickstartSummary.blockers) && quickstartSummary.blockers.length > 0
        ? "BLOCKER"
        : "ACTION",
  !quickstartProof
    ? "README quickstart proof receipt is missing for the current commit."
    : quickstartSummary.canClaimQuickstart
      ? "README quickstart proof is recorded for the current commit."
      : "README quickstart proof is present but still has unresolved follow-up actions.",
  !quickstartProof
    ? "Public release proof should include a same-commit quickstart receipt generated from real smoke commands."
    : quickstartSummary.canClaimQuickstart
      ? `Quickstart proof recorded at ${quickstartProof.sourcePath ?? "artifacts/readiness/quickstart-proof.json"}. The provider-backed task step remains covered by the live provider gate.`
      : Array.isArray(quickstartSummary.blockers) && quickstartSummary.blockers.length > 0
        ? quickstartSummary.blockers.join(" ")
        : Array.isArray(quickstartSummary.actions) && quickstartSummary.actions.length > 0
          ? quickstartSummary.actions.join(" ")
          : "The quickstart proof receipt exists, but it does not yet support the public claim.",
  !quickstartProof || !quickstartSummary.canClaimQuickstart
    ? "Run `npm run release:prove-quickstart` to generate same-commit quickstart proof."
    : "Quickstart proof is already recorded for this commit.",
);

const detectedProviders = detectProviderState();
{
  const providerCheck = classifyProviderProofCheck({
    detectedProviders,
    liveProviderReceipt,
  });
  addCheck(
    checks,
    "External Validation",
    providerCheck.status,
    providerCheck.label,
    providerCheck.detail,
    providerCheck.action,
  );
}

const npmAuthState = readNpmAuthState();
const githubSecrets = listGitHubSecretNames(repoSlug) ?? [];
const hasGitHubNpmToken = githubSecrets.includes("NPM_TOKEN");
{
  const npmCheck = classifyNpmPublishCheck({
    npmAuthState,
    hasGitHubNpmToken,
  });
  addCheck(
    checks,
    "External Validation",
    npmCheck.status,
    npmCheck.label,
    npmCheck.detail,
    npmCheck.action,
  );
}

const hasVsceSecret = githubSecrets.includes("VSCE_PAT");
addCheck(
  checks,
  "External Validation",
  process.env.VSCE_PAT || hasVsceSecret ? "READY" : "ACTION",
  process.env.VSCE_PAT
    ? "VS Code Marketplace token detected in VSCE_PAT."
    : hasVsceSecret
      ? "GitHub Actions secret VSCE_PAT is configured."
      : "VSCE_PAT is not set locally or in GitHub Actions secrets.",
  "The preview extension publish job requires `VSCE_PAT` only when you want Marketplace distribution for the preview surface. It is not required for CLI Public GA.",
  process.env.VSCE_PAT || hasVsceSecret
    ? "Mirror the same token into the `VSCE_PAT` GitHub Actions secret before publishing."
    : "Add the `VSCE_PAT` GitHub Actions secret before publishing the preview extension.",
);

console.log("DanteCode Release Doctor");
console.log("========================");
console.log(
  "Local code and docs are ready to validate. This command focuses on the final external blockers.",
);

for (const section of ["Toolchain", "Repo", "Artifacts", "External Validation"]) {
  printSection(
    section,
    checks.filter((check) => check.section === section),
  );
}

const blockers = checks.filter((check) => check.status === "BLOCKER");
const actions = checks.filter((check) => check.status === "ACTION");
const ready = checks.filter((check) => check.status === "READY");
const doctorReceipt = writeReleaseDoctorReceipt(repoRoot, {
  commitSha,
  generatedAt: new Date().toISOString(),
  summary: {
    readyCount: ready.length,
    actionCount: actions.length,
    blockerCount: blockers.length,
    blockers: blockers.map((check) => check.label),
    actions: actions.map((check) => check.label),
  },
  checks,
});

console.log("\nSummary");
console.log("-------");
console.log(`Ready:    ${ready.length}`);
console.log(`Actions:  ${actions.length}`);
console.log(`Blockers: ${blockers.length}`);
console.log(`Receipt:  ${doctorReceipt.filePath}`);

const nextSteps = checks
  .filter((check) => check.status !== "READY" && check.action)
  .sort((left, right) => statusPriority[right.status] - statusPriority[left.status])
  .map((check) => check.action);

if (nextSteps.length > 0) {
  console.log("\nSuggested next steps");
  console.log("--------------------");
  nextSteps.forEach((step, index) => {
    console.log(`${index + 1}. ${step}`);
  });
}

if (args.strict && blockers.length > 0) {
  process.exit(1);
}
