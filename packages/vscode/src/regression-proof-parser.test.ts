import { describe, expect, it } from "vitest";
import { parseRegressionGateProofFromOutput } from "./regression-proof-parser.js";

describe("parseRegressionGateProofFromOutput", () => {
  it("extracts Dim34 score-claim proof from CLI JSON output", () => {
    const proof = parseRegressionGateProofFromOutput(`prefix\n${JSON.stringify({
      dimensionId: "regression_prevention",
      pass: true,
      score: 100,
      threshold: 90,
      profile: "score_claim",
    })}\n`);

    expect(proof).toEqual({
      pass: true,
      score: 100,
      threshold: 90,
      profile: "score_claim",
    });
  });

  it("ignores non-Dim34 JSON output", () => {
    const proof = parseRegressionGateProofFromOutput(JSON.stringify({
      dimensionId: "accessibility_inclusive_ux",
      pass: true,
      score: 100,
      threshold: 90,
      profile: "score_claim",
    }));

    expect(proof).toBeNull();
  });

  it("returns null for partial or malformed output", () => {
    expect(parseRegressionGateProofFromOutput("not json")).toBeNull();
    expect(parseRegressionGateProofFromOutput(JSON.stringify({ dimensionId: "regression_prevention" }))).toBeNull();
  });
});
