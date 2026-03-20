import { describe, expect, it, beforeEach } from "vitest";
import { computeConsensus, type ConsensusVote } from "./verification-consensus.js";
import {
  VerificationCriticRunner,
  COMPLETENESS_CRITIC,
  HALLUCINATION_CRITIC,
  RELEVANCE_CRITIC,
} from "./verification-critic-runner.js";

// ---------------------------------------------------------------------------
// computeConsensus
// ---------------------------------------------------------------------------

describe("computeConsensus", () => {
  it("returns pass when all votes are pass", () => {
    const votes: ConsensusVote[] = [
      { agentId: "c1", verdict: "pass", confidence: 0.9 },
      { agentId: "c2", verdict: "pass", confidence: 0.85 },
    ];
    const result = computeConsensus(votes);
    expect(result.verdict).toBe("pass");
    expect(result.voteBreakdown.pass).toBe(2);
    expect(result.blockingFindings).toHaveLength(0);
  });

  it("returns fail when majority vote fail (weighted)", () => {
    const votes: ConsensusVote[] = [
      { agentId: "c1", verdict: "fail", confidence: 0.95, findings: ["Missing evidence"] },
      { agentId: "c2", verdict: "fail", confidence: 0.9, findings: ["Wrong conclusion"] },
      { agentId: "c3", verdict: "pass", confidence: 0.6 },
    ];
    const result = computeConsensus(votes);
    expect(result.verdict).toBe("fail");
    expect(result.blockingFindings).toContain("Missing evidence");
    expect(result.blockingFindings).toContain("Wrong conclusion");
  });

  it("returns warn when votes are mixed pass/warn", () => {
    const votes: ConsensusVote[] = [
      { agentId: "c1", verdict: "pass", confidence: 0.7 },
      { agentId: "c2", verdict: "warn", confidence: 0.8 },
    ];
    const result = computeConsensus(votes);
    expect(result.verdict).toBe("warn");
  });

  it("strict mode: any fail → fail", () => {
    const votes: ConsensusVote[] = [
      { agentId: "c1", verdict: "pass", confidence: 0.9 },
      { agentId: "c2", verdict: "pass", confidence: 0.9 },
      { agentId: "c3", verdict: "fail", confidence: 0.3 },
    ];
    const result = computeConsensus(votes, { strategy: "strict" });
    expect(result.verdict).toBe("fail");
  });

  it("majority mode: simple count wins", () => {
    const votes: ConsensusVote[] = [
      { agentId: "c1", verdict: "pass" },
      { agentId: "c2", verdict: "pass" },
      { agentId: "c3", verdict: "fail" },
    ];
    const result = computeConsensus(votes, { strategy: "majority" });
    expect(result.verdict).toBe("pass");
  });

  it("deduplicates blocking findings", () => {
    const votes: ConsensusVote[] = [
      { agentId: "c1", verdict: "fail", findings: ["dup finding"] },
      { agentId: "c2", verdict: "fail", findings: ["dup finding"] },
    ];
    const result = computeConsensus(votes);
    expect(result.blockingFindings).toEqual(["dup finding"]);
  });

  it("returns default pass with zero confidence for empty votes", () => {
    const result = computeConsensus([]);
    expect(result.verdict).toBe("pass");
    expect(result.confidence).toBe(0);
    expect(result.quorumMet).toBe(false);
  });

  it("includes confidence average in result", () => {
    const votes: ConsensusVote[] = [
      { agentId: "c1", verdict: "pass", confidence: 0.6 },
      { agentId: "c2", verdict: "pass", confidence: 0.8 },
    ];
    const result = computeConsensus(votes);
    expect(result.confidence).toBeCloseTo(0.7);
  });
});

// ---------------------------------------------------------------------------
// VerificationCriticRunner
// ---------------------------------------------------------------------------

describe("VerificationCriticRunner", () => {
  let runner: VerificationCriticRunner;

  beforeEach(() => {
    runner = new VerificationCriticRunner();
  });

  it("runs a single registered critic", async () => {
    runner.register(COMPLETENESS_CRITIC);
    const result = await runner.run({
      task: "Explain the deploy flow",
      output: "Deploy: 1. Build. 2. Deploy to production. Rollback on failure.",
    });
    expect(result.criticResults).toHaveLength(1);
    expect(result.criticResults[0]?.agentId).toBe("builtin-completeness");
    expect(result.overallVerdict).toBe("pass");
  });

  it("detects placeholder language via COMPLETENESS_CRITIC", async () => {
    runner.register(COMPLETENESS_CRITIC);
    const result = await runner.run({
      task: "Describe the rollback process",
      output: "TODO: fill this in later.",
    });
    expect(result.overallVerdict).toBe("fail");
    expect(result.criticResults[0]?.findings.some((f) => f.includes("placeholder"))).toBe(true);
  });

  it("detects overconfident claims via HALLUCINATION_CRITIC", async () => {
    runner.register(HALLUCINATION_CRITIC);
    const result = await runner.run({
      task: "Explain the deploy flow",
      output: "This is guaranteed to work and never fails under any circumstance.",
    });
    expect(result.overallVerdict).toBe("warn");
    expect(result.criticResults[0]?.findings.length).toBeGreaterThan(0);
  });

  it("checks task relevance via RELEVANCE_CRITIC", async () => {
    runner.register(RELEVANCE_CRITIC);
    const result = await runner.run({
      task: "provide deployment steps and rollback plan",
      output: "Lorem ipsum dolor sit amet consectetur adipiscing elit.",
    });
    expect(result.overallVerdict).toBe("fail");
  });

  it("aggregates multiple critics with consensus", async () => {
    runner.register(COMPLETENESS_CRITIC);
    runner.register(HALLUCINATION_CRITIC);
    runner.register(RELEVANCE_CRITIC);
    const result = await runner.run({
      task: "describe deployment rollback plan",
      output: "Deployment:\n1. Build artifact.\n2. Deploy to staging.\n3. Rollback: revert artifact on health check failure.",
    });
    expect(result.criticResults).toHaveLength(3);
    expect(["pass", "warn"]).toContain(result.overallVerdict);
  });

  it("runs only specified critic ids", async () => {
    runner.register(COMPLETENESS_CRITIC);
    runner.register(HALLUCINATION_CRITIC);
    const result = await runner.run(
      { task: "task", output: "good enough output that satisfies the task" },
      { ids: ["builtin-completeness"] },
    );
    expect(result.criticResults).toHaveLength(1);
    expect(result.criticResults[0]?.agentId).toBe("builtin-completeness");
  });

  it("handles critic that throws without crashing", async () => {
    runner.register({
      id: "broken-critic",
      name: "Broken",
      fn: () => {
        throw new Error("Critic error");
      },
    });
    const result = await runner.run({ task: "t", output: "o" });
    expect(result.overallVerdict).toBe("fail");
    expect(result.criticResults[0]?.findings.some((f) => f.includes("errored"))).toBe(true);
  });

  it("unregisters a critic", async () => {
    runner.register(COMPLETENESS_CRITIC);
    expect(runner.unregister("builtin-completeness")).toBe(true);
    expect(runner.listIds()).toHaveLength(0);
  });

  it("returns empty debate for no critics", async () => {
    const result = await runner.run({ task: "t", output: "o" });
    expect(result.criticResults).toHaveLength(0);
    expect(result.consensus.verdict).toBe("pass");
  });
});
