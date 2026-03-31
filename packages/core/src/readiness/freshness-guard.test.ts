import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  calculateDuration,
  checkReadinessFreshness,
  enforceFreshnessInCI,
  getCurrentCommit,
  warnStaleArtifacts,
} from "./freshness-guard.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("../enterprise-logger.js", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("freshness-guard", () => {
  let testDir: string;
  let mockExecFileSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    testDir = mkdtempSync(join(tmpdir(), "freshness-test-"));
    const { execFileSync } = await import("node:child_process");
    mockExecFileSync = vi.mocked(execFileSync);
    mockExecFileSync.mockReturnValue("current-commit-abc123\n" as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("getCurrentCommit", () => {
    it("should return current git commit", () => {
      mockExecFileSync.mockReturnValue("abc123def456\n" as any);

      const commit = getCurrentCommit(testDir);

      expect(commit).toBe("abc123def456");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "HEAD"],
        expect.objectContaining({ cwd: testDir }),
      );
    });

    it("should trim whitespace from commit hash", () => {
      mockExecFileSync.mockReturnValue("  abc123def456  \n\n" as any);

      const commit = getCurrentCommit(testDir);

      expect(commit).toBe("abc123def456");
    });

    it("should throw error if git command fails", () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error("git not found");
      });

      expect(() => getCurrentCommit(testDir)).toThrow("Failed to get current git commit");
    });
  });

  describe("calculateDuration", () => {
    it("should calculate seconds ago", () => {
      const timestamp = new Date(Date.now() - 5000).toISOString();
      const duration = calculateDuration(timestamp);
      expect(duration).toMatch(/^[45] seconds? ago$/);
    });

    it("should calculate minutes ago", () => {
      const timestamp = new Date(Date.now() - 125000).toISOString(); // ~2 minutes
      const duration = calculateDuration(timestamp);
      expect(duration).toMatch(/^[12] minutes? ago$/);
    });

    it("should calculate hours ago", () => {
      const timestamp = new Date(Date.now() - 7200000).toISOString(); // 2 hours
      const duration = calculateDuration(timestamp);
      expect(duration).toBe("2 hours ago");
    });

    it("should calculate days ago", () => {
      const timestamp = new Date(Date.now() - 86400000 * 3).toISOString(); // 3 days
      const duration = calculateDuration(timestamp);
      expect(duration).toBe("3 days ago");
    });

    it("should handle singular forms", () => {
      const timestamp1 = new Date(Date.now() - 1000).toISOString();
      expect(calculateDuration(timestamp1)).toMatch(/^1 second ago$/);

      const timestamp2 = new Date(Date.now() - 60000).toISOString();
      expect(calculateDuration(timestamp2)).toMatch(/^1 minute ago$/);

      const timestamp3 = new Date(Date.now() - 3600000).toISOString();
      expect(calculateDuration(timestamp3)).toBe("1 hour ago");

      const timestamp4 = new Date(Date.now() - 86400000).toISOString();
      expect(calculateDuration(timestamp4)).toBe("1 day ago");
    });

    it("should handle future timestamps", () => {
      const timestamp = new Date(Date.now() + 5000).toISOString();
      const duration = calculateDuration(timestamp);
      expect(duration).toBe("in the future");
    });

    it("should handle invalid timestamps", () => {
      const duration = calculateDuration("not-a-date");
      expect(duration).toBe("unknown");
    });
  });

  describe("checkReadinessFreshness", () => {
    it("should detect fresh artifacts (same commit)", () => {
      const artifactPath = "artifacts/readiness/test.json";
      const fullPath = join(testDir, artifactPath);

      // Create parent directories
      mkdirSync(dirname(fullPath), { recursive: true });

      writeFileSync(
        fullPath,
        JSON.stringify({
          gitCommit: "current-commit-abc123",
          timestamp: new Date().toISOString(),
        }),
        "utf-8",
      );

      const result = checkReadinessFreshness([artifactPath], testDir);

      expect(result.currentCommit).toBe("current-commit-abc123");
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts[0]!.stale).toBe(false);
      expect(result.staleCount).toBe(0);
      expect(result.allFresh).toBe(true);
    });

    it("should detect stale artifacts (different commit)", () => {
      const artifactPath = "artifacts/readiness/test.json";
      const fullPath = join(testDir, artifactPath);
      const oldTimestamp = new Date(Date.now() - 3600000).toISOString();

      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(
        fullPath,
        JSON.stringify({
          gitCommit: "old-commit-xyz789",
          timestamp: oldTimestamp,
        }),
        "utf-8",
      );

      const result = checkReadinessFreshness([artifactPath], testDir);

      expect(result.artifacts[0]!.stale).toBe(true);
      expect(result.artifacts[0]!.staleDuration).toMatch(/ago/);
      expect(result.staleCount).toBe(1);
      expect(result.allFresh).toBe(false);
    });

    it("should handle missing artifact files", () => {
      const result = checkReadinessFreshness(["missing.json"], testDir);

      expect(result.artifacts[0]!.stale).toBe(true);
      expect(result.artifacts[0]!.gitCommit).toBe("missing");
      expect(result.artifacts[0]!.staleDuration).toBe("missing file");
      expect(result.staleCount).toBe(1);
    });

    it("should handle malformed JSON", () => {
      const artifactPath = "malformed.json";
      const fullPath = join(testDir, artifactPath);

      writeFileSync(fullPath, "{ invalid json }", "utf-8");

      const result = checkReadinessFreshness([artifactPath], testDir);

      expect(result.artifacts[0]!.stale).toBe(true);
      expect(result.artifacts[0]!.gitCommit).toBe("parse-error");
      expect(result.artifacts[0]!.staleDuration).toMatch(/parse error/);
    });

    it("should support commitSha field (legacy)", () => {
      const artifactPath = "legacy.json";
      const fullPath = join(testDir, artifactPath);

      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(
        fullPath,
        JSON.stringify({
          commitSha: "current-commit-abc123", // legacy field name
          generatedAt: new Date().toISOString(),
        }),
        "utf-8",
      );

      const result = checkReadinessFreshness([artifactPath], testDir);

      expect(result.artifacts[0]!.stale).toBe(false);
      expect(result.artifacts[0]!.gitCommit).toBe("current-commit-abc123");
    });

    it("should handle multiple artifacts", () => {
      const artifact1 = "fresh.json";
      const artifact2 = "stale.json";

      mkdirSync(dirname(join(testDir, artifact1)), { recursive: true });
      writeFileSync(
        join(testDir, artifact1),
        JSON.stringify({ gitCommit: "current-commit-abc123", timestamp: new Date().toISOString() }),
        "utf-8",
      );
      mkdirSync(dirname(join(testDir, artifact2)), { recursive: true });
      writeFileSync(
        join(testDir, artifact2),
        JSON.stringify({ gitCommit: "old-commit", timestamp: new Date().toISOString() }),
        "utf-8",
      );

      const result = checkReadinessFreshness([artifact1, artifact2], testDir);

      expect(result.artifacts).toHaveLength(2);
      expect(result.artifacts[0]!.stale).toBe(false);
      expect(result.artifacts[1]!.stale).toBe(true);
      expect(result.staleCount).toBe(1);
      expect(result.allFresh).toBe(false);
    });

    it("should extract artifact name from path", () => {
      const artifactPath = "artifacts/readiness/test-artifact.json";
      const fullPath = join(testDir, artifactPath);

      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(
        fullPath,
        JSON.stringify({ gitCommit: "current-commit-abc123", timestamp: new Date().toISOString() }),
        "utf-8",
      );

      const result = checkReadinessFreshness([artifactPath], testDir);

      expect(result.artifacts[0]!.name).toBe("test-artifact.json");
    });
  });

  describe("warnStaleArtifacts", () => {
    let loggerWarnSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { logger } = await import("../enterprise-logger.js");
      loggerWarnSpy = vi.mocked(logger.warn);
      loggerWarnSpy.mockClear();
    });

    it("should not warn if all artifacts are fresh", () => {
      const result = {
        currentCommit: "abc123",
        artifacts: [
          {
            name: "fresh.json",
            path: "artifacts/fresh.json",
            gitCommit: "abc123",
            timestamp: new Date().toISOString(),
            stale: false,
          },
        ],
        staleCount: 0,
        allFresh: true,
      };

      warnStaleArtifacts(result);

      expect(loggerWarnSpy).not.toHaveBeenCalled();
    });

    it("should warn with stale artifact details", () => {
      const result = {
        currentCommit: "current-abc123",
        artifacts: [
          {
            name: "stale.json",
            path: "artifacts/stale.json",
            gitCommit: "old-xyz789",
            timestamp: new Date().toISOString(),
            stale: true,
            staleDuration: "2 hours ago",
          },
        ],
        staleCount: 1,
        allFresh: false,
      };

      warnStaleArtifacts(result);

      // Check that logger was called with appropriate messages
      expect(loggerWarnSpy).toHaveBeenCalled();
      const calls = loggerWarnSpy.mock.calls;
      expect(calls.some((call) => call[1]?.includes("STALE"))).toBe(true);
      expect(calls.some((call) => call[1]?.includes("stale.json") || JSON.stringify(call[0]).includes("stale.json"))).toBe(true);
    });

    it("should handle plural artifacts", () => {
      const result = {
        currentCommit: "abc123",
        artifacts: [
          {
            name: "stale1.json",
            path: "stale1.json",
            gitCommit: "old1",
            timestamp: new Date().toISOString(),
            stale: true,
            staleDuration: "1 hour ago",
          },
          {
            name: "stale2.json",
            path: "stale2.json",
            gitCommit: "old2",
            timestamp: new Date().toISOString(),
            stale: true,
            staleDuration: "2 hours ago",
          },
        ],
        staleCount: 2,
        allFresh: false,
      };

      warnStaleArtifacts(result);

      const calls = loggerWarnSpy.mock.calls;
      expect(calls.some((call) => call[1]?.includes("2 readiness artifact"))).toBe(true);
    });

    it("should handle special commit states", () => {
      const result = {
        currentCommit: "abc123",
        artifacts: [
          {
            name: "missing.json",
            path: "missing.json",
            gitCommit: "missing",
            timestamp: new Date().toISOString(),
            stale: true,
            staleDuration: "missing file",
          },
          {
            name: "error.json",
            path: "error.json",
            gitCommit: "parse-error",
            timestamp: new Date().toISOString(),
            stale: true,
            staleDuration: "parse error",
          },
          {
            name: "unknown.json",
            path: "unknown.json",
            gitCommit: "unknown",
            timestamp: new Date().toISOString(),
            stale: true,
            staleDuration: "1 day ago",
          },
        ],
        staleCount: 3,
        allFresh: false,
      };

      warnStaleArtifacts(result);

      const calls = loggerWarnSpy.mock.calls;
      const allCallsText = calls.map(c => JSON.stringify(c)).join(" ");
      expect(allCallsText).toContain("MISSING");
      expect(allCallsText).toContain("PARSE-ERROR");
      expect(allCallsText).toContain("UNKNOWN");
    });
  });

  describe("enforceFreshnessInCI", () => {
    let loggerWarnSpy: ReturnType<typeof vi.fn>;
    let loggerInfoSpy: ReturnType<typeof vi.fn>;
    let loggerErrorSpy: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { logger } = await import("../enterprise-logger.js");
      loggerWarnSpy = vi.mocked(logger.warn);
      loggerInfoSpy = vi.mocked(logger.info);
      loggerErrorSpy = vi.mocked(logger.error);
      loggerWarnSpy.mockClear();
      loggerInfoSpy.mockClear();
      loggerErrorSpy.mockClear();
      mockExecFileSync.mockReturnValue("current-commit-abc123\n" as any);
    });

    it("should return true when all artifacts are fresh", () => {
      const artifactPath = "fresh.json";
      mkdirSync(dirname(join(testDir, artifactPath)), { recursive: true });
      writeFileSync(
        join(testDir, artifactPath),
        JSON.stringify({ gitCommit: "current-commit-abc123", timestamp: new Date().toISOString() }),
        "utf-8",
      );

      const result = enforceFreshnessInCI([artifactPath], testDir);

      expect(result).toBe(true);
      expect(loggerInfoSpy).toHaveBeenCalled();
      expect(loggerInfoSpy.mock.calls[0]?.[1]).toContain("All readiness artifacts are fresh");
    });

    it("should return false in CI mode when stale artifacts detected", () => {
      const artifactPath = "stale.json";
      mkdirSync(dirname(join(testDir, artifactPath)), { recursive: true });
      writeFileSync(
        join(testDir, artifactPath),
        JSON.stringify({ gitCommit: "old-commit", timestamp: new Date().toISOString() }),
        "utf-8",
      );

      const result = enforceFreshnessInCI([artifactPath], testDir, { ci: true });

      expect(result).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalled();
      expect(loggerErrorSpy.mock.calls[0]?.[1]).toContain("Stale readiness artifacts detected in CI/strict mode");
    });

    it("should return false in strict mode when stale artifacts detected", () => {
      const artifactPath = "stale.json";
      mkdirSync(dirname(join(testDir, artifactPath)), { recursive: true });
      writeFileSync(
        join(testDir, artifactPath),
        JSON.stringify({ gitCommit: "old-commit", timestamp: new Date().toISOString() }),
        "utf-8",
      );

      const result = enforceFreshnessInCI([artifactPath], testDir, { strict: true });

      expect(result).toBe(false);
    });

    it("should return true in non-CI mode even with stale artifacts", () => {
      const artifactPath = "stale.json";
      mkdirSync(dirname(join(testDir, artifactPath)), { recursive: true });
      writeFileSync(
        join(testDir, artifactPath),
        JSON.stringify({ gitCommit: "old-commit", timestamp: new Date().toISOString() }),
        "utf-8",
      );

      const result = enforceFreshnessInCI([artifactPath], testDir, { ci: false });

      expect(result).toBe(true);
      expect(loggerWarnSpy).toHaveBeenCalled(); // Still warns
      expect(loggerErrorSpy).not.toHaveBeenCalled(); // But doesn't error
    });
  });
});
