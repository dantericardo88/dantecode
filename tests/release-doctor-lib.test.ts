import { describe, expect, it } from "vitest";
import {
  classifyCiProofCheck,
  classifyNpmPublishCheck,
  classifyProviderProofCheck,
  classifyReadinessArtifactCheck,
  classifyWorkingTreeCheck,
} from "../scripts/release/release-doctor-lib.mjs";

describe("release doctor classification helpers", () => {
  it("treats missing same-commit CI proof as a blocker", () => {
    const result = classifyCiProofCheck({
      ciProof: null,
      repoSlug: "owner/repo",
      commitSha: "1111111111111111111111111111111111111111",
    });

    expect(result.status).toBe("BLOCKER");
    expect(result.label).toContain("not recorded locally");
  });

  it("treats local npm auth without GitHub NPM_TOKEN as a blocker", () => {
    const result = classifyNpmPublishCheck({
      npmAuthState: {
        ready: true,
        source: "C:/Users/test/.npmrc",
      },
      hasGitHubNpmToken: false,
    });

    expect(result.status).toBe("BLOCKER");
    expect(result.detail).toContain("requires the `NPM_TOKEN` GitHub Actions secret");
  });

  it("does not keep blocking on provider credentials after same-commit proof exists", () => {
    const result = classifyProviderProofCheck({
      detectedProviders: [],
      liveProviderReceipt: {
        status: "pass",
        commitSha: "1111111111111111111111111111111111111111",
      },
    });

    expect(result.status).toBe("READY");
    expect(result.label).toContain("Same-commit live provider smoke receipt is recorded");
  });

  it("keeps provider credentials as an action until proof is actually recorded", () => {
    const result = classifyProviderProofCheck({
      detectedProviders: [{ label: "openai", vars: ["OPENAI_API_KEY"] }],
      liveProviderReceipt: null,
    });

    expect(result.status).toBe("ACTION");
    expect(result.action).toContain("smoke:provider");
  });

  it("treats mismatched readiness artifacts as stale for the current commit", () => {
    const result = classifyReadinessArtifactCheck({
      readinessArtifact: {
        status: "private-ready",
        commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(result.status).toBe("BLOCKER");
    expect(result.label).toContain("stale");
    expect(result.action).toContain("release:sync");
  });

  it("treats stale recorded working-tree counts as invalid for the current commit", () => {
    const result = classifyWorkingTreeCheck({
      workingTreeChanges: ["?? packages/temp-ddgs-harvest"],
      recordedChangeCount: 81,
      recordedCommitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      commitSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    });

    expect(result.status).toBe("BLOCKER");
    expect(result.label).toContain("stale");
    expect(result.detail).toContain("81");
    expect(result.detail).toContain("1");
  });
});
