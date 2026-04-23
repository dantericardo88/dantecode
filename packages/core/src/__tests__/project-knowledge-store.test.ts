// packages/core/src/__tests__/project-knowledge-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectKnowledgeStore } from "../project-knowledge-store.js";

let tmpDir: string;
let store: ProjectKnowledgeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pkg-knowledge-test-"));
  store = new ProjectKnowledgeStore("/fake/project/root", tmpDir);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ProjectKnowledgeStore.upsert", () => {
  it("adds a new fact and returns an id", () => {
    const id = store.upsert("All API handlers are in packages/api/src/", "architecture", "session-1");
    expect(typeof id).toBe("string");
    expect(id.length).toBe(12);
  });

  it("increments size after first upsert", () => {
    expect(store.size).toBe(0);
    store.upsert("TypeScript strict mode enabled", "convention", "s1");
    expect(store.size).toBe(1);
  });

  it("deduplicates facts with same prefix (first 60 chars)", () => {
    const fact = "This is a fact that is longer than sixty characters but still matches";
    store.upsert(fact, "architecture", "s1");
    store.upsert(fact, "architecture", "s2");
    expect(store.size).toBe(1);
  });

  it("boosts confidence on dedup hit", () => {
    store.upsert("Convention: use camelCase for variables", "convention", "s1", 0.7);
    store.upsert("Convention: use camelCase for variables", "convention", "s2", 0.7);
    const facts = store.query("convention");
    expect(facts[0]!.confidence).toBeCloseTo(0.8, 1); // 0.7 + 0.1
  });

  it("stores multiple facts in different categories", () => {
    store.upsert("Architecture: event-sourced", "architecture", "s1");
    store.upsert("Bug: race condition in socket handler", "bug", "s1");
    store.upsert("Prefers verbose commit messages", "preference", "s1");
    expect(store.size).toBe(3);
  });

  it("tracks session references", () => {
    store.upsert("Fact A", "context", "session-A");
    store.upsert("Fact A", "context", "session-B");
    const facts = store.query();
    expect(facts[0]!.sessionRefs).toContain("session-A");
    expect(facts[0]!.sessionRefs).toContain("session-B");
  });
});

describe("ProjectKnowledgeStore.query", () => {
  it("returns empty array when no facts", () => {
    expect(store.query()).toEqual([]);
  });

  it("filters by category", () => {
    store.upsert("Architecture fact", "architecture", "s1");
    store.upsert("Bug fact", "bug", "s1");
    const results = store.query("architecture");
    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe("architecture");
  });

  it("respects limit parameter", () => {
    for (let i = 0; i < 10; i++) {
      store.upsert(`Fact ${i}: ${"x".repeat(50)}`, "context", "s1");
    }
    const results = store.query(undefined, 5);
    expect(results).toHaveLength(5);
  });

  it("increments hitCount when sessionId provided", () => {
    store.upsert("Frequently accessed fact", "workflow", "s1");
    store.query(undefined, 10, "s2");
    const facts = store.query();
    expect(facts[0]!.hitCount).toBeGreaterThan(0);
  });

  it("sorts by confidence descending", () => {
    store.upsert("Low confidence", "context", "s1", 0.3);
    store.upsert("High confidence", "context", "s1", 0.9);
    const results = store.query();
    expect(results[0]!.confidence).toBeGreaterThan(results[1]!.confidence);
  });
});

describe("ProjectKnowledgeStore.formatForPrompt", () => {
  it("returns empty string when no facts", () => {
    expect(store.formatForPrompt()).toBe("");
  });

  it("returns markdown block with category tags", () => {
    store.upsert("Use Vitest for tests", "convention", "s1");
    const output = store.formatForPrompt();
    expect(output).toContain("## Project Knowledge");
    expect(output).toContain("[convention]");
    expect(output).toContain("Use Vitest for tests");
  });

  it("limits facts to specified count", () => {
    for (let i = 0; i < 10; i++) {
      store.upsert(`Fact ${i}: ${"a".repeat(50)}`, "context", "s1");
    }
    const output = store.formatForPrompt(3);
    const lineCount = output.split("\n").filter((l) => l.startsWith("- [")).length;
    expect(lineCount).toBe(3);
  });
});

describe("ProjectKnowledgeStore.save and reload", () => {
  it("persists facts to disk and reloads them", () => {
    store.upsert("Persistent fact", "architecture", "s1");
    store.save("s1");

    const store2 = new ProjectKnowledgeStore("/fake/project/root", tmpDir);
    expect(store2.size).toBe(1);
    const facts = store2.query();
    expect(facts[0]!.fact).toBe("Persistent fact");
  });

  it("handles corrupted store file gracefully (starts fresh)", () => {
    const hash = createHash("sha256").update("/fake/project/root").digest("hex").slice(0, 16);
    const storePath = join(tmpDir, `${hash}.json`);
    writeFileSync(storePath, "{invalid json{{}", "utf8");

    const freshStore = new ProjectKnowledgeStore("/fake/project/root", tmpDir);
    expect(freshStore.size).toBe(0);
  });
});

describe("ProjectKnowledgeStore.remove", () => {
  it("removes a fact by id", () => {
    const id = store.upsert("Removable fact", "context", "s1");
    expect(store.size).toBe(1);
    const removed = store.remove(id);
    expect(removed).toBe(true);
    expect(store.size).toBe(0);
  });

  it("returns false when id not found", () => {
    expect(store.remove("nonexistent-id")).toBe(false);
  });
});
