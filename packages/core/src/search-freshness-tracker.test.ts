import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { SearchFreshnessTracker } from "./search-freshness-tracker.js";

const NOW = 1_700_000_000_000;
const ONE_HOUR = 3_600_000;
const ONE_DAY = 24 * ONE_HOUR;
const SEVEN_DAYS = 7 * ONE_DAY;

describe("SearchFreshnessTracker", () => {
  it("tracks results and detects staleness by content type TTL", () => {
    const tracker = new SearchFreshnessTracker({ nowFn: () => NOW });
    tracker.track("vitest config", "r1", NOW - ONE_HOUR, "documentation");
    expect(tracker.isStale("r1")).toBe(false);

    // After 8 days, documentation should be stale (7-day TTL)
    const later = new SearchFreshnessTracker({ nowFn: () => NOW + 8 * ONE_DAY });
    later.track("vitest config", "r1", NOW, "documentation");
    expect(later.isStale("r1")).toBe(true);
  });

  it("news has shorter TTL (24h) than documentation (7d)", () => {
    // News 25 hours old -> stale
    const tracker = new SearchFreshnessTracker({ nowFn: () => NOW });
    tracker.track("breaking news", "n1", NOW - 25 * ONE_HOUR, "news");
    expect(tracker.isStale("n1")).toBe(true);

    // Documentation 25 hours old -> NOT stale
    tracker.track("docs query", "d1", NOW - 25 * ONE_HOUR, "documentation");
    expect(tracker.isStale("d1")).toBe(false);
  });

  it("code has longest TTL (30 days)", () => {
    const tracker = new SearchFreshnessTracker({ nowFn: () => NOW });
    tracker.track("code query", "c1", NOW - 20 * ONE_DAY, "code");
    expect(tracker.isStale("c1")).toBe(false);

    tracker.track("code query", "c2", NOW - 35 * ONE_DAY, "code");
    expect(tracker.isStale("c2")).toBe(true);
  });

  it("evictStale removes and returns stale entry IDs", () => {
    const tracker = new SearchFreshnessTracker({ nowFn: () => NOW });
    tracker.track("q", "fresh", NOW - ONE_HOUR, "documentation");
    tracker.track("q", "stale", NOW - SEVEN_DAYS - ONE_HOUR, "documentation");
    tracker.track("q", "very-stale", NOW - 30 * ONE_DAY, "documentation");

    const evicted = tracker.evictStale();
    expect(evicted).toContain("stale");
    expect(evicted).toContain("very-stale");
    expect(evicted).not.toContain("fresh");
    expect(tracker.size).toBe(1);
    expect(tracker.has("fresh")).toBe(true);
  });

  it("forceRefresh marks all results for a query as stale", () => {
    const tracker = new SearchFreshnessTracker({ nowFn: () => NOW });
    tracker.track("query-a", "r1", NOW - ONE_HOUR, "documentation");
    tracker.track("query-a", "r2", NOW - ONE_HOUR, "documentation");
    tracker.track("query-b", "r3", NOW - ONE_HOUR, "documentation");

    expect(tracker.isStale("r1")).toBe(false);
    tracker.forceRefresh("query-a");
    expect(tracker.isStale("r1")).toBe(true);
    expect(tracker.isStale("r2")).toBe(true);
    expect(tracker.isStale("r3")).toBe(false); // different query
  });

  it("custom TTL override via constructor options", () => {
    const tracker = new SearchFreshnessTracker({
      nowFn: () => NOW,
      ttls: { news: ONE_HOUR }, // override news TTL to 1 hour
    });
    tracker.track("q", "r1", NOW - 2 * ONE_HOUR, "news");
    expect(tracker.isStale("r1")).toBe(true);
    expect(tracker.getTtl("news")).toBe(ONE_HOUR);
  });

  it("isStale returns false for untracked resultId", () => {
    const tracker = new SearchFreshnessTracker({ nowFn: () => NOW });
    expect(tracker.isStale("nonexistent")).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Disk persistence
  // ──────────────────────────────────────────────────────────────────────────

  describe("disk persistence", () => {
    let testDir: string;
    let persistPath: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `freshness-test-${randomUUID().slice(0, 8)}`);
      mkdirSync(testDir, { recursive: true });
      persistPath = join(testDir, "freshness.json");
    });

    afterEach(() => {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // cleanup best-effort
      }
    });

    it("track() persists to file", () => {
      const t1 = new SearchFreshnessTracker({ nowFn: () => NOW, persistPath });
      t1.track("vitest docs", "r1", NOW - ONE_HOUR, "documentation");
      t1.track("vitest docs", "r2", NOW - 2 * ONE_HOUR, "documentation");

      // New instance loads from disk
      const t2 = new SearchFreshnessTracker({ nowFn: () => NOW, persistPath });
      expect(t2.size).toBe(2);
      expect(t2.has("r1")).toBe(true);
      expect(t2.has("r2")).toBe(true);
    });

    it("isStale() works after restart", () => {
      const t1 = new SearchFreshnessTracker({ nowFn: () => NOW, persistPath });
      t1.track("news query", "n1", NOW - 25 * ONE_HOUR, "news");
      t1.track("docs query", "d1", NOW - 25 * ONE_HOUR, "documentation");

      // New instance loads from disk and can check staleness
      const t2 = new SearchFreshnessTracker({ nowFn: () => NOW, persistPath });
      expect(t2.isStale("n1")).toBe(true);  // news TTL is 24h, 25h old
      expect(t2.isStale("d1")).toBe(false); // docs TTL is 7d, 25h old
    });

    it("evictStale() updates file on disk", () => {
      const t1 = new SearchFreshnessTracker({ nowFn: () => NOW, persistPath });
      t1.track("q", "fresh", NOW - ONE_HOUR, "documentation");
      t1.track("q", "stale", NOW - SEVEN_DAYS - ONE_HOUR, "documentation");

      // Evict from first instance
      const evicted = t1.evictStale();
      expect(evicted).toContain("stale");

      // New instance should only see the fresh entry
      const t2 = new SearchFreshnessTracker({ nowFn: () => NOW, persistPath });
      expect(t2.size).toBe(1);
      expect(t2.has("fresh")).toBe(true);
      expect(t2.has("stale")).toBe(false);
    });
  });
});
