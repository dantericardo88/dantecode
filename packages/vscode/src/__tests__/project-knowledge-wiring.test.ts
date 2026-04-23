// packages/vscode/src/__tests__/project-knowledge-wiring.test.ts
// Sprint H — Dim 4: ProjectKnowledgeStore wired into sidebar system prompt (4: 8→9)
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ProjectKnowledgeStore,
  type KnowledgeFact,
  type KnowledgeCategory,
} from "@dantecode/core";

function makeStore(suffix = Math.random().toString(36).slice(2)) {
  const dir = join(tmpdir(), `dante-test-knowledge-${suffix}`);
  return new ProjectKnowledgeStore(`/test/project/${suffix}`, dir);
}

// ─── upsert ───────────────────────────────────────────────────────────────────

describe("ProjectKnowledgeStore.upsert", () => {
  it("adds a new fact and returns an id", () => {
    const store = makeStore();
    const id = store.upsert("Uses ESM modules throughout", "convention", "session-1");
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(store.size).toBe(1);
  });

  it("reinforces an existing fact (first 60 chars identical)", () => {
    const store = makeStore();
    const base = "Uses ESM modules throughout the entire codebase for all packages";
    const id1 = store.upsert(base, "convention", "s1");
    // Same first 60 chars → treated as near-duplicate
    const id2 = store.upsert(base.slice(0, 60) + " — confirmed by inspection", "convention", "s2");
    // Near-duplicate — should reinforce, not add new
    expect(store.size).toBe(1);
    expect(id1).toBe(id2);
  });

  it("different categories are stored separately", () => {
    const store = makeStore();
    store.upsert("Monorepo with turbo", "architecture", "s1");
    store.upsert("Monorepo with turbo", "workflow", "s1"); // different category
    expect(store.size).toBe(2);
  });

  it("fact has required fields", () => {
    const store = makeStore();
    const id = store.upsert("Test fact", "bug", "session-x");
    const facts: KnowledgeFact[] = store.query();
    const fact = facts.find((f) => f.id === id);
    expect(fact).toBeDefined();
    expect(fact?.confidence).toBeGreaterThan(0);
    expect(fact?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fact?.sessionRefs).toContain("session-x");
  });
});

// ─── query ────────────────────────────────────────────────────────────────────

describe("ProjectKnowledgeStore.query", () => {
  it("returns all facts when no category filter", () => {
    const store = makeStore();
    store.upsert("Arch fact", "architecture", "s1");
    store.upsert("Bug fact", "bug", "s1");
    const results = store.query();
    expect(results.length).toBe(2);
  });

  it("filters by category", () => {
    const store = makeStore();
    store.upsert("Arch fact", "architecture", "s1");
    store.upsert("Bug fact", "bug", "s1");
    const archFacts: KnowledgeFact[] = store.query("architecture");
    expect(archFacts).toHaveLength(1);
    expect(archFacts[0]?.category).toBe("architecture");
  });

  it("respects limit parameter", () => {
    const store = makeStore();
    for (let i = 0; i < 10; i++) {
      store.upsert(`Fact ${i}: unique content here`, "context", "s1");
    }
    const results = store.query(undefined, 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("increments hitCount when sessionId provided", () => {
    const store = makeStore();
    const id = store.upsert("Tracked fact", "preference", "s1");
    store.query(undefined, 10, "s2");
    const facts = store.query();
    const fact = facts.find((f) => f.id === id);
    expect((fact?.hitCount ?? 0)).toBeGreaterThanOrEqual(1);
  });
});

// ─── formatForPrompt ──────────────────────────────────────────────────────────

describe("ProjectKnowledgeStore.formatForPrompt", () => {
  it("returns empty string when no facts", () => {
    const store = makeStore();
    expect(store.formatForPrompt()).toBe("");
  });

  it("returns markdown block with heading when facts exist", () => {
    const store = makeStore();
    store.upsert("Uses TypeScript strict mode", "convention", "s1");
    const block = store.formatForPrompt();
    expect(block).toContain("## Project Knowledge");
    expect(block).toContain("Uses TypeScript strict mode");
    expect(block).toContain("[convention]");
  });

  it("limit parameter caps output", () => {
    const store = makeStore();
    for (let i = 0; i < 20; i++) {
      store.upsert(`Unique fact number ${i} about the project code`, "context", "s1");
    }
    const block = store.formatForPrompt(5);
    const lines = block.split("\n").filter((l) => l.startsWith("-"));
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it("output is suitable for system prompt injection (starts with ##)", () => {
    const store = makeStore();
    store.upsert("Vitest for testing", "workflow", "s1");
    const block = store.formatForPrompt();
    expect(block.startsWith("##")).toBe(true);
  });
});

// ─── remove ───────────────────────────────────────────────────────────────────

describe("ProjectKnowledgeStore.remove", () => {
  it("removes a fact by id", () => {
    const store = makeStore();
    const id = store.upsert("Remove me", "bug", "s1");
    expect(store.size).toBe(1);
    const removed = store.remove(id);
    expect(removed).toBe(true);
    expect(store.size).toBe(0);
  });

  it("returns false for unknown id", () => {
    const store = makeStore();
    expect(store.remove("nonexistent-id")).toBe(false);
  });
});

// ─── sidebar injection contract ───────────────────────────────────────────────

describe("Project knowledge sidebar injection", () => {
  it("formatForPrompt output injected into system prompt when facts exist", () => {
    const store = makeStore();
    store.upsert("Project uses monorepo with turbo", "architecture", "session-a");
    const block = store.formatForPrompt(8, "session-b");
    // Simulates what sidebar does: push to systemParts if block is non-empty
    const systemParts: string[] = [];
    if (block) {
      systemParts.push(block);
      systemParts.push("");
    }
    expect(systemParts).toHaveLength(2);
    expect(systemParts[0]).toContain("monorepo");
  });

  it("no injection when store is empty (no extra system prompt pollution)", () => {
    const store = makeStore();
    const block = store.formatForPrompt();
    const systemParts: string[] = [];
    if (block) {
      systemParts.push(block);
    }
    expect(systemParts).toHaveLength(0);
  });

  it("knowledge categories cover all valid values", () => {
    const categories: KnowledgeCategory[] = [
      "architecture", "convention", "preference", "bug", "workflow", "context"
    ];
    const store = makeStore();
    for (const cat of categories) {
      store.upsert(`Fact for ${cat}`, cat, "s1");
    }
    expect(store.size).toBe(categories.length);
  });
});
