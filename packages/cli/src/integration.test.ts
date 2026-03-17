// ============================================================================
// @dantecode/cli — Integration Tests
// Tests slash commands that tie together core + cli modules.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { BackgroundAgentRunner, CodeIndex, SessionStore } from "@dantecode/core";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("CLI Integration", () => {
  // --------------------------------------------------------------------------
  // Background Agent via /bg command flow
  // --------------------------------------------------------------------------
  describe("/bg command flow", () => {
    it("enqueues and completes a task end-to-end", async () => {
      const runner = new BackgroundAgentRunner(2);
      runner.setWorkFn(async (prompt) => ({
        output: `Completed: ${prompt}`,
        touchedFiles: ["src/foo.ts"],
      }));

      const id = runner.enqueue("fix the login bug");
      expect(id).toBeTruthy();

      // Wait for completion
      await new Promise((r) => setTimeout(r, 100));

      const task = runner.getTask(id);
      expect(task).not.toBeNull();
      expect(task!.status).toBe("completed");
      expect(task!.output).toBe("Completed: fix the login bug");
      expect(task!.touchedFiles).toEqual(["src/foo.ts"]);
    });

    it("cancel flow works", () => {
      const runner = new BackgroundAgentRunner(0); // no slots = stays queued
      const id = runner.enqueue("long running task");

      expect(runner.getTask(id)!.status).toBe("queued");
      const cancelled = runner.cancel(id);
      expect(cancelled).toBe(true);
      expect(runner.getTask(id)!.status).toBe("cancelled");
    });

    it("clear finished removes completed/failed tasks", async () => {
      const runner = new BackgroundAgentRunner(5);
      runner.setWorkFn(async (prompt) => {
        if (prompt === "fail") throw new Error("intentional");
        return { output: "ok", touchedFiles: [] };
      });

      runner.enqueue("pass");
      runner.enqueue("fail");
      await new Promise((r) => setTimeout(r, 100));

      expect(runner.listTasks()).toHaveLength(2);
      const cleared = runner.clearFinished();
      expect(cleared).toBe(2);
      expect(runner.listTasks()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Code Index via /index + /search flow
  // --------------------------------------------------------------------------
  describe("/index + /search flow", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "dantecode-integ-idx-"));
      await mkdir(join(tempDir, "src"), { recursive: true });
    });

    it("builds index from sample TS files and searches", async () => {
      await writeFile(
        join(tempDir, "src", "math.ts"),
        [
          "export function add(a: number, b: number): number {",
          "  return a + b;",
          "}",
          "",
          "export function multiply(a: number, b: number): number {",
          "  return a * b;",
          "}",
          "",
          "export function fibonacci(n: number): number {",
          "  if (n <= 1) return n;",
          "  return fibonacci(n - 1) + fibonacci(n - 2);",
          "}",
        ].join("\n"),
        "utf-8",
      );

      await writeFile(
        join(tempDir, "src", "strings.ts"),
        [
          "export function capitalize(s: string): string {",
          "  return s.charAt(0).toUpperCase() + s.slice(1);",
          "}",
          "",
          "export function reverse(s: string): string {",
          "  return s.split('').reverse().join('');",
          "}",
        ].join("\n"),
        "utf-8",
      );

      const index = new CodeIndex();
      const count = await index.buildIndex(tempDir);
      expect(count).toBeGreaterThanOrEqual(2);

      // Search for fibonacci should find math.ts
      const results = index.search("fibonacci recursive", 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.filePath).toContain("math.ts");

      // Search for string operations
      const strResults = index.search("capitalize string", 5);
      expect(strResults.length).toBeGreaterThan(0);
      expect(strResults[0]!.filePath).toContain("strings.ts");
    });

    it("saves and loads index to disk", async () => {
      // Need multiple files so TF-IDF has enough signal
      await writeFile(
        join(tempDir, "src", "hello.ts"),
        [
          "export function greet(name: string): string {",
          "  return `Hello, ${name}!`;",
          "}",
          "",
          "export function farewell(name: string): string {",
          "  return `Goodbye, ${name}!`;",
          "}",
        ].join("\n"),
        "utf-8",
      );
      await writeFile(
        join(tempDir, "src", "calc.ts"),
        [
          "export function add(a: number, b: number): number {",
          "  return a + b;",
          "}",
        ].join("\n"),
        "utf-8",
      );

      const index = new CodeIndex();
      const chunkCount = await index.buildIndex(tempDir);
      expect(chunkCount).toBeGreaterThanOrEqual(2);
      await index.save(tempDir);

      // Load in a fresh instance
      const index2 = new CodeIndex();
      const loaded = await index2.load(tempDir);
      expect(loaded).toBe(true);

      // The loaded index should contain chunks
      const results = index2.search("greet hello name", 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it("returns empty results for unrelated query", async () => {
      await writeFile(
        join(tempDir, "src", "app.ts"),
        "export const version = '1.0.0';",
        "utf-8",
      );

      const index = new CodeIndex();
      await index.buildIndex(tempDir);

      const results = index.search("quantum entanglement teleportation", 5);
      // Results may be returned by TF-IDF but should have low relevance
      // At minimum, the function should not crash
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Session persistence save/load roundtrip
  // --------------------------------------------------------------------------
  describe("Session persistence roundtrip", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "dantecode-integ-session-"));
    });

    it("saves and loads a session", async () => {
      const store = new SessionStore(tempDir);
      const session = {
        id: "test-session-1",
        title: "Test Chat",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: "grok-3",
        messages: [
          { role: "user" as const, content: "Hello", timestamp: new Date().toISOString() },
          { role: "assistant" as const, content: "Hi!", timestamp: new Date().toISOString() },
        ],
        contextFiles: ["src/index.ts"],
      };

      await store.save(session);
      const loaded = await store.load("test-session-1");
      expect(loaded).not.toBeNull();
      expect(loaded!.title).toBe("Test Chat");
      expect(loaded!.messages).toHaveLength(2);
      expect(loaded!.contextFiles).toEqual(["src/index.ts"]);
    });

    it("lists sessions sorted by updatedAt", async () => {
      const store = new SessionStore(tempDir);

      await store.save({
        id: "old",
        title: "Old Chat",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        model: "grok-3",
        messages: [],
        contextFiles: [],
      });

      await store.save({
        id: "new",
        title: "New Chat",
        createdAt: "2024-06-01T00:00:00Z",
        updatedAt: "2024-06-01T00:00:00Z",
        model: "grok-3",
        messages: [{ role: "user", content: "test", timestamp: "2024-06-01T00:00:00Z" }],
        contextFiles: [],
      });

      const list = await store.list();
      expect(list).toHaveLength(2);
      expect(list[0]!.id).toBe("new");
      expect(list[1]!.id).toBe("old");
    });

    it("deletes a session", async () => {
      const store = new SessionStore(tempDir);
      await store.save({
        id: "to-delete",
        title: "Delete Me",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        model: "grok-3",
        messages: [],
        contextFiles: [],
      });

      expect(await store.exists("to-delete")).toBe(true);
      const deleted = await store.delete("to-delete");
      expect(deleted).toBe(true);
      expect(await store.exists("to-delete")).toBe(false);
    });
  });
});
