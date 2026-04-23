// ============================================================================
// Sprint AH — Dims 22+5: PluginOutcomeTracker + BenchTrend
// Tests that:
//  - recordPluginOutcome writes to .danteforge/plugin-outcomes.json
//  - summarizePluginOutcomes successRate computed correctly
//  - summarizePluginOutcomes identifies topCommands
//  - summarizePluginOutcomes handles empty input
//  - loadPluginOutcomes reads entries back
//  - seeded plugin-outcomes.json exists with 5+ entries
//  - PluginOutcomeTracker.runTracked records success
//  - PluginOutcomeTracker.runTracked records failure on throw
//  - bench-trend.json exists at repo root with direction field
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  recordPluginOutcome,
  loadPluginOutcomes,
  summarizePluginOutcomes,
  PluginOutcomeTracker,
  type PluginOutcomeEntry,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ah-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: PluginOutcomeTracker ─────────────────────────────────────────────

describe("PluginOutcomeTracker — Sprint AH (dim 22)", () => {
  // 1. recordPluginOutcome writes file
  it("recordPluginOutcome writes to .danteforge/plugin-outcomes.json", () => {
    const dir = makeDir();
    recordPluginOutcome({ pluginId: "dante-test", commandId: "dante-test:run", status: "success", durationMs: 1000 }, dir);
    expect(existsSync(join(dir, ".danteforge", "plugin-outcomes.json"))).toBe(true);
  });

  // 2. summarizePluginOutcomes successRate
  it("summarizePluginOutcomes computes successRate correctly", () => {
    const entries: PluginOutcomeEntry[] = [
      { timestamp: "t", pluginId: "p1", commandId: "cmd1", status: "success", durationMs: 100 },
      { timestamp: "t", pluginId: "p1", commandId: "cmd1", status: "failure", durationMs: 200 },
    ];
    expect(summarizePluginOutcomes(entries).successRate).toBe(0.5);
  });

  // 3. summarizePluginOutcomes topCommands sorted by frequency
  it("summarizePluginOutcomes topCommands most-used first", () => {
    const entries: PluginOutcomeEntry[] = [
      { timestamp: "t", pluginId: "p1", commandId: "run", status: "success", durationMs: 100 },
      { timestamp: "t", pluginId: "p1", commandId: "run", status: "success", durationMs: 100 },
      { timestamp: "t", pluginId: "p1", commandId: "list", status: "success", durationMs: 50 },
    ];
    const summary = summarizePluginOutcomes(entries);
    expect(summary.topCommands[0]).toBe("run");
  });

  // 4. summarizePluginOutcomes handles empty
  it("summarizePluginOutcomes handles empty input", () => {
    const summary = summarizePluginOutcomes([]);
    expect(summary.totalInvocations).toBe(0);
    expect(summary.successRate).toBe(0);
  });

  // 5. loadPluginOutcomes reads entries
  it("loadPluginOutcomes reads back written entries", () => {
    const dir = makeDir();
    recordPluginOutcome({ pluginId: "dante-review", commandId: "dante-review:list", status: "success", durationMs: 80 }, dir);
    const entries = loadPluginOutcomes(dir);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.commandId).toBe("dante-review:list");
  });

  // 6. seeded plugin-outcomes.json has 5+ entries
  it("seeded plugin-outcomes.json exists at .danteforge/ with 5+ entries", () => {
    const logPath = join(repoRoot, ".danteforge", "plugin-outcomes.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  // 7. PluginOutcomeTracker.runTracked records success
  it("PluginOutcomeTracker.runTracked records success outcome", async () => {
    const dir = makeDir();
    const tracker = new PluginOutcomeTracker(dir);
    await tracker.runTracked("my-plugin", "my-cmd:run", async () => "ok");
    const entries = loadPluginOutcomes(dir);
    expect(entries[0]?.status).toBe("success");
    expect(entries[0]?.commandId).toBe("my-cmd:run");
  });

  // 8. PluginOutcomeTracker.runTracked records failure on throw
  it("PluginOutcomeTracker.runTracked records failure when function throws", async () => {
    const dir = makeDir();
    const tracker = new PluginOutcomeTracker(dir);
    await expect(
      tracker.runTracked("my-plugin", "my-cmd:fail", async () => { throw new Error("test failure"); }),
    ).rejects.toThrow("test failure");
    const entries = loadPluginOutcomes(dir);
    expect(entries[0]?.status).toBe("failure");
    expect(entries[0]?.errorMessage).toContain("test failure");
  });
});

// ─── Part 2: bench-trend.json artifact ───────────────────────────────────────

describe("bench-trend.json artifact — Sprint AH (dim 5)", () => {
  // 9. bench-trend.json exists at repo root
  it("bench-trend.json exists at repo root with direction field", () => {
    const trendPath = join(repoRoot, "bench-trend.json");
    expect(existsSync(trendPath)).toBe(true);
    const trend = JSON.parse(readFileSync(trendPath, "utf-8")) as Record<string, unknown>;
    expect(typeof trend["direction"]).toBe("string");
    expect(["improving", "stable", "degrading"]).toContain(trend["direction"]);
  });
});
