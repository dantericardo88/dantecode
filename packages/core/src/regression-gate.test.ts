import { describe, expect, it } from "vitest";
import {
  createRegressionFailureSignature,
  evaluateScoreClaimGate,
  runRegressionGate,
  validateRegressionWaivers,
} from "./regression-gate.js";

describe("regression gate", () => {
  const now = () => new Date("2026-04-29T12:00:00.000Z");

  it("passes when every configured step passes", () => {
    const result = runRegressionGate({
      projectRoot: "/repo",
      profile: "score_claim",
      threshold: 90,
      now,
      execSyncFn: (command) => `ok: ${command}`,
      steps: [
        { name: "typecheck", command: "npm run typecheck" },
        { name: "lint", command: "npm run lint" },
        { name: "test", command: "npm test" },
        { name: "coverage", command: "npm run test:coverage" },
      ],
    });

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.blockingFailures).toHaveLength(0);
    expect(result.proof.releaseGatesGreen).toBe(true);
    expect(result.proof.scoreClaimsBlocked).toBe(true);
  });

  it("fails on blocking release-gate failures", () => {
    const result = runRegressionGate({
      projectRoot: "/repo",
      profile: "release",
      threshold: 90,
      now,
      execSyncFn: (command) => {
        if (command.includes("lint")) {
          throw new Error("ESLint: no-unused-vars in src/example.ts");
        }
        return "ok";
      },
      steps: [
        { name: "typecheck", command: "npm run typecheck" },
        { name: "lint", command: "npm run lint" },
      ],
    });

    expect(result.pass).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.classification).toBe("blocking");
    expect(result.blockingFailures[0]?.stepName).toBe("lint");
  });

  it("classifies timeout-like failures as flaky", () => {
    const result = runRegressionGate({
      projectRoot: "/repo",
      profile: "release",
      threshold: 90,
      now,
      execSyncFn: () => {
        throw new Error("Vitest hook timed out after 15000ms");
      },
      steps: [{ name: "test", command: "npm test" }],
    });

    expect(result.failures[0]?.classification).toBe("flaky");
    expect(result.pass).toBe(false);
  });

  it("classifies compiler and lint errors as blocking even when tool output includes warnings", () => {
    const result = runRegressionGate({
      projectRoot: "/repo",
      profile: "release",
      threshold: 90,
      now,
      execSyncFn: () => {
        throw new Error("WARNING Workspace 'packages/example' not found in lockfile\nsrc/file.ts(1,1): error TS6133");
      },
      steps: [{ name: "typecheck", command: "npm run typecheck" }],
    });

    expect(result.failures[0]?.classification).toBe("blocking");
    expect(result.blockingFailures).toHaveLength(1);
  });

  it("applies active waivers while keeping the failure visible", () => {
    const output = "Legacy package emits TS6133 unused local";
    const signature = createRegressionFailureSignature("typecheck", output);
    const result = runRegressionGate({
      projectRoot: "/repo",
      profile: "release",
      threshold: 80,
      now,
      execSyncFn: () => {
        throw new Error(output);
      },
      steps: [{ name: "typecheck", command: "npm run typecheck" }],
      waivers: [
        {
          signature,
          classification: "known_legacy",
          owner: "quality",
          reason: "Documented pre-existing TypeScript debt while Dim34 gate lands.",
          expiresAt: "2026-05-15T00:00:00.000Z",
        },
      ],
    });

    expect(result.failures[0]?.classification).toBe("known_legacy");
    expect(result.blockingFailures).toHaveLength(0);
    expect(result.pass).toBe(true);
    expect(result.score).toBeLessThan(100);
  });

  it("fails closed for expired waivers", () => {
    const output = "Legacy package emits TS6133 unused local";
    const signature = createRegressionFailureSignature("typecheck", output);
    const waiverErrors = validateRegressionWaivers(
      [
        {
          signature,
          classification: "known_legacy",
          owner: "quality",
          reason: "Expired waiver.",
          expiresAt: "2026-04-01T00:00:00.000Z",
        },
      ],
      now(),
    );

    expect(waiverErrors[0]?.reason).toContain("expired");
  });

  it("rejects waivers missing owner, reason, expiry, signature, or non-blocking classification", () => {
    const waiverErrors = validateRegressionWaivers(
      [
        {
          signature: "",
          classification: "blocking",
          owner: "",
          reason: "",
          expiresAt: "",
        },
      ],
      now(),
    );

    expect(waiverErrors.map((error) => error.field)).toEqual([
      "signature",
      "owner",
      "reason",
      "expiresAt",
      "classification",
    ]);
  });

  it("fails score-claim evaluation when release proof is absent or red", () => {
    expect(evaluateScoreClaimGate(null).ok).toBe(false);
    expect(
      evaluateScoreClaimGate({
        pass: false,
        score: 75,
        threshold: 90,
        profile: "score_claim",
      }).ok,
    ).toBe(false);
  });

  it("marks score claims as blocked when the score-claim profile is red", () => {
    const result = runRegressionGate({
      projectRoot: "/repo",
      profile: "score_claim",
      threshold: 90,
      now,
      execSyncFn: () => {
        throw new Error("ESLint: no-unused-vars");
      },
      steps: [{ name: "lint", command: "npm run lint" }],
    });

    expect(result.pass).toBe(false);
    expect(result.proof.scoreClaimsBlocked).toBe(true);
  });
});
