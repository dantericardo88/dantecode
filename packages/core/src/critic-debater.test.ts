import { describe, expect, it } from "vitest";
import { criticDebate } from "./critic-debater.js";

describe("criticDebate", () => {
  it("returns fail consensus when high-confidence failure dominates", () => {
    const result = criticDebate(
      [
        {
          agentId: "critic-1",
          verdict: "fail",
          confidence: 0.95,
          findings: ["Missing rollback guidance"],
        },
        {
          agentId: "critic-2",
          verdict: "warn",
          confidence: 0.6,
          findings: ["Needs more detail"],
        },
        {
          agentId: "critic-3",
          verdict: "fail",
          confidence: 0.8,
          findings: ["No verification evidence"],
        },
      ],
      "Output text",
    );

    expect(result.consensus).toBe("fail");
    expect(result.blockingFindings).toContain("Missing rollback guidance");
    expect(result.verdictCounts.fail).toBe(2);
  });

  it("returns pass consensus when pass votes dominate", () => {
    const result = criticDebate([
      { agentId: "critic-1", verdict: "pass", confidence: 0.9 },
      { agentId: "critic-2", verdict: "pass", confidence: 0.8 },
      { agentId: "critic-3", verdict: "warn", confidence: 0.4, findings: ["Minor wording issue"] },
    ]);

    expect(result.consensus).toBe("pass");
    expect(result.averageConfidence).toBeGreaterThan(0.6);
  });
});
