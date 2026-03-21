import { describe, it, expect, beforeEach, vi } from "vitest";
import { PatchValidator } from "./patch-validator.js";

// Create a mock execSync
const mockExecSync = vi.fn();

describe("PatchValidator", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
  });

  // ── Constructor ──────────────────────────────────────────────────────────

  it("creates with defaults and resolves project root", () => {
    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    expect(validator).toBeDefined();
  });

  // ── getChangedFiles ──────────────────────────────────────────────────────

  it("returns file list from git diff", () => {
    mockExecSync.mockReturnValueOnce("src/index.ts\nsrc/utils.ts\n");

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const files = validator.getChangedFiles();

    expect(files).toEqual(["src/index.ts", "src/utils.ts"]);
    const cmd = mockExecSync.mock.calls[0]![0] as string;
    expect(cmd).toBe("git diff --name-only");
  });

  it("returns empty array for clean repo", () => {
    mockExecSync.mockReturnValueOnce("");

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const files = validator.getChangedFiles();

    expect(files).toEqual([]);
  });

  // ── getDiffStats ─────────────────────────────────────────────────────────

  it("parses insertions and deletions from shortstat", () => {
    mockExecSync.mockReturnValueOnce(" 3 files changed, 42 insertions(+), 17 deletions(-)\n");

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const stats = validator.getDiffStats();

    expect(stats.insertions).toBe(42);
    expect(stats.deletions).toBe(17);
  });

  it("handles no changes with zero stats", () => {
    mockExecSync.mockReturnValueOnce("");

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const stats = validator.getDiffStats();

    expect(stats.insertions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  // ── validateCurrentState ─────────────────────────────────────────────────

  it("returns valid state when no conflicts", () => {
    mockExecSync
      .mockReturnValueOnce("src/a.ts\n") // getChangedFiles → git diff --name-only
      .mockReturnValueOnce(" 1 file changed, 10 insertions(+), 2 deletions(-)\n") // getDiffStats
      .mockReturnValueOnce(""); // getConflicts → git diff --check (success, no output)

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const result = validator.validateCurrentState();

    expect(result.valid).toBe(true);
    expect(result.filesChanged).toEqual(["src/a.ts"]);
    expect(result.insertions).toBe(10);
    expect(result.deletions).toBe(2);
    expect(result.conflicts).toEqual([]);
  });

  it("returns invalid state when conflicts exist", () => {
    const conflictError = new Error("git diff --check failed");
    (conflictError as unknown as { stdout: string }).stdout =
      "src/a.ts:5: leftover conflict marker\nsrc/a.ts:10: leftover conflict marker\n";

    mockExecSync
      .mockReturnValueOnce("src/a.ts\n") // getChangedFiles
      .mockReturnValueOnce(" 1 file changed, 5 insertions(+)\n") // getDiffStats
      .mockImplementationOnce(() => {
        throw conflictError;
      }); // getConflicts throws

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const result = validator.validateCurrentState();

    expect(result.valid).toBe(false);
    expect(result.conflicts.length).toBe(2);
    expect(result.conflicts[0]).toContain("conflict marker");
  });

  // ── validateGitDiff ──────────────────────────────────────────────────────

  it("matches when expected equals actual", () => {
    mockExecSync.mockReturnValueOnce("src/a.ts\nsrc/b.ts\n");

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const result = validator.validateGitDiff(["src/a.ts", "src/b.ts"]);

    expect(result.matches).toBe(true);
    expect(result.unexpected).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(result.actual).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("finds unexpected files not in expected list", () => {
    mockExecSync.mockReturnValueOnce("src/a.ts\nsrc/b.ts\nsrc/secret.ts\n");

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const result = validator.validateGitDiff(["src/a.ts", "src/b.ts"]);

    expect(result.matches).toBe(false);
    expect(result.unexpected).toEqual(["src/secret.ts"]);
    expect(result.missing).toEqual([]);
  });

  it("finds missing files expected but not changed", () => {
    mockExecSync.mockReturnValueOnce("src/a.ts\n");

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const result = validator.validateGitDiff(["src/a.ts", "src/b.ts"]);

    expect(result.matches).toBe(false);
    expect(result.unexpected).toEqual([]);
    expect(result.missing).toEqual(["src/b.ts"]);
  });

  // ── isClean / hasUncommittedChanges ──────────────────────────────────────

  it("reports clean repo correctly", () => {
    mockExecSync.mockReturnValueOnce(""); // git status --porcelain

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });

    expect(validator.isClean()).toBe(true);
  });

  it("reports dirty repo correctly", () => {
    mockExecSync.mockReturnValueOnce("M  src/index.ts\n?? new-file.ts\n"); // git status --porcelain

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });

    expect(validator.hasUncommittedChanges()).toBe(true);
  });

  // ── commitIfValid ────────────────────────────────────────────────────────

  it("commits when PDSE score is above threshold", () => {
    mockExecSync
      // validateCurrentState internals:
      .mockReturnValueOnce("src/a.ts\n") // getChangedFiles
      .mockReturnValueOnce(" 1 file changed, 5 insertions(+)\n") // getDiffStats
      .mockReturnValueOnce("") // getConflicts → git diff --check
      // commit flow:
      .mockReturnValueOnce("") // git add .
      .mockReturnValueOnce("[main abc1234] feat: add widget\n") // git commit
      .mockReturnValueOnce("abc1234567890\n"); // git rev-parse HEAD

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const result = validator.commitIfValid(0.85, 0.7, "feat: add widget");

    expect(result.committed).toBe(true);
    expect(result.sha).toBe("abc1234567890");
    expect(result.reason).toBeUndefined();
  });

  it("rejects commit when PDSE score is below threshold", () => {
    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const result = validator.commitIfValid(0.5, 0.7, "feat: risky change");

    expect(result.committed).toBe(false);
    expect(result.reason).toBe("PDSE score 0.5 below threshold 0.7");
    // No git commands should have been called
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("rejects commit when merge conflicts detected", () => {
    const conflictError = new Error("git diff --check failed");
    (conflictError as unknown as { stdout: string }).stdout =
      "src/a.ts:5: leftover conflict marker\n";

    mockExecSync
      .mockReturnValueOnce("src/a.ts\n") // getChangedFiles
      .mockReturnValueOnce(" 1 file changed, 5 insertions(+)\n") // getDiffStats
      .mockImplementationOnce(() => {
        throw conflictError;
      }); // getConflicts throws

    const validator = new PatchValidator("/project", {
      execSyncFn: mockExecSync,
    });
    const result = validator.commitIfValid(0.9, 0.7, "feat: conflict commit");

    expect(result.committed).toBe(false);
    expect(result.reason).toBe("Merge conflicts detected");
  });
});
