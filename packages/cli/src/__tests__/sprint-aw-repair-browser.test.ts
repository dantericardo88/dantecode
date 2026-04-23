// ============================================================================
// Sprint AW — Dims 10+17: Full-app repair loop + browser task success rate
// Tests that:
//  - repairAndRetry calls gateFn for each attempt
//  - repairAndRetry returns finallyPassed: true when gate passes on retry
//  - repairAndRetry injects [Repair hint] comment into content
//  - repairAndRetry stops after maxAttempts when gate never passes
//  - repairAndRetry returns attemptsMade: 1 when gate passes immediately
//  - BrowserTaskOutcomeTracker records and aggregates success rate
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { repairAndRetry, BrowserTaskOutcomeTracker } from "@dantecode/core";
import type { GenerationFileSpec } from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-aw-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("repairAndRetry — Sprint AW (dim 10)", () => {
  // 1. gateFn called for each attempt
  it("calls gateFn for each attempted file", async () => {
    const gateCalls: string[] = [];
    const files: GenerationFileSpec[] = [{ filePath: "/tmp/x.ts", content: "export const x = 1;" }];
    const writeFn = async (_s: GenerationFileSpec) => {};
    const gate = async (fp: string) => { gateCalls.push(fp); return true; };
    await repairAndRetry(files, "compile error", writeFn, gate);
    expect(gateCalls.length).toBeGreaterThanOrEqual(1);
  });

  // 2. returns finallyPassed: true when gate passes on retry
  it("returns finallyPassed: true when gate passes on the second attempt", async () => {
    let attempt = 0;
    const files: GenerationFileSpec[] = [{ filePath: "/tmp/a.ts", content: "export const a = 1;" }];
    const writeFn = async (_s: GenerationFileSpec) => {};
    const gate = async (_fp: string) => { attempt++; return attempt >= 2; };
    const result = await repairAndRetry(files, "type error", writeFn, gate, 3);
    expect(result.finallyPassed).toBe(true);
    expect(result.attemptsMade).toBe(2);
  });

  // 3. injects [Repair hint] comment into content
  it("injects [Repair hint] comment into file content on first retry", async () => {
    const written: string[] = [];
    const files: GenerationFileSpec[] = [{ filePath: "/tmp/b.ts", content: "const b = 1;" }];
    const writeFn = async (s: GenerationFileSpec) => { written.push(s.content); };
    const gate = async (_fp: string) => false;
    await repairAndRetry(files, "TS2345: error message here", writeFn, gate, 2);
    expect(written.some((c) => c.includes("[Repair hint]"))).toBe(true);
    expect(written.some((c) => c.includes("TS2345"))).toBe(true);
  });

  // 4. stops after maxAttempts when gate never passes
  it("stops after maxAttempts when gate never passes", async () => {
    let gateCallCount = 0;
    const files: GenerationFileSpec[] = [{ filePath: "/tmp/c.ts", content: "const c = 1;" }];
    const writeFn = async (_s: GenerationFileSpec) => {};
    const gate = async (_fp: string) => { gateCallCount++; return false; };
    const result = await repairAndRetry(files, "error", writeFn, gate, 2);
    expect(result.finallyPassed).toBe(false);
    expect(result.attemptsMade).toBe(2);
    expect(gateCallCount).toBe(2);
  });

  // 5. returns attemptsMade: 1 when gate passes immediately
  it("returns attemptsMade: 1 when gate passes on first attempt", async () => {
    const files: GenerationFileSpec[] = [{ filePath: "/tmp/d.ts", content: "const d = 1;" }];
    const writeFn = async (_s: GenerationFileSpec) => {};
    const gate = async (_fp: string) => true;
    const result = await repairAndRetry(files, "any error", writeFn, gate);
    expect(result.finallyPassed).toBe(true);
    expect(result.attemptsMade).toBe(1);
  });
});

describe("BrowserTaskOutcomeTracker — Sprint AW (dim 17)", () => {
  // 6. recordTaskOutcome creates .danteforge/browser-task-outcomes.json
  it("recordTaskOutcome creates .danteforge/browser-task-outcomes.json", () => {
    const dir = makeDir();
    const tracker = new BrowserTaskOutcomeTracker(dir);
    tracker.recordTaskOutcome("https://example.com", "log in", true, 4, 4);
    expect(existsSync(join(dir, ".danteforge", "browser-task-outcomes.json"))).toBe(true);
  });

  // 7. getSuccessRate returns 0.75 for 3/4 succeeded
  it("getSuccessRate returns 0.75 for 3 succeeded out of 4 total", () => {
    const dir = makeDir();
    const tracker = new BrowserTaskOutcomeTracker(dir);
    tracker.recordTaskOutcome("https://a.com", "task1", true, 3, 3);
    tracker.recordTaskOutcome("https://b.com", "task2", true, 4, 4);
    tracker.recordTaskOutcome("https://c.com", "task3", true, 5, 5);
    tracker.recordTaskOutcome("https://d.com", "task4", false, 2, 7);
    expect(tracker.getSuccessRate()).toBeCloseTo(0.75, 5);
  });

  // 8. load reads seeded entries correctly
  it("load() reads entries written by recordTaskOutcome", () => {
    const dir = makeDir();
    const tracker = new BrowserTaskOutcomeTracker(dir);
    tracker.recordTaskOutcome("https://x.com", "search products", true, 6, 6);
    tracker.recordTaskOutcome("https://y.com", "fill form", false, 1, 5);
    const loaded = tracker.load();
    expect(loaded.length).toBe(2);
    expect(loaded[0]!.taskDescription).toBe("search products");
    expect(loaded[1]!.succeeded).toBe(false);
  });

  // 9. getSuccessRate returns 0 when no entries
  it("getSuccessRate returns 0 when no entries have been recorded", () => {
    const dir = makeDir();
    const tracker = new BrowserTaskOutcomeTracker(dir);
    expect(tracker.getSuccessRate()).toBe(0);
  });
});
