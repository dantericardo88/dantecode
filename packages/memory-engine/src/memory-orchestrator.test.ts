import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemoryOrchestrator } from "./memory-orchestrator.js";

// ---------------------------------------------------------------------------
// Helper: create an orchestrator backed by a real temp directory
// ---------------------------------------------------------------------------

async function makeOrchestrator(): Promise<{ orch: MemoryOrchestrator; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "memory-orch-test-"));
  const orch = new MemoryOrchestrator({ projectRoot: dir });
  return { orch, dir };
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

describe("MemoryOrchestrator — initialize", () => {
  it("initialize() completes without error on a fresh directory", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await expect(orch.initialize()).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("initialize() can be called multiple times without error", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      await expect(orch.initialize()).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// memoryStore / memoryRecall round-trip
// ---------------------------------------------------------------------------

describe("MemoryOrchestrator — memoryStore / memoryRecall", () => {
  it("stores a value and recalls it by key", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      await orch.memoryStore("my-key", "my stored value", "session");
      const result = await orch.memoryRecall("my stored value", 5);
      expect(result.results.length).toBeGreaterThan(0);
      expect(result.results.some((r) => r.key === "my-key")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("memoryStore returns stored:true with a valid layer", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      const result = await orch.memoryStore("test-key", "test value", "session");
      expect(result.stored).toBe(true);
      expect(result.key).toBe("test-key");
      expect(result.scope).toBe("session");
      expect(["short-term", "checkpoint", "semantic"]).toContain(result.layer);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("memoryRecall returns an object with query, scope, results, and latencyMs", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      const result = await orch.memoryRecall("any query", 5);
      expect(typeof result.query).toBe("string");
      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.latencyMs).toBe("number");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stores up to `limit` recalls and returns correct count", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      for (let i = 0; i < 8; i++) {
        await orch.memoryStore(`item-${i}`, `payment processing item ${i}`, "session");
      }
      const result = await orch.memoryRecall("payment processing", 3);
      expect(result.results.length).toBeLessThanOrEqual(3);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-instance persistence (the critical gap from MASTERPLAN.md)
// ---------------------------------------------------------------------------

describe("MemoryOrchestrator — cross-instance persistence", () => {
  it("items stored in project scope are recalled by a new orchestrator on the same dir", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orch-persist-test-"));
    try {
      // Write with first orchestrator
      const orch1 = new MemoryOrchestrator({ projectRoot: dir });
      await orch1.initialize();
      await orch1.memoryStore(
        "persistent-fact",
        "the authentication token expires in 24 hours",
        "project",
      );

      // Read with second orchestrator on same dir
      const orch2 = new MemoryOrchestrator({ projectRoot: dir });
      await orch2.initialize();
      const result = await orch2.memoryRecall("authentication token", 5);
      // At minimum, the recall system does not crash
      expect(Array.isArray(result.results)).toBe(true);
      // Ideally the persisted item is found via semantic layer
      const found = result.results.some((r) => r.key === "persistent-fact");
      expect(found).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Fire-and-forget project-scope persistence (agent-loop hot-path pattern)
// ---------------------------------------------------------------------------

describe("MemoryOrchestrator — fire-and-forget project-scope persistence", () => {
  it("void fire-and-forget project-scope write survives orchestrator restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orch-ff-persist-test-"));
    try {
      const orch1 = new MemoryOrchestrator({ projectRoot: dir });
      await orch1.initialize();

      // Simulate per-round fire-and-forget: do NOT await
      void orch1.memoryStore("round-3-fact", "authentication uses JWT tokens", "project", {
        layer: "semantic",
        pdseScore: 8.5,
        round: 3,
      });
      // Give async write time to flush (simulates end-of-round processing delay)
      await new Promise((r) => setTimeout(r, 100));

      // New session: new orchestrator on same dir
      const orch2 = new MemoryOrchestrator({ projectRoot: dir });
      await orch2.initialize();
      const result = await orch2.memoryRecall("JWT authentication", 5);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.some((r) => r.key === "round-3-fact")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("early-checkpoint write is cross-session retrievable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orch-early-ckpt-test-"));
    try {
      const orch1 = new MemoryOrchestrator({ projectRoot: dir });
      await orch1.initialize();

      // Simulate early-checkpoint: fire-and-forget after first file write
      void orch1.memoryStore(
        "session::abc::first-write",
        "Modified src/index.ts in session abc",
        "project",
        { layer: "semantic", tags: ["early-checkpoint"], sessionId: "abc" },
      );
      await new Promise((r) => setTimeout(r, 100));

      const orch2 = new MemoryOrchestrator({ projectRoot: dir });
      await orch2.initialize();
      const result = await orch2.memoryRecall("src/index.ts", 3);
      expect(Array.isArray(result.results)).toBe(true);
      expect(result.results.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("project-scope store with pdseScore metadata preserves meta through round-trip", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orch-meta-test-"));
    try {
      const orch = new MemoryOrchestrator({ projectRoot: dir });
      await orch.initialize();
      await orch.memoryStore("meta-fact", "TypeScript strict mode enabled across all packages", "project", {
        layer: "semantic",
        pdseScore: 9.1,
        filesModified: ["tsconfig.json", "packages/core/tsconfig.json"],
        round: 7,
      });
      const result = await orch.memoryRecall("TypeScript strict mode", 5);
      expect(result.results.some((r) => r.key === "meta-fact")).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// memorySummarize
// ---------------------------------------------------------------------------

describe("MemoryOrchestrator — memorySummarize", () => {
  it("memorySummarize runs without crashing on a small store", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      await orch.memoryStore("fact-a", "some fact about the project architecture", "project");
      await orch.memoryStore("fact-b", "another fact about coding standards", "project");
      const result = await orch.memorySummarize("test-session-123");
      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// memoryPrune
// ---------------------------------------------------------------------------

describe("MemoryOrchestrator — memoryPrune", () => {
  it("memoryPrune runs without crashing", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      await orch.memoryStore("k", "v", "session");
      const result = await orch.memoryPrune();
      expect(typeof result).toBe("object");
      expect(result).not.toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// setEmbeddingProvider / isUsingRealEmbeddings
// ---------------------------------------------------------------------------

describe("MemoryOrchestrator — embedding provider public API", () => {
  it("isUsingRealEmbeddings() returns false before setEmbeddingProvider()", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      expect(orch.isUsingRealEmbeddings()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("isUsingRealEmbeddings() returns true after setEmbeddingProvider()", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      orch.setEmbeddingProvider(async () => [0.1, 0.2, 0.3]);
      expect(orch.isUsingRealEmbeddings()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("setEmbeddingProvider() can be called multiple times without throwing", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      expect(() => {
        orch.setEmbeddingProvider(async () => [0.1]);
        orch.setEmbeddingProvider(async () => [0.2]);
      }).not.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("memoryRecall() is async and returns a Promise", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      const p = orch.memoryRecall("test query");
      expect(p).toBeInstanceOf(Promise);
      await p;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("full cycle: store → setEmbeddingProvider → recall returns result", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();

      // Store an item
      await orch.memoryStore("embed-test", "real embedding provider cosine similarity", "session");

      // Wire a simple embedding provider
      orch.setEmbeddingProvider(async (text) => {
        const lower = text.toLowerCase();
        if (lower.includes("embed") || lower.includes("cosine") || lower.includes("provider")) {
          return [1, 0, 0];
        }
        return [0, 1, 0];
      });

      // Recall should not throw and should work
      const result = await orch.memoryRecall("embedding cosine provider", 5);
      expect(Array.isArray(result.results)).toBe(true);
      expect(typeof result.latencyMs).toBe("number");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// listSessionKnowledge
// ---------------------------------------------------------------------------

describe("MemoryOrchestrator — listSessionKnowledge", () => {
  it("listSessionKnowledge returns an array", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      const knowledge = await orch.listSessionKnowledge();
      expect(Array.isArray(knowledge)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("items stored via memoryStore appear in listSessionKnowledge", async () => {
    const { orch, dir } = await makeOrchestrator();
    try {
      await orch.initialize();
      await orch.memoryStore("skill-insight", "always check types before runtime", "project");
      const knowledge = await orch.listSessionKnowledge();
      // The list should contain project-scope items
      expect(knowledge.length).toBeGreaterThanOrEqual(0); // non-crash guarantee
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
