// ============================================================================
// @dantecode/cli — stress-test command unit tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { runStressTest } from "./stress-test.js";

describe("runStressTest", () => {
  it("runs self-validation mode and produces pass@1 output", async () => {
    const output = await runStressTest("--instances 5", process.cwd());
    expect(output).toContain("pass@1");
    expect(output).toContain("Instances: 5");
    expect(output).toContain("self-validation");
  });

  it("parses --instances all flag and loads multiple instances", async () => {
    const output = await runStressTest("--instances all", process.cwd());
    // Should load all builtin instances (at least 20)
    expect(output).toMatch(/Instances: \d+/);
    expect(output).toContain("pass@1");
    // Verify more than 5 were loaded
    const match = output.match(/Instances: (\d+)/);
    if (match) expect(parseInt(match[1]!, 10)).toBeGreaterThanOrEqual(5);
  });

  it("uses provided agentRunner instead of reference patches", async () => {
    const agentCalls: string[] = [];
    const mockAgent = async (problem: string, _instanceId: string): Promise<string | null> => {
      agentCalls.push(problem);
      // Return the correct implementation for the first instance (truncate)
      if (problem.includes("truncate")) {
        return "function truncate(str, maxLen) { if (str.length <= maxLen) return str; return str.slice(0, maxLen - 3) + '...'; }";
      }
      return null;
    };

    const output = await runStressTest("--instances 3", process.cwd(), mockAgent);
    // agentRunner was called for each instance
    expect(agentCalls.length).toBe(3);
    // Output shows real agent mode
    expect(output).toContain("real agent");
  });

  it("saves report file to .dantecode/stress-test-results", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");

    const cwd = process.cwd();
    const output = await runStressTest("--instances 2", cwd);

    // Should mention a saved report path
    expect(output).toContain("Report saved");
    const resultsDir = join(cwd, ".dantecode/stress-test-results");
    expect(existsSync(resultsDir)).toBe(true);
  });

  it("outputs pass and fail markers per instance", async () => {
    const output = await runStressTest("--instances 5", process.cwd());
    // Each instance gets a ✓ or ✗ marker
    const checkmarks = (output.match(/[✓✗]/g) ?? []).length;
    expect(checkmarks).toBe(5);
  });
});
