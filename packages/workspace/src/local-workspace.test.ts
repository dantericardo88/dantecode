// ============================================================================
// @dantecode/workspace — LocalWorkspace Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { LocalWorkspace } from "./local-workspace.js";
import type { WorkspaceConfig } from "./types.js";

describe("LocalWorkspace", () => {
  let testDir: string;
  let workspace: LocalWorkspace;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "dante-workspace-test-"));

    const config: WorkspaceConfig = {
      id: "test-local",
      type: "local",
      basePath: testDir,
    };

    workspace = new LocalWorkspace(config);
  });

  afterEach(async () => {
    await workspace.destroy();
    await rm(testDir, { recursive: true, force: true });
  });

  describe("Lifecycle", () => {
    it("should initialize successfully", async () => {
      expect(workspace.getStatus()).toBe("created");

      await workspace.initialize();

      expect(workspace.getStatus()).toBe("ready");
    });

    it("should be idempotent on initialize", async () => {
      await workspace.initialize();
      await workspace.initialize();

      expect(workspace.getStatus()).toBe("ready");
    });

    it("should suspend and create snapshot", async () => {
      await workspace.initialize();

      // Create some files
      await workspace.writeFile("test.txt", "hello world");
      await workspace.writeFile("nested/file.txt", "nested content");

      const snapshot = await workspace.suspend();

      expect(snapshot.workspaceId).toBe(workspace.id);
      expect(snapshot.type).toBe("local");
      expect(snapshot.status).toBe("suspended");
      expect(snapshot.files).toHaveLength(2);
      expect(snapshot.checksum).toBeTruthy();

      expect(workspace.getStatus()).toBe("suspended");
    });

    it("should resume from snapshot", async () => {
      await workspace.initialize();

      await workspace.writeFile("test.txt", "original");
      const snapshot = await workspace.suspend();

      // Modify workspace
      await workspace.initialize();
      await workspace.writeFile("test.txt", "modified");

      // Resume
      await workspace.resume(snapshot);

      const content = await workspace.readFile("test.txt");
      expect(content).toBe("original");
      expect(workspace.getStatus()).toBe("ready");
    });

    it("should reject resume with mismatched workspace ID", async () => {
      await workspace.initialize();

      const snapshot = await workspace.suspend();
      snapshot.workspaceId = "different-id";

      await expect(workspace.resume(snapshot)).rejects.toThrow("workspace ID does not match");
    });

    it("should reject resume with invalid checksum", async () => {
      await workspace.initialize();

      const snapshot = await workspace.suspend();
      snapshot.checksum = "invalid-checksum";

      await expect(workspace.resume(snapshot)).rejects.toThrow("checksum mismatch");
    });

    it("should destroy successfully", async () => {
      await workspace.initialize();
      await workspace.destroy();

      expect(workspace.getStatus()).toBe("destroyed");
    });
  });

  describe("File Operations", () => {
    beforeEach(async () => {
      await workspace.initialize();
    });

    it("should read and write files", async () => {
      await workspace.writeFile("test.txt", "hello world");

      const content = await workspace.readFile("test.txt");
      expect(content).toBe("hello world");
    });

    it("should create parent directories automatically", async () => {
      await workspace.writeFile("a/b/c/test.txt", "nested");

      const content = await workspace.readFile("a/b/c/test.txt");
      expect(content).toBe("nested");
    });

    it("should list files with glob pattern", async () => {
      await workspace.writeFile("file1.txt", "1");
      await workspace.writeFile("file2.txt", "2");
      await workspace.writeFile("file3.md", "3");
      await workspace.writeFile("nested/file4.txt", "4");

      const txtFiles = await workspace.listFiles("*.txt");
      expect(txtFiles).toHaveLength(2);
      expect(txtFiles).toContain("file1.txt");
      expect(txtFiles).toContain("file2.txt");
    });

    it("should list files recursively", async () => {
      await workspace.writeFile("file1.txt", "1");
      await workspace.writeFile("nested/file2.txt", "2");
      await workspace.writeFile("nested/deep/file3.txt", "3");

      const allFiles = await workspace.listFiles("**/*.txt", { recursive: true });

      // Should match all txt files at any depth
      expect(allFiles.length).toBeGreaterThanOrEqual(3);
      expect(allFiles.some(f => f.includes("file1.txt"))).toBe(true);
      expect(allFiles.some(f => f.includes("file2.txt"))).toBe(true);
      expect(allFiles.some(f => f.includes("file3.txt"))).toBe(true);
    });

    it("should check file existence", async () => {
      await workspace.writeFile("exists.txt", "content");

      expect(await workspace.exists("exists.txt")).toBe(true);
      expect(await workspace.exists("missing.txt")).toBe(false);
    });

    it("should get path info", async () => {
      await workspace.writeFile("test.txt", "content");

      const info = await workspace.pathInfo("test.txt");

      expect(info.exists).toBe(true);
      expect(info.isFile).toBe(true);
      expect(info.isDirectory).toBe(false);
      expect(info.size).toBeGreaterThan(0);
    });

    it("should delete files", async () => {
      await workspace.writeFile("delete-me.txt", "bye");

      expect(await workspace.exists("delete-me.txt")).toBe(true);

      await workspace.delete("delete-me.txt");

      expect(await workspace.exists("delete-me.txt")).toBe(false);
    });

    it("should delete directories recursively", async () => {
      await workspace.writeFile("dir/file.txt", "content");

      await workspace.delete("dir");

      expect(await workspace.exists("dir")).toBe(false);
    });

    it("should create directories", async () => {
      await workspace.mkdir("a/b/c", { recursive: true });

      const info = await workspace.pathInfo("a/b/c");
      expect(info.isDirectory).toBe(true);
    });

    it("should copy files", async () => {
      await workspace.writeFile("source.txt", "original");

      await workspace.copy("source.txt", "dest.txt");

      const content = await workspace.readFile("dest.txt");
      expect(content).toBe("original");
    });

    it("should move files", async () => {
      await workspace.writeFile("old.txt", "content");

      await workspace.move("old.txt", "new.txt");

      expect(await workspace.exists("old.txt")).toBe(false);
      expect(await workspace.exists("new.txt")).toBe(true);
    });

    it("should watch files for changes", async () => {
      const changes: string[] = [];

      const unwatch = await workspace.watch(".", (event) => {
        changes.push(event.type);
      });

      // Give watcher time to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      await workspace.writeFile("watched.txt", "content");

      // Give watcher time to fire
      await new Promise((resolve) => setTimeout(resolve, 200));

      unwatch();

      expect(changes.length).toBeGreaterThan(0);
    });
  });

  describe("Command Execution", () => {
    beforeEach(async () => {
      await workspace.initialize();
    });

    it("should execute commands", async () => {
      const result = await workspace.execute("echo 'hello'");

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
    });

    it("should handle command errors", async () => {
      const result = await workspace.execute("exit 1");

      expect(result.exitCode).toBe(1);
    });

    it("should respect cwd option", async () => {
      await workspace.mkdir("subdir");

      const result = await workspace.execute("pwd", { cwd: "subdir" });

      expect(result.stdout).toContain("subdir");
    });

    it("should pass environment variables", async () => {
      // Use cross-platform approach - node to read env var
      const result = await workspace.execute('node -p "process.env.TEST_VAR"', {
        env: { TEST_VAR: "test-value" },
      });

      expect(result.stdout.trim()).toBe("test-value");
    });

    it("should execute commands in background", async () => {
      const { pid, kill } = await workspace.executeBackground("sleep 10");

      expect(pid).toBeGreaterThan(0);

      await kill();
    });
  });

  describe("Environment Variables", () => {
    beforeEach(async () => {
      await workspace.initialize();
    });

    it("should get and set environment variables", async () => {
      await workspace.setEnv("MY_VAR", "my-value");

      const value = await workspace.getEnv("MY_VAR");
      expect(value).toBe("my-value");
    });

    it("should unset environment variables", async () => {
      await workspace.setEnv("TEMP_VAR", "temp");
      await workspace.unsetEnv("TEMP_VAR");

      const value = await workspace.getEnv("TEMP_VAR");
      expect(value).toBeUndefined();
    });

    it("should get all environment variables", async () => {
      await workspace.setEnv("VAR1", "val1");
      await workspace.setEnv("VAR2", "val2");

      const allEnv = await workspace.getEnvAll();

      expect(allEnv.VAR1).toBe("val1");
      expect(allEnv.VAR2).toBe("val2");
    });

    it("should set multiple environment variables at once", async () => {
      await workspace.setEnvBatch({
        BATCH1: "value1",
        BATCH2: "value2",
      });

      expect(await workspace.getEnv("BATCH1")).toBe("value1");
      expect(await workspace.getEnv("BATCH2")).toBe("value2");
    });
  });

  describe("Working Directory", () => {
    beforeEach(async () => {
      await workspace.initialize();
    });

    it("should get current working directory", async () => {
      const cwd = await workspace.getCwd();
      expect(cwd).toBeTruthy();
    });

    it("should change working directory", async () => {
      await workspace.mkdir("subdir");

      await workspace.setCwd("subdir");

      const cwd = await workspace.getCwd();
      expect(cwd).toContain("subdir");
    });

    it("should reject changing to non-existent directory", async () => {
      await expect(workspace.setCwd("non-existent")).rejects.toThrow();
    });
  });

  describe("Stats and Events", () => {
    beforeEach(async () => {
      await workspace.initialize();
    });

    it("should track statistics", async () => {
      await workspace.readFile("test.txt").catch(() => {}); // Fails but increments
      await workspace.writeFile("test.txt", "content");
      await workspace.execute("echo test");

      const stats = await workspace.getStats();

      expect(stats.workspaceId).toBe(workspace.id);
      expect(stats.filesWritten).toBeGreaterThan(0);
      expect(stats.commandsExecuted).toBeGreaterThan(0);
    });

    it("should emit events", async () => {
      const events: string[] = [];

      workspace.on((event) => {
        events.push(event.type);
      });

      await workspace.writeFile("test.txt", "content");
      await workspace.delete("test.txt");

      expect(events).toContain("file:changed");
      expect(events).toContain("file:deleted");
    });

    it("should allow unsubscribing from events", async () => {
      const events: string[] = [];

      const unsubscribe = workspace.on((event) => {
        events.push(event.type);
      });

      await workspace.writeFile("test1.txt", "content");

      unsubscribe();

      await workspace.writeFile("test2.txt", "content");

      // Should only have one event
      expect(events.length).toBe(1);
    });
  });
});
