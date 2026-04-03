export function classifyCiProofCheck({ ciProof, repoSlug, commitSha }) {
  const shortSha = String(commitSha ?? "").slice(0, 12);

  return {
    status: ciProof?.conclusion === "success" ? "READY" : "BLOCKER",
    label: ciProof
      ? `GitHub CI for ${shortSha} concluded ${ciProof.conclusion ?? ciProof.status ?? "unknown"}.`
      : "GitHub CI proof for the current commit is not recorded locally.",
    detail:
      "Public release proof should include a successful CI run for the same commit being evaluated.",
    action:
      ciProof?.conclusion === "success"
        ? "CI proof is recorded for this commit."
        : repoSlug
          ? "Push the current commit, wait for ci.yml to finish green, then rerun the release doctor."
          : "Configure an origin remote that points at GitHub, then rerun the release doctor.",
  };
}

export function classifyProviderProofCheck({ detectedProviders, liveProviderReceipt }) {
  const receiptPassed =
    normalizeStatus(liveProviderReceipt?.status ?? liveProviderReceipt?.gateStatus) === "pass";

  if (receiptPassed) {
    return {
      status: "READY",
      label: "Same-commit live provider smoke receipt is recorded.",
      detail:
        "A provider-backed receipt for the current commit already proves the external provider path.",
      action: "Provider proof is already recorded for this commit.",
    };
  }

  if (detectedProviders.length > 0) {
    return {
      status: "ACTION",
      label: `Provider credentials detected for ${detectedProviders.map((provider) => provider.label).join(", ")}.`,
      detail:
        "Provider credentials are available, but the same-commit live provider smoke proof still needs to be generated.",
      action: "Run `npm run smoke:provider -- --require-provider`.",
    };
  }

  return {
    status: "BLOCKER",
    label: "No provider credentials detected for the live model-router smoke test.",
    detail:
      "A real provider run is still required to complete external acceptance beyond local mocks.",
    action:
      "Set GROK_API_KEY, XAI_API_KEY, ANTHROPIC_API_KEY, or OPENAI_API_KEY, then rerun the provider smoke test.",
  };
}

export function classifyNpmPublishCheck({ npmAuthState, hasGitHubNpmToken }) {
  if (hasGitHubNpmToken) {
    return {
      status: "READY",
      label: "GitHub Actions secret NPM_TOKEN is configured.",
      detail:
        "Public release automation publishes through GitHub Actions, so the workflow secret is the required proof.",
      action: "Publish workflow auth is already configured for this repo.",
    };
  }

  if (npmAuthState.ready) {
    return {
      status: "BLOCKER",
      label: `Local npm publish auth detected via ${npmAuthState.source}.`,
      detail:
        "Local npm auth helps manual dry runs, but CLI Public GA still requires the `NPM_TOKEN` GitHub Actions secret.",
      action: "Add the `NPM_TOKEN` GitHub Actions secret before running the publish workflow.",
    };
  }

  return {
    status: "BLOCKER",
    label: "No npm publish auth token detected locally or in GitHub Actions secrets.",
    detail:
      "Publishing the CLI and core packages requires the `NPM_TOKEN` GitHub Actions secret for the public workflow.",
    action: "Add the `NPM_TOKEN` GitHub Actions secret before running the publish workflow.",
  };
}

export function classifyReadinessArtifactCheck({ readinessArtifact, commitSha }) {
  const artifactCommitSha = String(readinessArtifact?.commitSha ?? "").trim();
  const shortSha = String(commitSha ?? "").slice(0, 12);

  if (!readinessArtifact) {
    return {
      status: "BLOCKER",
      label: "Readiness artifact is missing for the current commit.",
      detail:
        "The repo-tracked readiness surface must be regenerated from the current commit before it can support any ship claim.",
      action: "Run `npm run release:sync` to regenerate same-commit readiness receipts.",
    };
  }

  if (artifactCommitSha && commitSha && artifactCommitSha !== commitSha) {
    return {
      status: "BLOCKER",
      label: `Readiness artifact is stale for git HEAD ${shortSha}.`,
      detail:
        `current-readiness.json is pinned to ${artifactCommitSha.slice(0, 12)}, ` +
        `not the current commit ${shortSha}.`,
      action: "Run `npm run release:sync` to regenerate same-commit readiness receipts.",
    };
  }

  return {
    status: "READY",
    label: `Readiness artifact matches git HEAD ${shortSha}.`,
    detail: "The repo-tracked readiness surface is aligned with the commit being evaluated.",
    action: "Same-commit readiness proof is already recorded.",
  };
}

export function classifyWorkingTreeCheck({
  workingTreeChanges,
  recordedChangeCount,
  recordedCommitSha,
  commitSha,
}) {
  const currentCount = Array.isArray(workingTreeChanges) ? workingTreeChanges.length : 0;
  const normalizedRecordedCount = Number.isFinite(recordedChangeCount) ? recordedChangeCount : null;
  const hasRecordedCommit = Boolean(String(recordedCommitSha ?? "").trim());
  const currentCommit = String(commitSha ?? "").trim();
  const shortSha = currentCommit.slice(0, 12);

  if (
    normalizedRecordedCount === null ||
    !hasRecordedCommit ||
    !currentCommit ||
    recordedCommitSha !== currentCommit
  ) {
    return {
      status: "BLOCKER",
      label: `Recorded working-tree summary is stale for git HEAD ${shortSha}.`,
      detail:
        `The recorded change count (${normalizedRecordedCount ?? "unknown"}) does not belong to ` +
        `the current commit and cannot be trusted against the current ${currentCount} path(s).`,
      action: "Run `npm run release:sync` to refresh repo-tracked proof for the current commit.",
    };
  }

  if (normalizedRecordedCount !== currentCount) {
    return {
      status: "BLOCKER",
      label: `Recorded working-tree summary drifted from git HEAD ${shortSha}.`,
      detail:
        `The recorded change count (${normalizedRecordedCount}) no longer matches the current ` +
        `${currentCount} path(s) in \`git status --short\`.`,
      action: "Regenerate readiness after reviewing or committing the working tree changes.",
    };
  }

  return {
    status: "READY",
    label: `Recorded working-tree summary matches git HEAD ${shortSha}.`,
    detail: `The recorded and current working-tree counts both report ${currentCount} path(s).`,
    action: "Working-tree proof is aligned with the current commit.",
  };
}

function normalizeStatus(value) {
  return value === "pass" || value === "fail" || value === "unknown" ? value : "unknown";
}
