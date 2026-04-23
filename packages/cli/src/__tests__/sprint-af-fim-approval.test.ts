// ============================================================================
// Sprint AF — Dims 1+13: FIM Acceptance Tracker + ApprovalThreadTracker
// Tests that:
//  - recordFimAcceptance updates fim-acceptance-history.json
//  - getLanguageAcceptanceRate returns correct rate after recording
//  - loadFimAcceptanceHistory reads all entries
//  - recordFimAcceptance is cumulative (rate improves with more accepts)
//  - ApprovalThreadTracker addThread / resolveThread work correctly
//  - ApprovalThreadTracker.getResolutionRate() computes correctly
//  - ApprovalThreadTracker.persist() writes to approval-threads.json
//  - loadApprovalThreads reads seeded entries
//  - seeded approval-threads.json exists with 5+ entries
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  recordFimAcceptance,
  getLanguageAcceptanceRate,
  loadFimAcceptanceHistory,
  ApprovalThreadTracker,
  loadApprovalThreads,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-af-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: FIM Acceptance Tracker ──────────────────────────────────────────

describe("FIM Acceptance Tracker — Sprint AF (dim 1)", () => {
  // 1. recordFimAcceptance creates fim-acceptance-history.json
  it("recordFimAcceptance creates fim-acceptance-history.json", () => {
    const dir = makeDir();
    recordFimAcceptance("typescript", true, {}, dir);
    expect(existsSync(join(dir, ".danteforge", "fim-acceptance-history.json"))).toBe(true);
  });

  // 2. getLanguageAcceptanceRate returns 1.0 after single accepted completion
  it("getLanguageAcceptanceRate returns 1.0 after single accept", () => {
    const dir = makeDir();
    recordFimAcceptance("python", true, {}, dir);
    expect(getLanguageAcceptanceRate("python", dir)).toBe(1.0);
  });

  // 3. Rate is 0.0 after single rejection
  it("getLanguageAcceptanceRate returns 0.0 after single reject", () => {
    const dir = makeDir();
    recordFimAcceptance("rust", false, {}, dir);
    expect(getLanguageAcceptanceRate("rust", dir)).toBe(0.0);
  });

  // 4. Rate is cumulative (2 accepts + 1 reject = 0.67)
  it("acceptance rate is cumulative across calls", () => {
    const dir = makeDir();
    recordFimAcceptance("go", true, {}, dir);
    recordFimAcceptance("go", true, {}, dir);
    recordFimAcceptance("go", false, {}, dir);
    const rate = getLanguageAcceptanceRate("go", dir);
    expect(rate).toBeCloseTo(2 / 3, 1);
  });

  // 5. loadFimAcceptanceHistory returns all languages
  it("loadFimAcceptanceHistory returns all recorded languages", () => {
    const dir = makeDir();
    recordFimAcceptance("typescript", true, {}, dir);
    recordFimAcceptance("python", true, {}, dir);
    const history = loadFimAcceptanceHistory(dir);
    const langs = history.map((h) => h.language);
    expect(langs).toContain("typescript");
    expect(langs).toContain("python");
  });
});

// ─── Part 2: ApprovalThreadTracker ───────────────────────────────────────────

describe("ApprovalThreadTracker — Sprint AF (dim 13)", () => {
  // 6. addThread returns a threadId
  it("addThread returns a non-empty threadId", () => {
    const dir = makeDir();
    const tracker = new ApprovalThreadTracker("rev-test-1", dir);
    const id = tracker.addThread({ comment: "Fix the null check", filePath: "src/auth.ts", line: 30 });
    expect(id).toBeTruthy();
    expect(id.startsWith("thread-")).toBe(true);
  });

  // 7. resolveThread marks thread resolved
  it("resolveThread marks the thread as resolved", () => {
    const dir = makeDir();
    const tracker = new ApprovalThreadTracker("rev-test-2", dir);
    const id = tracker.addThread({ comment: "Add error handling" });
    expect(tracker.getPendingThreads()).toHaveLength(1);
    tracker.resolveThread(id);
    expect(tracker.getPendingThreads()).toHaveLength(0);
  });

  // 8. getResolutionRate computes correctly
  it("getResolutionRate is 0.5 when 1 of 2 threads resolved", () => {
    const dir = makeDir();
    const tracker = new ApprovalThreadTracker("rev-test-3", dir);
    const id1 = tracker.addThread({ comment: "Thread one" });
    tracker.addThread({ comment: "Thread two" });
    tracker.resolveThread(id1);
    expect(tracker.getResolutionRate()).toBeCloseTo(0.5, 5);
  });

  // 9. persist() writes to approval-threads.json
  it("persist() writes to .danteforge/approval-threads.json", () => {
    const dir = makeDir();
    const tracker = new ApprovalThreadTracker("rev-persist-1", dir);
    tracker.addThread({ comment: "Review thread" });
    tracker.persist("feat: test PR");
    expect(existsSync(join(dir, ".danteforge", "approval-threads.json"))).toBe(true);
  });

  // 10. Seeded approval-threads.json exists with 5+ entries
  it("seeded approval-threads.json has 5+ entries", () => {
    const logPath = join(repoRoot, ".danteforge", "approval-threads.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  // 11. loadApprovalThreads reads seeded entries
  it("loadApprovalThreads reads from approval-threads.json", () => {
    const dir = makeDir();
    const tracker = new ApprovalThreadTracker("rev-load-1", dir);
    tracker.addThread({ comment: "Needs fixing" });
    tracker.persist("test PR");
    const records = loadApprovalThreads(dir);
    expect(records.length).toBeGreaterThan(0);
    expect(records[0]?.reviewId).toBe("rev-load-1");
  });
});
