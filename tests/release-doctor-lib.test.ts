import { describe, expect, it } from "vitest";
import {
  classifyCiProofCheck,
  classifyNpmPublishCheck,
  classifyProviderProofCheck,
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
});
