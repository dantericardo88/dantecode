import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const statusPriority = {
  READY: 0,
  ACTION: 1,
  BLOCKER: 2,
};

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

// Readiness artifact check — reads generated truth from current-readiness.json
const readinessPath = join(repoRoot, "artifacts", "readiness", "current-readiness.json");
let readinessStatus = "BLOCKER";
let readinessMessage = "artifacts/readiness/current-readiness.json not found.";
let readinessNote = "Run `npm run release:generate` (with GATE_* env vars from CI) to generate.";
let readinessAction = "Run `npm run release:generate` after CI jobs complete.";

if (existsSync(readinessPath)) {
  try {
    const readiness = JSON.parse(readFileSync(readinessPath, "utf8"));
    const s = readiness.status;
    const sha = String(readiness.commitSha ?? "").slice(0, 12);
    if (s === "public-ready") {
      readinessStatus = "READY";
      readinessMessage = `Readiness: public-ready (commit ${sha}).`;
      readinessNote = "All gates pass. Safe to publish.";
      readinessAction =
        "Run `npm run release:doctor --strict` to confirm blockers are zero before publishing.";
    } else if (s === "private-ready") {
      readinessStatus = "ACTION";
      readinessMessage = `Readiness: private-ready (commit ${sha}).`;
      readinessNote = "Local gates pass. Live provider and publish dry-run still pending.";
      readinessAction =
        "Run live provider smoke and publish dry-run, then `npm run release:generate` to update.";
    } else if (s === "local-green-external-pending") {
      readinessStatus = "ACTION";
      readinessMessage = `Readiness: local-green / external-pending (commit ${sha}).`;
      readinessNote = "Local gates green. External gates not yet run by CI.";
      readinessAction = "Push to CI and let the update-readiness job run all gate checks.";
    } else {
      readinessStatus = "BLOCKER";
      const blockerList = Array.isArray(readiness.blockers)
        ? readiness.blockers.join("; ")
        : "see artifacts/readiness/current-readiness.json";
      readinessMessage = `Readiness: blocked — ${blockerList}`;
      readinessNote = "One or more CI gates failed. Fix blockers before releasing.";
      readinessAction = "Fix failing gates, rerun CI, then `npm run release:generate` to update.";
    }
  } catch {
    readinessStatus = "BLOCKER";
    readinessMessage = "artifacts/readiness/current-readiness.json is malformed.";
    readinessNote = "The readiness artifact could not be parsed.";
    readinessAction =
      "Delete artifacts/readiness/current-readiness.json and rerun `npm run release:generate`.";
  }
}

addCheck(checks, "Artifacts", readinessStatus, readinessMessage, readinessNote, readinessAction);

const detectedProviders = detectProviderState();
addCheck(
  checks,
  "External Validation",
  detectedProviders.length > 0 ? "READY" : "BLOCKER",
  detectedProviders.length > 0
    ? `Provider credentials detected for ${detectedProviders.map((provider) => provider.label).join(", ")}.`
    : "No provider credentials detected for the live model-router smoke test.",
  "A real provider run is still required to complete external acceptance beyond local mocks.",
  detectedProviders.length > 0
    ? "Run `npm run smoke:provider -- --require-provider`."
    : "Set GROK_API_KEY, XAI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY, then rerun the provider smoke test.",
);

const npmAuthState = readNpmAuthState();
addCheck(
  checks,
  "External Validation",
  npmAuthState.ready ? "READY" : "BLOCKER",
  npmAuthState.ready
    ? `npm publish auth detected via ${npmAuthState.source}.`
    : "No npm publish auth token detected locally.",
  "Publishing the CLI and core packages requires npm auth locally or the `NPM_TOKEN` GitHub secret.",
  npmAuthState.ready
    ? "Mirror the same credential into the `NPM_TOKEN` GitHub Actions secret before publishing."
    : "Add the `NPM_TOKEN` GitHub Actions secret before running the publish workflow.",
);

addCheck(
  checks,
  "External Validation",
  process.env.VSCE_PAT ? "READY" : "BLOCKER",
  process.env.VSCE_PAT ? "VS Code Marketplace token detected in VSCE_PAT." : "VSCE_PAT is not set.",
  "The preview extension publish job requires `VSCE_PAT` when you want Marketplace distribution.",
  process.env.VSCE_PAT
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

console.log("\nSummary");
console.log("-------");
console.log(`Ready:    ${ready.length}`);
console.log(`Actions:  ${actions.length}`);
console.log(`Blockers: ${blockers.length}`);

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
