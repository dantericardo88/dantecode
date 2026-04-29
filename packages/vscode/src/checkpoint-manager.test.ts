import { beforeEach, describe, expect, it, vi } from "vitest";
import { CheckpointManager, type CheckpointPersistenceFile } from "./checkpoint-manager.js";

describe("CheckpointManager", () => {
  const execCommand = vi.fn();
  const writeFile = vi.fn();
  const readFile = vi.fn();
  const mkdir = vi.fn();
  let manager: CheckpointManager;

  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) clears the mockResolvedValueOnce
    // queue. Tests like "rewinds snapshot checkpoints" set up an Once
    // rejection but never consume it (the snapshot path short-circuits
    // before reaching execCommand); without a queue reset, the leftover
    // rejection trips the next git-stash test with a phantom failure.
    vi.resetAllMocks();
    writeFile.mockResolvedValue(undefined);
    mkdir.mockResolvedValue(undefined);
    manager = new CheckpointManager("/workspace", {
      execCommand,
      writeFile,
      readFile,
      mkdir,
    });
  });

  it("creates a git stash checkpoint when the repo supports it", async () => {
    execCommand
      .mockResolvedValueOnce("true")
      .mockResolvedValueOnce("Saved working directory and index state");

    const checkpoint = await manager.createCheckpoint({ label: "before-agent-edit" });

    expect(checkpoint.strategy).toBe("git_stash");
    expect(checkpoint.label).toBe("before-agent-edit");
    expect(execCommand).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('git stash push -u -m "dantecode-checkpoint-'),
      "/workspace",
    );
  });

  it("falls back to in-memory snapshots when git stash is unavailable", async () => {
    execCommand.mockRejectedValueOnce(new Error("not a git repo"));

    const checkpoint = await manager.createCheckpoint({
      label: "snapshot-only",
      fileSnapshots: [{ filePath: "/workspace/src/app.ts", content: "old code" }],
    });

    expect(checkpoint.strategy).toBe("snapshot");
    expect(checkpoint.fileSnapshots).toEqual([
      { filePath: "/workspace/src/app.ts", content: "old code" },
    ]);
  });

  it("rewinds snapshot checkpoints by restoring captured file contents", async () => {
    execCommand.mockRejectedValueOnce(new Error("not a git repo"));
    const checkpoint = await manager.createCheckpoint({
      label: "snapshot-rewind",
      fileSnapshots: [{ filePath: "/workspace/src/app.ts", content: "restored code" }],
    });

    await manager.rewindCheckpoint(checkpoint.id);

    expect(writeFile).toHaveBeenCalledWith("/workspace/src/app.ts", "restored code", "utf-8");
  });

  it("rewinds git stash checkpoints by applying the matching stash entry", async () => {
    execCommand
      .mockResolvedValueOnce("true")
      .mockResolvedValueOnce("Saved working directory and index state");

    const checkpoint = await manager.createCheckpoint({ label: "git-rewind" });

    execCommand
      .mockResolvedValueOnce(`stash@{0} ${checkpoint.stashLabel}`)
      .mockResolvedValueOnce("applied");

    await manager.rewindCheckpoint(checkpoint.id);

    expect(execCommand).toHaveBeenLastCalledWith("git stash apply --index stash@{0}", "/workspace");
  });

  describe("persistence", () => {
    it("saves checkpoints to .dantecode/checkpoints.json", async () => {
      execCommand.mockRejectedValueOnce(new Error("not a git repo"));
      await manager.createCheckpoint({
        label: "persist-me",
        fileSnapshots: [{ filePath: "/workspace/a.ts", content: "code" }],
      });

      await manager.saveCheckpointsToFile();

      expect(mkdir).toHaveBeenCalledWith(expect.stringContaining(".dantecode"), {
        recursive: true,
      });
      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining("checkpoints.json"),
        expect.stringContaining('"persist-me"'),
        "utf-8",
      );
    });

    it("saves with version 1 format", async () => {
      execCommand.mockRejectedValueOnce(new Error("not a git repo"));
      await manager.createCheckpoint({
        label: "v1-check",
        fileSnapshots: [{ filePath: "/workspace/b.ts", content: "data" }],
      });

      await manager.saveCheckpointsToFile();

      const written = writeFile.mock.calls.find(
        (c: unknown[]) => typeof c[0] === "string" && c[0].includes("checkpoints.json"),
      );
      const parsed = JSON.parse(String(written![1])) as CheckpointPersistenceFile;
      expect(parsed.version).toBe(1);
      expect(parsed.checkpoints).toHaveLength(1);
    });

    it("loads checkpoints from file", async () => {
      const stored: CheckpointPersistenceFile = {
        version: 1,
        checkpoints: [
          {
            id: "abc123",
            createdAt: "2026-03-17T00:00:00Z",
            label: "loaded-checkpoint",
            strategy: "snapshot",
            fileSnapshots: [{ filePath: "/workspace/x.ts", content: "old" }],
          },
        ],
      };
      readFile.mockResolvedValueOnce(JSON.stringify(stored));

      const count = await manager.loadCheckpointsFromFile();

      expect(count).toBe(1);
      expect(manager.listCheckpoints()).toHaveLength(1);
      expect(manager.listCheckpoints()[0]!.label).toBe("loaded-checkpoint");
    });

    it("returns 0 when persistence file does not exist", async () => {
      readFile.mockRejectedValueOnce(new Error("ENOENT"));

      const count = await manager.loadCheckpointsFromFile();

      expect(count).toBe(0);
      expect(manager.listCheckpoints()).toHaveLength(0);
    });

    it("returns 0 for invalid JSON in persistence file", async () => {
      readFile.mockResolvedValueOnce("not valid json");

      const count = await manager.loadCheckpointsFromFile();

      expect(count).toBe(0);
    });

    it("returns 0 for wrong version format", async () => {
      readFile.mockResolvedValueOnce(JSON.stringify({ version: 99, checkpoints: [] }));

      const count = await manager.loadCheckpointsFromFile();

      expect(count).toBe(0);
    });

    it("replaces existing in-memory checkpoints on load", async () => {
      execCommand.mockRejectedValueOnce(new Error("not a git repo"));
      await manager.createCheckpoint({
        label: "existing",
        fileSnapshots: [{ filePath: "/workspace/e.ts", content: "e" }],
      });
      expect(manager.listCheckpoints()).toHaveLength(1);

      const stored: CheckpointPersistenceFile = {
        version: 1,
        checkpoints: [
          {
            id: "new1",
            createdAt: "2026-03-17T00:00:00Z",
            label: "from-file-1",
            strategy: "snapshot",
          },
          {
            id: "new2",
            createdAt: "2026-03-17T00:00:00Z",
            label: "from-file-2",
            strategy: "snapshot",
          },
        ],
      };
      readFile.mockResolvedValueOnce(JSON.stringify(stored));

      const count = await manager.loadCheckpointsFromFile();
      expect(count).toBe(2);
      expect(manager.listCheckpoints()).toHaveLength(2);
      expect(manager.listCheckpoints()[0]!.label).toBe("from-file-1");
    });
  });

  describe("generateDiffPreview", () => {
    it("generates git diff for stash-based checkpoints", async () => {
      execCommand.mockResolvedValueOnce("true").mockResolvedValueOnce("Saved working directory");

      const checkpoint = await manager.createCheckpoint({ label: "diff-test" });

      execCommand
        .mockResolvedValueOnce(`stash@{0} ${checkpoint.stashLabel}`)
        .mockResolvedValueOnce("diff --git a/file.ts\n+new line");

      const diff = await manager.generateDiffPreview(checkpoint.id);

      expect(diff).toContain("diff --git a/file.ts");
      expect(diff).toContain("+new line");
      expect(diff).toContain(checkpoint.label);
    });

    it("generates inline diff for snapshot checkpoints", async () => {
      execCommand.mockRejectedValueOnce(new Error("not a git repo"));
      const checkpoint = await manager.createCheckpoint({
        label: "snap-diff",
        fileSnapshots: [{ filePath: "src/app.ts", content: "const x = 1;\nconst y = 2;" }],
      });

      const diff = await manager.generateDiffPreview(checkpoint.id);

      expect(diff).toContain("--- a/src/app.ts");
      expect(diff).toContain("-const x = 1;");
      expect(diff).toContain("-const y = 2;");
    });

    it("throws for unknown checkpoint id", async () => {
      await expect(manager.generateDiffPreview("nonexistent")).rejects.toThrow(
        "Checkpoint not found: nonexistent",
      );
    });

    it("handles missing stash entry gracefully", async () => {
      execCommand.mockResolvedValueOnce("true").mockResolvedValueOnce("Saved working directory");

      const checkpoint = await manager.createCheckpoint({ label: "gone-stash" });

      execCommand.mockResolvedValueOnce("");

      const diff = await manager.generateDiffPreview(checkpoint.id);
      expect(diff).toContain("Stash entry no longer available");
    });

    it("handles git errors gracefully", async () => {
      execCommand.mockResolvedValueOnce("true").mockResolvedValueOnce("Saved working directory");

      const checkpoint = await manager.createCheckpoint({ label: "err-stash" });

      execCommand.mockRejectedValueOnce(new Error("git error"));

      const diff = await manager.generateDiffPreview(checkpoint.id);
      expect(diff).toContain("Unable to generate git diff");
    });
  });
});
