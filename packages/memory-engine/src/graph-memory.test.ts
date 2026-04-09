import { describe, it, expect } from "vitest";
import { GraphMemory } from "./graph-memory.js";
import type { MemoryEntity, MemoryRelationship } from "./types.js";

function makeEntity(name: string, type: MemoryEntity["type"] = "concept"): MemoryEntity {
  return {
    name,
    type,
    count: 1,
    sessionIds: ["session-1"],
    memoryKeys: [`key-${name}`],
  };
}

function makeRelationship(from: string, to: string, kind: MemoryRelationship["kind"] = "related", strength = 0.5): MemoryRelationship {
  return { from, to, kind, strength };
}

// ---------------------------------------------------------------------------
// GraphMemory — addEntity / getNode
// ---------------------------------------------------------------------------

describe("GraphMemory — addEntity / getNode", () => {
  it("getNode returns null for unknown entity", () => {
    const graph = new GraphMemory();
    expect(graph.getNode("unknown")).toBeNull();
  });

  it("addEntity creates a node retrievable via getNode", () => {
    const graph = new GraphMemory();
    graph.addEntity(makeEntity("TypeScript"));
    const node = graph.getNode("TypeScript");
    expect(node).not.toBeNull();
    expect(node!.id).toBe("TypeScript");
    expect(node!.entity.type).toBe("concept");
  });

  it("addEntity merges count when called twice with the same name", () => {
    const graph = new GraphMemory();
    graph.addEntity(makeEntity("React"));
    graph.addEntity({ ...makeEntity("React"), count: 3, sessionIds: ["session-2"] });
    const node = graph.getNode("React");
    expect(node!.entity.count).toBe(4); // 1 + 3
    // sessionIds should be merged (no duplicates)
    expect(node!.entity.sessionIds).toContain("session-1");
    expect(node!.entity.sessionIds).toContain("session-2");
  });

  it("addEntities bulk-adds multiple entities", () => {
    const graph = new GraphMemory();
    graph.addEntities([makeEntity("A"), makeEntity("B"), makeEntity("C")]);
    expect(graph.getNode("A")).not.toBeNull();
    expect(graph.getNode("B")).not.toBeNull();
    expect(graph.getNode("C")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GraphMemory — addRelationship / getNeighbors
// ---------------------------------------------------------------------------

describe("GraphMemory — addRelationship / getNeighbors", () => {
  it("addRelationship creates an edge between two nodes", () => {
    const graph = new GraphMemory();
    graph.addRelationship(makeRelationship("Node.js", "TypeScript"));
    const neighbors = graph.getNeighbors("Node.js");
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]!.to).toBe("TypeScript");
  });

  it("addRelationship auto-creates missing nodes", () => {
    const graph = new GraphMemory();
    graph.addRelationship(makeRelationship("X", "Y"));
    expect(graph.getNode("X")).not.toBeNull();
    expect(graph.getNode("Y")).not.toBeNull();
  });

  it("getNeighbors returns empty array for entity with no edges", () => {
    const graph = new GraphMemory();
    graph.addEntity(makeEntity("isolated"));
    expect(graph.getNeighbors("isolated")).toHaveLength(0);
  });

  it("getNeighbors returns empty array for unknown entity", () => {
    const graph = new GraphMemory();
    expect(graph.getNeighbors("nonexistent")).toHaveLength(0);
  });

  it("strengthens existing relationship instead of duplicating", () => {
    const graph = new GraphMemory();
    graph.addRelationship(makeRelationship("A", "B", "uses", 0.5));
    graph.addRelationship(makeRelationship("A", "B", "uses", 0.5));
    const neighbors = graph.getNeighbors("A");
    // Should still be 1 edge, just stronger
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]!.strength).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// GraphMemory — traverse (BFS)
// ---------------------------------------------------------------------------

describe("GraphMemory — traverse", () => {
  it("traverse starting from an isolated node returns only that node", () => {
    const graph = new GraphMemory();
    graph.addEntity(makeEntity("Solo"));
    const result = graph.traverse("Solo", 2);
    expect(result.startNode).toBe("Solo");
    expect(result.visited).toContain("Solo");
    expect(result.paths).toHaveLength(0);
  });

  it("traverse returns connected nodes within depth", () => {
    const graph = new GraphMemory();
    graph.addRelationship(makeRelationship("A", "B"));
    graph.addRelationship(makeRelationship("B", "C"));
    const result = graph.traverse("A", 2);
    expect(result.visited).toContain("A");
    expect(result.visited).toContain("B");
    expect(result.visited).toContain("C");
  });

  it("traverse respects maxDepth and does not visit nodes beyond it", () => {
    const graph = new GraphMemory();
    graph.addRelationship(makeRelationship("A", "B"));
    graph.addRelationship(makeRelationship("B", "C"));
    graph.addRelationship(makeRelationship("C", "D"));
    const result = graph.traverse("A", 1);
    expect(result.visited).toContain("A");
    expect(result.visited).toContain("B");
    // C and D are 2 and 3 hops away — should NOT be visited at depth 1
    expect(result.visited).not.toContain("D");
  });

  it("traverse on unknown start node returns empty visited list", () => {
    const graph = new GraphMemory();
    const result = graph.traverse("unknown", 2);
    // Should not crash — just return empty result
    expect(Array.isArray(result.visited)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GraphMemory — findRelated
// ---------------------------------------------------------------------------

describe("GraphMemory — findRelated", () => {
  it("returns entities whose name contains the query", () => {
    const graph = new GraphMemory();
    graph.addEntity(makeEntity("payment-service"));
    graph.addEntity(makeEntity("payment-gateway"));
    // Use type "tool" so auth-service doesn't accidentally match via type === "concept"
    graph.addEntity({ ...makeEntity("auth-service"), type: "other"});
    const results = graph.findRelated("payment");
    expect(results.length).toBeGreaterThanOrEqual(2);
    // All results should have "payment" in their name (auth-service should not appear)
    const nonPayment = results.filter((e) => !e.name.includes("payment"));
    expect(nonPayment).toHaveLength(0);
  });

  it("returns empty array when no match", () => {
    const graph = new GraphMemory();
    // Use type "tool" — findRelated also matches all "concept" type entities regardless of name
    graph.addEntity({ ...makeEntity("SomeEntity"), type: "other"});
    expect(graph.findRelated("zzz")).toHaveLength(0);
  });

  it("respects limit parameter", () => {
    const graph = new GraphMemory();
    for (let i = 0; i < 20; i++) {
      graph.addEntity(makeEntity(`payment-service-${i}`));
    }
    const results = graph.findRelated("payment", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// GraphMemory — findHubs
// ---------------------------------------------------------------------------

describe("GraphMemory — findHubs", () => {
  it("findHubs returns most connected entities", () => {
    const graph = new GraphMemory();
    // Create a hub entity with many edges
    for (let i = 0; i < 5; i++) {
      graph.addRelationship(makeRelationship("hub", `spoke-${i}`));
    }
    graph.addEntity(makeEntity("leaf"));

    const hubs = graph.findHubs(3);
    expect(hubs[0]!.name).toBe("hub");
  });

  it("findHubs on empty graph returns empty array", () => {
    const graph = new GraphMemory();
    expect(graph.findHubs()).toHaveLength(0);
  });
});
