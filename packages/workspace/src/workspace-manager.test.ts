// ============================================================================
// @dantecode/workspace — WorkspaceManager Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { WorkspaceManager, getWorkspaceManager, setWorkspaceManager, resetWorkspaceManager } from "./workspace-manager.js";
import type { WorkspaceConfig } from "./types.js";

describe("WorkspaceManager", () => {
  let manager: WorkspaceManager;
  let testDir: string;

  beforeEach(async () => {
    manager = new WorkspaceManager();
    testDir = await mkdtemp(join(tmpdir(), "dante-wm-test-"));
  });

  afterEach(async () => {
    await manager.destroyAll();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("create", () => {
    it("should create and register a workspace", async () => {
      const config: WorkspaceConfig = {
        id: "test-ws",
        type: "local",
        basePath: testDir,
      };

      const workspace = await manager.create(config);

      expect(workspace).toBeTruthy();
      expect(workspace.id).toBe("test-ws");
      expect(workspace.getStatus()).toBe("ready");
      expect(manager.has("test-ws")).toBe(true);
    });

    it("should throw error for duplicate ID", async () => {
      const config: WorkspaceConfig = {
        id: "duplicate",
        type: "local",
        basePath: testDir,
      };

      await manager.create(config);

      await expect(manager.create(config)).rejects.toThrow("already exists");
    });
  });

  describe("get", () => {
    it("should retrieve existing workspace", async () => {
      const config: WorkspaceConfig = {
        id: "get-test",
        type: "local",
        basePath: testDir,
      };

      await manager.create(config);

      const workspace = manager.get("get-test");

      expect(workspace).toBeTruthy();
      expect(workspace?.id).toBe("get-test");
    });

    it("should return undefined for non-existent workspace", () => {
      const workspace = manager.get("non-existent");

      expect(workspace).toBeUndefined();
    });
  });

  describe("list", () => {
    it("should list all workspace IDs", async () => {
      await manager.create({ id: "ws1", type: "local", basePath: testDir });
      await manager.create({ id: "ws2", type: "local", basePath: testDir });
      await manager.create({ id: "ws3", type: "local", basePath: testDir });

      const ids = manager.list();

      expect(ids).toHaveLength(3);
      expect(ids).toContain("ws1");
      expect(ids).toContain("ws2");
      expect(ids).toContain("ws3");
    });

    it("should return empty array when no workspaces", () => {
      const ids = manager.list();

      expect(ids).toHaveLength(0);
    });
  });

  describe("getStats", () => {
    it("should get stats for all workspaces", async () => {
      await manager.create({ id: "stats1", type: "local", basePath: testDir });
      await manager.create({ id: "stats2", type: "local", basePath: testDir });

      const stats = await manager.getStats();

      expect(stats.size).toBe(2);
      expect(stats.has("stats1")).toBe(true);
      expect(stats.has("stats2")).toBe(true);
    });
  });

  describe("suspend and resume", () => {
    it("should suspend and resume a workspace", async () => {
      const config: WorkspaceConfig = {
        id: "suspend-test",
        type: "local",
        basePath: testDir,
      };

      const workspace = await manager.create(config);

      // Write some data
      await workspace.writeFile("test.txt", "hello");

      // Suspend
      const snapshot = await manager.suspend("suspend-test");

      expect(snapshot).toBeTruthy();
      expect(snapshot.workspaceId).toBe("suspend-test");
      expect(workspace.getStatus()).toBe("suspended");

      // Resume
      const resumed = await manager.resume(snapshot.id);

      expect(resumed.getStatus()).toBe("ready");

      const content = await resumed.readFile("test.txt");
      expect(content).toBe("hello");
    });

    it("should throw error suspending non-existent workspace", async () => {
      await expect(manager.suspend("non-existent")).rejects.toThrow("not found");
    });

    it("should throw error resuming non-existent snapshot", async () => {
      await expect(manager.resume("non-existent")).rejects.toThrow("Snapshot not found");
    });

    it("should recreate workspace when resuming if not present", async () => {
      const workspace = await manager.create({
        id: "recreate-test",
        type: "local",
        basePath: testDir,
      });

      await workspace.writeFile("data.txt", "content");

      const snapshot = await manager.suspend("recreate-test");

      // Destroy the workspace
      await manager.destroy("recreate-test");

      expect(manager.has("recreate-test")).toBe(false);

      // Resume should recreate it
      const resumed = await manager.resume(snapshot.id);

      expect(manager.has("recreate-test")).toBe(true);
      expect(resumed.getStatus()).toBe("ready");
    });
  });

  describe("snapshots", () => {
    it("should get snapshot by ID", async () => {
      const workspace = await manager.create({
        id: "snap-test",
        type: "local",
        basePath: testDir,
      });

      const snapshot = await manager.suspend("snap-test");

      const retrieved = manager.getSnapshot(snapshot.id);

      expect(retrieved).toBeTruthy();
      expect(retrieved?.id).toBe(snapshot.id);
    });

    it("should list all snapshots", async () => {
      const ws1 = await manager.create({ id: "ws1", type: "local", basePath: testDir });
      const ws2 = await manager.create({ id: "ws2", type: "local", basePath: testDir });

      const snap1 = await manager.suspend("ws1");
      const snap2 = await manager.suspend("ws2");

      const snapshots = manager.listSnapshots();

      expect(snapshots).toHaveLength(2);
      expect(snapshots).toContain(snap1.id);
      expect(snapshots).toContain(snap2.id);
    });

    it("should delete snapshot", async () => {
      const workspace = await manager.create({
        id: "del-snap",
        type: "local",
        basePath: testDir,
      });

      const snapshot = await manager.suspend("del-snap");

      expect(manager.getSnapshot(snapshot.id)).toBeTruthy();

      const deleted = manager.deleteSnapshot(snapshot.id);

      expect(deleted).toBe(true);
      expect(manager.getSnapshot(snapshot.id)).toBeUndefined();
    });

    it("should return false deleting non-existent snapshot", () => {
      const deleted = manager.deleteSnapshot("non-existent");

      expect(deleted).toBe(false);
    });
  });

  describe("destroy", () => {
    it("should destroy a workspace", async () => {
      await manager.create({
        id: "destroy-test",
        type: "local",
        basePath: testDir,
      });

      expect(manager.has("destroy-test")).toBe(true);

      await manager.destroy("destroy-test");

      expect(manager.has("destroy-test")).toBe(false);
    });

    it("should throw error destroying non-existent workspace", async () => {
      await expect(manager.destroy("non-existent")).rejects.toThrow("not found");
    });
  });

  describe("destroyAll", () => {
    it("should destroy all workspaces", async () => {
      await manager.create({ id: "ws1", type: "local", basePath: testDir });
      await manager.create({ id: "ws2", type: "local", basePath: testDir });
      await manager.create({ id: "ws3", type: "local", basePath: testDir });

      expect(manager.size).toBe(3);

      await manager.destroyAll();

      expect(manager.size).toBe(0);
    });
  });

  describe("cleanup", () => {
    it("should remove destroyed workspaces", async () => {
      const ws1 = await manager.create({ id: "ws1", type: "local", basePath: testDir });
      const ws2 = await manager.create({ id: "ws2", type: "local", basePath: testDir });

      await ws1.destroy();

      expect(manager.size).toBe(2);

      const cleaned = await manager.cleanup();

      expect(cleaned).toBe(1);
      expect(manager.size).toBe(1);
      expect(manager.has("ws2")).toBe(true);
    });

    it("should return 0 when no cleanup needed", async () => {
      await manager.create({ id: "ws1", type: "local", basePath: testDir });

      const cleaned = await manager.cleanup();

      expect(cleaned).toBe(0);
    });
  });

  describe("properties", () => {
    it("should track size", async () => {
      expect(manager.size).toBe(0);

      await manager.create({ id: "ws1", type: "local", basePath: testDir });
      expect(manager.size).toBe(1);

      await manager.create({ id: "ws2", type: "local", basePath: testDir });
      expect(manager.size).toBe(2);

      await manager.destroy("ws1");
      expect(manager.size).toBe(1);
    });

    it("should clear all workspaces", async () => {
      await manager.create({ id: "ws1", type: "local", basePath: testDir });
      await manager.create({ id: "ws2", type: "local", basePath: testDir });

      manager.clear();

      expect(manager.size).toBe(0);
    });
  });
});

describe("Global manager", () => {
  afterEach(() => {
    resetWorkspaceManager();
  });

  it("should get global manager", () => {
    const manager1 = getWorkspaceManager();
    const manager2 = getWorkspaceManager();

    expect(manager1).toBe(manager2);
  });

  it("should set custom global manager", () => {
    const customManager = new WorkspaceManager();

    setWorkspaceManager(customManager);

    const retrieved = getWorkspaceManager();

    expect(retrieved).toBe(customManager);
  });

  it("should reset global manager", () => {
    const manager1 = getWorkspaceManager();

    resetWorkspaceManager();

    const manager2 = getWorkspaceManager();

    expect(manager1).not.toBe(manager2);
  });
});
