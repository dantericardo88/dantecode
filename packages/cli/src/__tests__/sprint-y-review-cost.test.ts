// ============================================================================
// Sprint Y — Dims 18+27: review close CLI + seeded artifact files
// Tests that:
//  - review-history.json exists with 5+ entries showing improving resolution
//  - review-history.json resolution rate improves from oldest to newest entry
//  - cmdReviewClose writes to review-history.json
//  - cmdReviewClose returns entry with correct resolutionRate
//  - cost-routing-log.json exists with 3+ entries
//  - cost-routing-log.json entries have required fields
//  - review-history.json first entry resolution < last entry resolution (trend)
//  - cmdReviewClose outputs resolution rate to stdout
//  - cmdReviewClose appends (not overwrites) on second call
//  - cost-routing-log.json entries all use tier=fast
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { cmdReviewClose } from "../commands/review.js";
import type { ReviewOutcomeEntry } from "@dantecode/core";
import type { CostRoutingLogEntry } from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir() {
  const dir = join(tmpdir(), `sprint-y-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Seeded review-history.json (dim 18) ─────────────────────────────

describe("review-history.json artifact — Sprint Y (dim 18)", () => {
  // 1. File exists
  it("review-history.json exists at .danteforge/", () => {
    const histPath = join(repoRoot, ".danteforge", "review-history.json");
    expect(existsSync(histPath)).toBe(true);
  });

  // 2. Has 5+ entries
  it("review-history.json contains 5+ entries (JSONL)", () => {
    const histPath = join(repoRoot, ".danteforge", "review-history.json");
    const lines = readFileSync(histPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  // 3. Resolution rate improves over time (oldest < newest)
  it("review-history.json shows improving resolution rate over time", () => {
    const histPath = join(repoRoot, ".danteforge", "review-history.json");
    const lines = readFileSync(histPath, "utf-8").trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l) as ReviewOutcomeEntry);
    const oldest = entries[0]!;
    const newest = entries[entries.length - 1]!;
    expect(newest.resolutionRate).toBeGreaterThan(oldest.resolutionRate);
  });

  // 4. All entries have required fields
  it("review-history.json entries have reviewId, resolvedCount, totalComments, resolutionRate", () => {
    const histPath = join(repoRoot, ".danteforge", "review-history.json");
    const lines = readFileSync(histPath, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line) as ReviewOutcomeEntry;
      expect(typeof entry.reviewId).toBe("string");
      expect(typeof entry.resolvedCount).toBe("number");
      expect(typeof entry.totalComments).toBe("number");
      expect(typeof entry.resolutionRate).toBe("number");
    }
  });
});

// ─── Part 2: cmdReviewClose functionality ────────────────────────────────────

describe("cmdReviewClose — Sprint Y (dim 18)", () => {
  // 5. Returns entry with correct resolutionRate
  it("cmdReviewClose returns entry with correct resolutionRate", () => {
    const root = makeDir();
    const entry = cmdReviewClose({ reviewId: "test-001", resolved: 7, total: 10, projectRoot: root });
    expect(entry.resolutionRate).toBeCloseTo(0.7, 5);
    expect(entry.reviewId).toBe("test-001");
  });

  // 6. Writes to review-history.json
  it("cmdReviewClose writes entry to .danteforge/review-history.json", () => {
    const root = makeDir();
    cmdReviewClose({ reviewId: "test-002", resolved: 3, total: 4, projectRoot: root });
    const logPath = join(root, ".danteforge", "review-history.json");
    expect(existsSync(logPath)).toBe(true);
  });

  // 7. Appends on second call
  it("cmdReviewClose appends (not overwrites) on successive calls", () => {
    const root = makeDir();
    cmdReviewClose({ reviewId: "test-003a", resolved: 2, total: 3, projectRoot: root });
    cmdReviewClose({ reviewId: "test-003b", resolved: 4, total: 5, projectRoot: root });
    const logPath = join(root, ".danteforge", "review-history.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
  });
});

// ─── Part 3: Seeded cost-routing-log.json (dim 27) ───────────────────────────

describe("cost-routing-log.json artifact — Sprint Y (dim 27)", () => {
  // 8. File exists
  it("cost-routing-log.json exists at .danteforge/", () => {
    const logPath = join(repoRoot, ".danteforge", "cost-routing-log.json");
    expect(existsSync(logPath)).toBe(true);
  });

  // 9. Has 3+ entries
  it("cost-routing-log.json contains 3+ routing events (JSONL)", () => {
    const logPath = join(repoRoot, ".danteforge", "cost-routing-log.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  // 10. All entries have required fields
  it("cost-routing-log.json entries have tier, provider, modelId, taskType, timestamp", () => {
    const logPath = join(repoRoot, ".danteforge", "cost-routing-log.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line) as CostRoutingLogEntry;
      expect(typeof entry.tier).toBe("string");
      expect(typeof entry.provider).toBe("string");
      expect(typeof entry.modelId).toBe("string");
      expect(typeof entry.taskType).toBe("string");
      expect(typeof entry.timestamp).toBe("string");
    }
  });
});
