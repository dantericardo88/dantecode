// ============================================================================
// Sprint AX — Dims 6+27: Inline edit acceptance store + cost-per-success metric
// Tests that:
//  - InlineEditAcceptanceStore.recordAcceptance creates the artifact file
//  - getAcceptanceRate returns correct fraction
//  - load reads seeded entries correctly
//  - getAcceptanceRate returns 0 when no entries
//  - recordCostPerTaskOutcome creates cost-per-success-log.json
//  - loadCostPerTaskOutcomes reads and parses entries
//  - getCostPerSuccessRatio returns ratio < 1 when succeeded tasks cost less
//  - getCostPerSuccessRatio returns 0 ratio when no failed tasks
//  - getCostPerSuccessRatio returns 0 avgCostSucceeded when no succeeded tasks
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  InlineEditAcceptanceStore,
  recordCostPerTaskOutcome,
  loadCostPerTaskOutcomes,
  getCostPerSuccessRatio,
} from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ax-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("InlineEditAcceptanceStore — Sprint AX (dim 6)", () => {
  // 1. recordAcceptance creates inline-edit-acceptance.json
  it("recordAcceptance creates .danteforge/inline-edit-acceptance.json", () => {
    const dir = makeDir();
    const store = new InlineEditAcceptanceStore(dir);
    store.recordAcceptance("/src/auth.ts", "edit-001", true);
    expect(existsSync(join(dir, ".danteforge", "inline-edit-acceptance.json"))).toBe(true);
  });

  // 2. getAcceptanceRate returns 0.8 for 4/5 accepted
  it("getAcceptanceRate returns 0.8 for 4 accepted out of 5 total", () => {
    const dir = makeDir();
    const store = new InlineEditAcceptanceStore(dir);
    store.recordAcceptance("/src/a.ts", "e1", true);
    store.recordAcceptance("/src/b.ts", "e2", true);
    store.recordAcceptance("/src/c.ts", "e3", true);
    store.recordAcceptance("/src/d.ts", "e4", true);
    store.recordAcceptance("/src/e.ts", "e5", false);
    expect(store.getAcceptanceRate()).toBeCloseTo(0.8, 5);
  });

  // 3. load reads seeded entries correctly
  it("load() reads entries written by recordAcceptance", () => {
    const dir = makeDir();
    const store = new InlineEditAcceptanceStore(dir);
    store.recordAcceptance("/src/x.ts", "ex1", true);
    store.recordAcceptance("/src/y.ts", "ex2", false);
    const loaded = store.load();
    expect(loaded.length).toBe(2);
    expect(loaded[0]!.editId).toBe("ex1");
    expect(loaded[1]!.accepted).toBe(false);
  });

  // 4. getAcceptanceRate returns 0 when no entries
  it("getAcceptanceRate returns 0 when no entries have been recorded", () => {
    const dir = makeDir();
    const store = new InlineEditAcceptanceStore(dir);
    expect(store.getAcceptanceRate()).toBe(0);
  });
});

describe("recordCostPerTaskOutcome + getCostPerSuccessRatio — Sprint AX (dim 27)", () => {
  // 5. recordCostPerTaskOutcome creates cost-per-success-log.json
  it("recordCostPerTaskOutcome creates .danteforge/cost-per-success-log.json", () => {
    const dir = makeDir();
    recordCostPerTaskOutcome("sess-1", 0.05, true, dir);
    expect(existsSync(join(dir, ".danteforge", "cost-per-success-log.json"))).toBe(true);
  });

  // 6. loadCostPerTaskOutcomes reads and parses JSONL entries
  it("loadCostPerTaskOutcomes reads and parses entries correctly", () => {
    const dir = makeDir();
    recordCostPerTaskOutcome("s1", 0.04, true, dir);
    recordCostPerTaskOutcome("s2", 0.12, false, dir);
    const entries = loadCostPerTaskOutcomes(dir);
    expect(entries.length).toBe(2);
    expect(entries[0]!.totalCostUsd).toBeCloseTo(0.04, 5);
    expect(entries[1]!.taskSucceeded).toBe(false);
  });

  // 7. getCostPerSuccessRatio returns ratio < 1 when succeeded tasks cost less
  it("getCostPerSuccessRatio returns ratio < 1 when succeeded tasks cost less than failed", () => {
    const entries = [
      { sessionId: "s1", totalCostUsd: 0.05, taskSucceeded: true, timestamp: "" },
      { sessionId: "s2", totalCostUsd: 0.05, taskSucceeded: true, timestamp: "" },
      { sessionId: "s3", totalCostUsd: 0.05, taskSucceeded: true, timestamp: "" },
      { sessionId: "f1", totalCostUsd: 0.12, taskSucceeded: false, timestamp: "" },
      { sessionId: "f2", totalCostUsd: 0.12, taskSucceeded: false, timestamp: "" },
    ];
    const result = getCostPerSuccessRatio(entries);
    expect(result.ratio).toBeLessThan(1);
    expect(result.avgCostSucceeded).toBeCloseTo(0.05, 5);
    expect(result.avgCostFailed).toBeCloseTo(0.12, 5);
  });

  // 8. getCostPerSuccessRatio returns ratio=0 when no failed tasks
  it("getCostPerSuccessRatio returns ratio=0 when there are no failed tasks", () => {
    const entries = [
      { sessionId: "s1", totalCostUsd: 0.05, taskSucceeded: true, timestamp: "" },
    ];
    const result = getCostPerSuccessRatio(entries);
    expect(result.ratio).toBe(0);
    expect(result.avgCostFailed).toBe(0);
  });

  // 9. getCostPerSuccessRatio returns avgCostSucceeded=0 when no succeeded tasks
  it("getCostPerSuccessRatio returns avgCostSucceeded=0 when there are no succeeded tasks", () => {
    const entries = [
      { sessionId: "f1", totalCostUsd: 0.15, taskSucceeded: false, timestamp: "" },
    ];
    const result = getCostPerSuccessRatio(entries);
    expect(result.avgCostSucceeded).toBe(0);
    expect(result.avgCostFailed).toBeCloseTo(0.15, 5);
    expect(result.ratio).toBe(0);
  });
});
