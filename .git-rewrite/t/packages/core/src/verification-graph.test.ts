import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VerificationGraph } from "./verification-graph.js";

describe("VerificationGraph", () => {
  let projectRoot = "";

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = "";
    }
  });

  it("runs a checkpoint-backed verification trace and can resume it from disk", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-verification-graph-"));
    const graph = new VerificationGraph(projectRoot);

    const result = await graph.run({
      traceId: "trace-deploy",
      task: "Provide deploy steps and rollback guidance",
      output: [
        "Steps",
        "1. Build the release.",
        "2. Deploy the release.",
        "Rollback",
        "Revert to the previous artifact if health checks fail.",
      ].join("\n"),
      criteria: {
        requiredKeywords: ["deploy", "rollback"],
        expectedSections: ["Steps", "Rollback"],
        minLength: 60,
      },
      criticOpinions: [
        { agentId: "critic-1", verdict: "pass", confidence: 0.8 },
        {
          agentId: "critic-2",
          verdict: "warn",
          confidence: 0.6,
          findings: ["Add health-check detail"],
        },
      ],
    });

    expect(result.traceId).toBe("trace-deploy");
    expect(result.trace.overallPassed).toBe(true);
    expect(result.trace.nodes).toHaveLength(4);
    expect(result.trace.debate?.consensus).toBe("warn");
    expect(result.eventCount).toBeGreaterThanOrEqual(6);

    const resumed = await graph.resume("trace-deploy");
    expect(resumed?.task).toBe("Provide deploy steps and rollback guidance");
    expect(resumed?.report.overallPassed).toBe(true);
    expect(resumed?.nodes.map((node) => node.stage)).toEqual([
      "syntactic",
      "semantic",
      "factual",
      "safety",
    ]);
  });

  it("fails the final graph verdict when critic consensus blocks the output", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-verification-graph-fail-"));
    const graph = new VerificationGraph(projectRoot);

    const result = await graph.run({
      task: "Summarize the release plan",
      output: "Summary:\nDeploy the service and rollback if needed.",
      criteria: {
        requiredKeywords: ["deploy", "rollback"],
        minLength: 30,
      },
      criticOpinions: [
        { agentId: "critic-1", verdict: "fail", confidence: 0.95, findings: ["Missing evidence"] },
        { agentId: "critic-2", verdict: "warn", confidence: 0.7 },
      ],
    });

    expect(result.trace.report.overallPassed).toBe(true);
    expect(result.trace.debate?.consensus).toBe("fail");
    expect(result.trace.overallPassed).toBe(false);
    expect(result.trace.summary.toLowerCase()).toContain("critic");
  });
});
