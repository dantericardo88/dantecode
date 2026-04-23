// ============================================================================
// Sprint Dim 35: Onboarding metrics + repo readiness tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordOnboardingStep,
  loadOnboardingLog,
  getOnboardingStats,
  checkRepoReadiness,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim35-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── recordOnboardingStep + loadOnboardingLog ───────────────────────────────────

describe("recordOnboardingStep + loadOnboardingLog", () => {
  it("creates onboarding-log.jsonl on first record", () => {
    recordOnboardingStep({ sessionId: "s1", step: "init-started" }, tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "onboarding-log.jsonl"))).toBe(true);
  });

  it("reads back entries with correct shape", () => {
    recordOnboardingStep({ sessionId: "s1", step: "init-started" }, tmpDir);
    recordOnboardingStep({ sessionId: "s1", step: "model-configured", modelId: "claude-sonnet-4-6" }, tmpDir);
    const entries = loadOnboardingLog(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.sessionId).toBe("s1");
    expect(entries[0]!.step).toBe("init-started");
    expect(entries[1]!.modelId).toBe("claude-sonnet-4-6");
  });

  it("returns empty array when no file exists", () => {
    expect(loadOnboardingLog(tmpDir)).toEqual([]);
  });

  it("records framework on repo-readiness-checked step", () => {
    recordOnboardingStep({ sessionId: "s2", step: "repo-readiness-checked", framework: "Next.js" }, tmpDir);
    const entries = loadOnboardingLog(tmpDir);
    expect(entries[0]!.framework).toBe("Next.js");
  });
});

// ── getOnboardingStats ────────────────────────────────────────────────────────

describe("getOnboardingStats", () => {
  it("returns zero stats for empty input", () => {
    const stats = getOnboardingStats([]);
    expect(stats.totalSessions).toBe(0);
    expect(stats.completionRate).toBe(0);
    expect(stats.dropOffStep).toBeNull();
  });

  it("counts total unique sessions correctly", () => {
    const entries = [
      { sessionId: "a", step: "init-started" as const, recordedAt: "" },
      { sessionId: "a", step: "model-configured" as const, recordedAt: "" },
      { sessionId: "b", step: "init-started" as const, recordedAt: "" },
    ];
    const stats = getOnboardingStats(entries);
    expect(stats.totalSessions).toBe(2);
  });

  it("completionRate = 1 when all sessions complete", () => {
    const entries = [
      { sessionId: "x", step: "init-started" as const, recordedAt: "2026-04-23T08:00:00Z" },
      { sessionId: "x", step: "onboarding-complete" as const, recordedAt: "2026-04-23T08:05:00Z" },
    ];
    expect(getOnboardingStats(entries).completionRate).toBe(1);
  });

  it("completionRate = 0 when no sessions complete", () => {
    const entries = [
      { sessionId: "y", step: "init-started" as const, recordedAt: "" },
      { sessionId: "z", step: "model-configured" as const, recordedAt: "" },
    ];
    expect(getOnboardingStats(entries).completionRate).toBe(0);
  });

  it("dropOffStep identifies the most common last step among non-completing sessions", () => {
    const entries = [
      { sessionId: "a", step: "init-started" as const, recordedAt: "" },
      { sessionId: "a", step: "model-configured" as const, recordedAt: "" },
      { sessionId: "b", step: "init-started" as const, recordedAt: "" },
      { sessionId: "b", step: "model-configured" as const, recordedAt: "" },
      { sessionId: "c", step: "init-started" as const, recordedAt: "" },
      { sessionId: "c", step: "repo-readiness-checked" as const, recordedAt: "" },
    ];
    const stats = getOnboardingStats(entries);
    expect(stats.dropOffStep).toBe("model-configured");
  });

  it("avgDurationMs is 0 when timestamps are empty strings", () => {
    const entries = [
      { sessionId: "q", step: "init-started" as const, recordedAt: "" },
      { sessionId: "q", step: "onboarding-complete" as const, recordedAt: "" },
    ];
    expect(getOnboardingStats(entries).avgDurationMs).toBe(0);
  });

  it("avgDurationMs is computed for sessions with valid timestamps", () => {
    const entries = [
      { sessionId: "r", step: "init-started" as const, recordedAt: "2026-04-23T10:00:00Z" },
      { sessionId: "r", step: "onboarding-complete" as const, recordedAt: "2026-04-23T10:05:00Z" },
    ];
    const stats = getOnboardingStats(entries);
    expect(stats.avgDurationMs).toBe(5 * 60 * 1000);
  });

  it("completedAt field is a valid ISO string", () => {
    const stats = getOnboardingStats([]);
    expect(stats.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── checkRepoReadiness ────────────────────────────────────────────────────────

describe("checkRepoReadiness", () => {
  it("detects hasPackageJson=true when package.json exists", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }), "utf-8");
    const result = checkRepoReadiness(tmpDir);
    expect(result.hasPackageJson).toBe(true);
  });

  it("hasPackageJson=false when no package.json", () => {
    expect(checkRepoReadiness(tmpDir).hasPackageJson).toBe(false);
  });

  it("detects hasGit=true when .git dir exists", () => {
    mkdirSync(join(tmpDir, ".git"));
    expect(checkRepoReadiness(tmpDir).hasGit).toBe(true);
  });

  it("detects dev script from package.json scripts", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } }),
      "utf-8",
    );
    const result = checkRepoReadiness(tmpDir);
    expect(result.hasDevScript).toBe(true);
    expect(result.devCommand).toBe("npm run dev");
  });

  it("detects Next.js framework from next.config.js", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({}), "utf-8");
    writeFileSync(join(tmpDir, "next.config.js"), "module.exports={}", "utf-8");
    const result = checkRepoReadiness(tmpDir);
    expect(result.detectedFramework).toBe("Next.js");
  });

  it("detectedFramework=null when no config file found", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({}), "utf-8");
    expect(checkRepoReadiness(tmpDir).detectedFramework).toBeNull();
  });

  it("devCommand is null when no matching script found", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }), "utf-8");
    const result = checkRepoReadiness(tmpDir);
    expect(result.hasDevScript).toBe(false);
    expect(result.devCommand).toBeNull();
  });
});
