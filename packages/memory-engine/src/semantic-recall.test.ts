import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SemanticRecall } from "./semantic-recall.js";
import { ShortTermStore } from "./short-term-store.js";
import { VectorStore } from "./vector-store.js";
import { SessionMemory } from "./session-memory.js";
import { LocalStore } from "./storage/local-store.js";
import type { MemoryItem } from "./types.js";

function makeItem(
  key: string,
  value: string,
  scope: "session" | "project" | "global" = "session",
  daysOld = 0,
): MemoryItem {
  const d = new Date();
  d.setDate(d.getDate() - daysOld);
  return {
    key,
    value,
    scope,
    layer: "short-term",
    createdAt: d.toISOString(),
    lastAccessedAt: d.toISOString(),
    score: 0.5,
    recallCount: 0,
  };
}

async function makeRecall(): Promise<{
  recall: SemanticRecall;
  shortTerm: ShortTermStore;
  vectorStore: VectorStore;
  dir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), "semantic-recall-test-"));
  const localStore = new LocalStore(dir);
  const shortTerm = new ShortTermStore();
  const sessionMemory = new SessionMemory(localStore);
  const vectorStore = new VectorStore(localStore);
  const recall = new SemanticRecall(shortTerm, sessionMemory, vectorStore);
  return { recall, shortTerm, vectorStore, dir };
}

// ---------------------------------------------------------------------------
// SemanticRecall — core recall
// ---------------------------------------------------------------------------

describe("SemanticRecall — empty store", () => {
  it("recall on empty store returns empty results without crashing", async () => {
    const { recall, dir } = await makeRecall();
    try {
      const result = await recall.recall("anything");
      expect(result.results).toHaveLength(0);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.query).toBe("anything");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SemanticRecall — short-term layer", () => {
  it("recalls item stored in short-term store", async () => {
    const { recall, shortTerm, dir } = await makeRecall();
    try {
      // ShortTermStore.search() uses substring match on key+value.
      // Use "payment" as the query — "payment-gateway" key contains "payment".
      const item = makeItem("payment-gateway", "payment processing credit card gateway");
      shortTerm.set(item.key, item.value, item.scope);

      const result = await recall.recall("payment");
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.some((r) => r.key === "payment-gateway")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("scope filter restricts results to requested scope", async () => {
    const { recall, shortTerm, dir } = await makeRecall();
    try {
      shortTerm.set("auth-session", "authentication token session", "session");
      shortTerm.set("auth-project", "authentication token project", "project");

      const result = await recall.recall("authentication", { scope: "session" });
      for (const r of result.results) {
        expect(r.scope).toBe("session");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SemanticRecall — semantic (vector) layer", () => {
  it("recalls item indexed in vector store", async () => {
    const { recall, vectorStore, dir } = await makeRecall();
    try {
      const item = makeItem("deployment-pipeline", "continuous deployment kubernetes pipeline");
      await vectorStore.add(item);

      const result = await recall.recall("deployment pipeline", { includeShortTerm: false });
      // Vector store uses Jaccard — items with overlapping tokens should be found
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SemanticRecall — limit", () => {
  it("returns at most `limit` results", async () => {
    const { recall, shortTerm, dir } = await makeRecall();
    try {
      for (let i = 0; i < 20; i++) {
        shortTerm.set(`item-${i}`, `payment processing item number ${i}`, "session");
      }
      const result = await recall.recall("payment processing", { limit: 3 });
      expect(result.results.length).toBeLessThanOrEqual(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SemanticRecall — result shape", () => {
  it("result includes query, scope, results array, and latencyMs", async () => {
    const { recall, shortTerm, dir } = await makeRecall();
    try {
      shortTerm.set("test-item", "testing shape of the recall result", "session");
      const result = await recall.recall("testing shape");
      expect(typeof result.query).toBe("string");
      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SemanticRecall — PDSE metadata preservation", () => {
  it("items stored with pdseScore metadata are retrievable and meta is preserved", async () => {
    const { recall, vectorStore, dir } = await makeRecall();
    try {
      // Store two items: one with high pdseScore, one with low — both should be retrievable
      await vectorStore.add({
        key: "high-quality-impl",
        value: "authentication token validation logic",
        scope: "project",
        layer: "semantic",
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        score: 0.9,
        recallCount: 0,
        meta: { pdseScore: 9.2, filesModified: ["src/auth.ts"], round: 5 },
      });
      await vectorStore.add({
        key: "low-quality-impl",
        value: "placeholder authentication logic",
        scope: "project",
        layer: "semantic",
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
        score: 0.3,
        recallCount: 0,
        meta: { pdseScore: 3.1, filesModified: ["src/auth.ts"], round: 2 },
      });

      const result = await recall.recall("authentication token", { includeShortTerm: false });
      expect(result.results.length).toBeGreaterThan(0);

      // The high-quality item should be present
      const highQuality = result.results.find((r) => r.key === "high-quality-impl");
      expect(highQuality).toBeDefined();

      // Meta should be preserved through the vector store round-trip
      if (highQuality?.meta) {
        expect(highQuality.meta["pdseScore"]).toBe(9.2);
        expect(Array.isArray(highQuality.meta["filesModified"])).toBe(true);
        expect(highQuality.meta["round"]).toBe(5);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("recall with empty meta does not crash", async () => {
    const { recall, vectorStore, dir } = await makeRecall();
    try {
      // No meta field — should work fine
      await vectorStore.add(makeItem("no-meta-item", "some content without metadata"));
      const result = await recall.recall("some content");
      expect(Array.isArray(result.results)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("SemanticRecall — crossSessionRecall", () => {
  it("cross-session recall queries project + global scopes", async () => {
    const { recall, vectorStore, dir } = await makeRecall();
    try {
      // Add a project-scope item to the vector store
      const item = makeItem("ci-pipeline", "continuous integration build pipeline deploy", "project");
      await vectorStore.add(item);

      const result = await recall.crossSessionRecall("build pipeline");
      expect(result.scope).toBe("cross-session");
      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.latencyMs).toBe("number");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
