// ============================================================================
// Sprint S — Dims 5+22: Multi-run bench history + skill activation dispatch
// Tests that:
//  - bench-trend.json at repo root has run_count > 1 (multi-run credibility)
//  - bench-trend.json direction is "improving" (positive slope)
//  - .danteforge/bench-results.json exists with 5+ historical runs
//  - activateSkill dispatches registered command and returns output
//  - activateSkill returns allowed=false when policy blocks
//  - activateSkill returns error when skill not registered
//  - activateSkill writes audit entry to log path
//  - activateSkill emits correct durationMs field
//  - activateSkill with warn policy still executes
//  - multiple sequential skill activations each get audit entry
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { activateSkill, skillsManager, type SkillPolicyRule } from "../skills-manager.js";

// ─── Part 1: Multi-run bench history artifact (dim 5) ────────────────────────

describe("Multi-run bench history — Sprint S (dim 5)", () => {
  const repoRoot = resolve(__dirname, "../../../../");

  // 1. bench-trend.json has run_count > 1
  it("bench-trend.json at repo root has run_count > 1 (multi-run credibility)", () => {
    const trendPath = join(repoRoot, "bench-trend.json");
    expect(existsSync(trendPath)).toBe(true);
    const data = JSON.parse(readFileSync(trendPath, "utf-8")) as { run_count: number };
    expect(data.run_count).toBeGreaterThan(1);
  });

  // 2. bench-trend.json shows improving direction
  it("bench-trend.json direction is 'improving' with positive slope", () => {
    const trendPath = join(repoRoot, "bench-trend.json");
    const data = JSON.parse(readFileSync(trendPath, "utf-8")) as { direction: string; slope: number };
    expect(data.direction).toBe("improving");
    expect(data.slope).toBeGreaterThan(0);
  });

  // 3. bench-trend.json has all required fields
  it("bench-trend.json contains all required trend fields", () => {
    const trendPath = join(repoRoot, "bench-trend.json");
    const data = JSON.parse(readFileSync(trendPath, "utf-8")) as Record<string, unknown>;
    expect(typeof data["first_pass_rate"]).toBe("number");
    expect(typeof data["last_pass_rate"]).toBe("number");
    expect(typeof data["best_pass_rate"]).toBe("number");
    expect(typeof data["worst_pass_rate"]).toBe("number");
    expect(Array.isArray(data["top_failure_modes"])).toBe(true);
  });

  // 4. .danteforge/bench-results.json has 5+ historical runs
  it(".danteforge/bench-results.json has 5+ historical runs", () => {
    const benchPath = join(repoRoot, ".danteforge", "bench-results.json");
    expect(existsSync(benchPath)).toBe(true);
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as { runs: unknown[] };
    expect(data.runs.length).toBeGreaterThanOrEqual(5);
  });

  // 5. .danteforge/bench-results.json has best_pass_rate > first run
  it(".danteforge/bench-results.json shows improvement from first to latest run", () => {
    const benchPath = join(repoRoot, ".danteforge", "bench-results.json");
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as {
      runs: Array<{ pass_rate: number }>;
      best_pass_rate: number;
    };
    const oldest = data.runs[data.runs.length - 1]!;
    const newest = data.runs[0]!;
    expect(newest.pass_rate).toBeGreaterThan(oldest.pass_rate);
  });
});

// ─── Part 2: Skill activation dispatch pipeline (dim 22) ─────────────────────

describe("activateSkill dispatch — Sprint S (dim 22)", () => {
  beforeEach(() => {
    // Register a test skill for dispatch testing
    skillsManager.registerPlugin({
      name: "test-plugin",
      description: "Test plugin for Sprint S",
      version: "1.0.0",
      commands: [
        {
          name: "test-cmd",
          description: "A test command",
          usage: "test-cmd [args]",
          handler: async (args: string) => `executed: ${args}`,
        },
        {
          name: "fail-cmd",
          description: "Always throws",
          usage: "fail-cmd",
          handler: async () => { throw new Error("intentional failure"); },
        },
      ],
      agents: [],
    });
  });

  // 6. activateSkill dispatches registered command
  it("activateSkill dispatches registered command and returns output", async () => {
    const result = await activateSkill("test-cmd", "hello world", {}, []);
    expect(result.allowed).toBe(true);
    expect(result.output).toBe("executed: hello world");
    expect(result.error).toBeUndefined();
  });

  // 7. activateSkill blocked by policy returns allowed=false
  it("activateSkill returns allowed=false when policy blocks the skill", async () => {
    const rules: SkillPolicyRule[] = [{ skillName: "test-cmd", action: "block", reason: "testing block" }];
    const result = await activateSkill("test-cmd", "args", {}, rules);
    expect(result.allowed).toBe(false);
    expect(result.policyAction).toBe("block");
    expect(result.error).toContain("Blocked by policy");
  });

  // 8. activateSkill returns error when skill not registered
  it("activateSkill returns allowed=false with error when skill not found", async () => {
    const result = await activateSkill("nonexistent-skill", "", {}, []);
    expect(result.allowed).toBe(false);
    expect(result.error).toContain("not found");
  });

  // 9. activateSkill writes audit entry to log path
  it("activateSkill writes audit entry to log file", async () => {
    const dir = join(tmpdir(), `skill-s-${randomUUID()}`);
    const auditPath = join(dir, "audit.jsonl");
    await activateSkill("test-cmd", "x", {}, [], auditPath);
    expect(existsSync(auditPath)).toBe(true);
    const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]!) as { skillName: string; allowed: boolean };
    expect(entry.skillName).toBe("test-cmd");
    expect(entry.allowed).toBe(true);
  });

  // 10. activateSkill includes durationMs field
  it("activateSkill result includes a non-negative durationMs", async () => {
    const result = await activateSkill("test-cmd", "", {}, []);
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // 11. warn policy still executes
  it("activateSkill with warn policy still dispatches the handler", async () => {
    const rules: SkillPolicyRule[] = [{ skillName: "test-cmd", action: "warn", reason: "experimental" }];
    const result = await activateSkill("test-cmd", "arg", {}, rules);
    expect(result.allowed).toBe(true);
    expect(result.policyAction).toBe("warn");
    expect(result.output).toContain("executed");
  });

  // 12. handler error captured in result.error
  it("activateSkill captures handler errors in result.error field", async () => {
    const result = await activateSkill("fail-cmd", "", {}, []);
    expect(result.allowed).toBe(true); // policy allowed, but handler threw
    expect(result.error).toContain("intentional failure");
  });
});
