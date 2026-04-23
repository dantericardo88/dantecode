// ============================================================================
// Sprint AL — Dims 5+17: SWE-bench Extended + Browser Session Persistence
// Tests that:
//  - saveBrowserSession writes to .danteforge/browser-sessions.json
//  - loadBrowserSessions reads stored sessions back
//  - getLastSessionForUrl returns most recent completed session for URL
//  - getLastSessionForUrl returns null when no matching session
//  - summarizeBrowserSessions computes completedSessions correctly
//  - summarizeBrowserSessions handles empty input
//  - seeded browser-sessions.json exists with 5+ entries
//  - bench-results.json top_failures is an array (extended mode evidence)
//  - bench-trend.json direction field is valid string
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  saveBrowserSession,
  loadBrowserSessions,
  getLastSessionForUrl,
  summarizeBrowserSessions,
  type BrowserSessionRecord,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-al-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Browser Session Store ────────────────────────────────────────────

describe("BrowserSessionStore — Sprint AL (dim 17)", () => {
  // 1. saveBrowserSession writes file
  it("saveBrowserSession writes to .danteforge/browser-sessions.json", () => {
    const dir = makeDir();
    saveBrowserSession({
      taskDescription: "Test task",
      startUrl: "https://example.com",
      startedAt: new Date().toISOString(),
      stepCount: 3,
      steps: [],
      status: "completed",
    }, dir);
    expect(existsSync(join(dir, ".danteforge", "browser-sessions.json"))).toBe(true);
  });

  // 2. loadBrowserSessions reads back session
  it("loadBrowserSessions reads stored sessions back", () => {
    const dir = makeDir();
    saveBrowserSession({
      taskDescription: "Search for docs",
      startUrl: "https://docs.example.com",
      startedAt: new Date().toISOString(),
      stepCount: 2,
      steps: [],
      status: "completed",
    }, dir);
    const sessions = loadBrowserSessions(dir);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]?.taskDescription).toBe("Search for docs");
  });

  // 3. getLastSessionForUrl returns matching session
  it("getLastSessionForUrl returns most recent completed session for URL", () => {
    const dir = makeDir();
    saveBrowserSession({
      taskDescription: "Visit github",
      startUrl: "https://github.com",
      startedAt: "2026-04-21T00:00:00.000Z",
      completedAt: "2026-04-21T00:01:00.000Z",
      stepCount: 3,
      steps: [],
      status: "completed",
    }, dir);
    const session = getLastSessionForUrl("https://github.com", dir);
    expect(session).not.toBeNull();
    expect(session?.taskDescription).toBe("Visit github");
  });

  // 4. getLastSessionForUrl returns null when no match
  it("getLastSessionForUrl returns null when no session matches URL", () => {
    const dir = makeDir();
    const session = getLastSessionForUrl("https://notfound.example.com", dir);
    expect(session).toBeNull();
  });

  // 5. summarizeBrowserSessions computes completedSessions
  it("summarizeBrowserSessions counts completedSessions correctly", () => {
    const sessions: BrowserSessionRecord[] = [
      { sessionId: "1", taskDescription: "t1", startUrl: "https://a.com", startedAt: "t", stepCount: 3, steps: [], status: "completed" },
      { sessionId: "2", taskDescription: "t2", startUrl: "https://b.com", startedAt: "t", stepCount: 2, steps: [], status: "failed" },
    ];
    const summary = summarizeBrowserSessions(sessions);
    expect(summary.completedSessions).toBe(1);
    expect(summary.failedSessions).toBe(1);
    expect(summary.totalSessions).toBe(2);
  });

  // 6. summarizeBrowserSessions handles empty input
  it("summarizeBrowserSessions handles empty input", () => {
    const summary = summarizeBrowserSessions([]);
    expect(summary.totalSessions).toBe(0);
    expect(summary.completedSessions).toBe(0);
  });

  // 7. seeded browser-sessions.json exists
  it("seeded browser-sessions.json exists at .danteforge/ with 5+ entries", () => {
    const path = join(repoRoot, ".danteforge", "browser-sessions.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── Part 2: SWE-bench extended evidence artifacts ─────────────────────────────

describe("SWE-bench Extended Evidence — Sprint AL (dim 5)", () => {
  // 8. bench-results.json exists and top_failures is array
  it("bench-results.json top_failures is an array", () => {
    const path = join(repoRoot, "bench-results.json");
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(Array.isArray(data["top_failures"])).toBe(true);
  });

  // 9. bench-trend.json direction is valid
  it("bench-trend.json direction field is a valid trend value", () => {
    const path = join(repoRoot, "bench-trend.json");
    expect(existsSync(path)).toBe(true);
    const data = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    expect(["improving", "stable", "degrading"]).toContain(data["direction"]);
  });
});
