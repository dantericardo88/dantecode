import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitSnapshotRecovery } from "./git-snapshot-recovery.js";

describe("GitSnapshotRecovery", () => {
  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExec = vi.fn();
  });

  it("takes a snapshot when there are uncommitted changes", () => {
    mockExec
      .mockReturnValueOnce("M  file.ts\n") // git status --porcelain
      .mockReturnValueOnce("abc123def456\n"); // git stash create

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    const snapshot = recovery.takeSnapshot("pre-verify");

    expect(snapshot).not.toBeNull();
    expect(snapshot!.hash).toBe("abc123def456");
    expect(snapshot!.label).toBe("pre-verify");
    expect(recovery.size).toBe(1);
  });

  it("returns null when no uncommitted changes", () => {
    mockExec.mockReturnValueOnce(""); // git status --porcelain (clean)

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    const snapshot = recovery.takeSnapshot("clean-state");

    expect(snapshot).toBeNull();
    expect(recovery.size).toBe(0);
  });

  it("rolls back to a specific snapshot", () => {
    mockExec
      .mockReturnValueOnce("M  file.ts\n") // status
      .mockReturnValueOnce("abc123\n")       // stash create
      .mockReturnValueOnce("")               // checkout -- .
      .mockReturnValueOnce("")               // clean -fd
      .mockReturnValueOnce("");              // stash apply

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    recovery.takeSnapshot("test");

    const result = recovery.rollback("abc123");
    expect(result).toBe(true);

    // Verify git checkout and stash apply were called
    const calls = mockExec.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain("git checkout -- .");
    expect(calls).toContain("git stash apply abc123");
  });

  it("returns false when rolling back to unknown snapshot", () => {
    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    expect(recovery.rollback("nonexistent")).toBe(false);
  });

  it("rolls back to last good (verified) state", () => {
    // Create 3 snapshots: first verified, second not, third not
    mockExec
      .mockReturnValueOnce("M  a.ts\n").mockReturnValueOnce("snap1\n")  // snapshot 1
      .mockReturnValueOnce("M  b.ts\n").mockReturnValueOnce("snap2\n")  // snapshot 2
      .mockReturnValueOnce("M  c.ts\n").mockReturnValueOnce("snap3\n")  // snapshot 3
      .mockReturnValueOnce("").mockReturnValueOnce("").mockReturnValueOnce(""); // rollback ops

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    recovery.takeSnapshot("first");
    recovery.takeSnapshot("second");
    recovery.takeSnapshot("third");

    // Mark first as verified
    recovery.markVerified("snap1");

    const result = recovery.rollbackToLastGoodState();
    expect(result).not.toBeNull();
    expect(result!.hash).toBe("snap1");
  });

  it("falls back to most recent snapshot when none verified", () => {
    mockExec
      .mockReturnValueOnce("M  a.ts\n").mockReturnValueOnce("snap1\n")
      .mockReturnValueOnce("M  b.ts\n").mockReturnValueOnce("snap2\n")
      .mockReturnValueOnce("").mockReturnValueOnce("").mockReturnValueOnce(""); // rollback ops

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    recovery.takeSnapshot("first");
    recovery.takeSnapshot("second");

    const result = recovery.rollbackToLastGoodState();
    expect(result).not.toBeNull();
    expect(result!.hash).toBe("snap2");
  });

  it("returns null from rollbackToLastGoodState when no snapshots", () => {
    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    expect(recovery.rollbackToLastGoodState()).toBeNull();
  });

  it("prunes old snapshots", () => {
    mockExec.mockReturnValue("M  file.ts\n");
    let counter = 0;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "git status --porcelain") return "M  file.ts\n";
      if (cmd === "git stash create") return `snap${counter++}\n`;
      return "";
    });

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    for (let i = 0; i < 8; i++) {
      recovery.takeSnapshot(`snap-${i}`);
    }

    expect(recovery.size).toBe(8);
    recovery.prune(3);
    expect(recovery.size).toBe(3);

    const snapshots = recovery.getSnapshots();
    expect(snapshots[0]!.label).toBe("snap-5");
  });

  it("auto-prunes when exceeding maxSnapshots", () => {
    let counter = 0;
    mockExec.mockImplementation((cmd: string) => {
      if (cmd === "git status --porcelain") return "M  file.ts\n";
      if (cmd === "git stash create") return `snap${counter++}\n`;
      return "";
    });

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec, maxSnapshots: 3 });
    for (let i = 0; i < 5; i++) {
      recovery.takeSnapshot(`snap-${i}`);
    }

    expect(recovery.size).toBe(3);
  });

  it("hasUncommittedChanges detects dirty working tree", () => {
    mockExec.mockReturnValueOnce("M  src/index.ts\n?? new-file.ts\n");

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    expect(recovery.hasUncommittedChanges()).toBe(true);
  });

  it("hasUncommittedChanges returns false for clean tree", () => {
    mockExec.mockReturnValueOnce("");

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    expect(recovery.hasUncommittedChanges()).toBe(false);
  });

  it("handles git command failures gracefully", () => {
    mockExec
      .mockReturnValueOnce("M  file.ts\n") // status
      .mockImplementationOnce(() => { throw new Error("git error"); }); // stash create fails

    const recovery = new GitSnapshotRecovery("/project", { execSyncFn: mockExec });
    const snapshot = recovery.takeSnapshot("fail");
    expect(snapshot).toBeNull();
  });
});
