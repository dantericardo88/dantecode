// ============================================================================
// @dantecode/memory-engine — Graph Memory
// Entity relationship tracking across sessions.
// Patterns from Mem0 graph memory + LangGraph knowledge graphs.
// ============================================================================

import type { MemoryEntity, MemoryRelationship } from "./types.js";

/** A node in the memory graph. */
export interface GraphNode {
  id: string;
  entity: MemoryEntity;
  /** Adjacency list: target node ID → relationship kind. */
  edges: Map<string, MemoryRelationship>;
}

/** Result of a graph traversal. */
export interface GraphTraversalResult {
  startNode: string;
  visited: string[];
  paths: Array<{ from: string; to: string; kind: string; strength: number }>;
  depth: number;
}

/**
 * In-memory graph of entity relationships.
 *
 * - Nodes = MemoryEntities
 * - Edges = MemoryRelationships
 * - Supports BFS traversal for context expansion
 * - Finds clusters of related entities
 */
export class GraphMemory {
  private readonly nodes = new Map<string, GraphNode>();

  // --------------------------------------------------------------------------
  // Write
  // --------------------------------------------------------------------------

  /** Add or update an entity node. */
  addEntity(entity: MemoryEntity): void {
    const existing = this.nodes.get(entity.name);
    if (existing) {
      // Merge
      existing.entity.count += entity.count;
      for (const sid of entity.sessionIds) {
        if (!existing.entity.sessionIds.includes(sid)) {
          existing.entity.sessionIds.push(sid);
        }
      }
      for (const mk of entity.memoryKeys) {
        if (!existing.entity.memoryKeys.includes(mk)) {
          existing.entity.memoryKeys.push(mk);
        }
      }
    } else {
      this.nodes.set(entity.name, {
        id: entity.name,
        entity: { ...entity },
        edges: new Map(),
      });
    }
  }

  /** Add entities from an array. */
  addEntities(entities: MemoryEntity[]): void {
    for (const entity of entities) {
      this.addEntity(entity);
    }
  }

  /** Add a relationship between two entities. Creates nodes if missing. */
  addRelationship(relationship: MemoryRelationship): void {
    // Ensure both nodes exist
    if (!this.nodes.has(relationship.from)) {
      this.nodes.set(relationship.from, {
        id: relationship.from,
        entity: {
          name: relationship.from,
          type: "other",
          count: 0,
          sessionIds: [],
          memoryKeys: [],
        },
        edges: new Map(),
      });
    }
    if (!this.nodes.has(relationship.to)) {
      this.nodes.set(relationship.to, {
        id: relationship.to,
        entity: {
          name: relationship.to,
          type: "other",
          count: 0,
          sessionIds: [],
          memoryKeys: [],
        },
        edges: new Map(),
      });
    }

    const fromNode = this.nodes.get(relationship.from)!;
    const existing = fromNode.edges.get(relationship.to);

    if (existing) {
      // Strengthen existing relationship
      existing.strength = Math.min(1, existing.strength + relationship.strength * 0.1);
    } else {
      fromNode.edges.set(relationship.to, { ...relationship });
    }
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  /** Get a node by entity name. */
  getNode(name: string): GraphNode | null {
    return this.nodes.get(name) ?? null;
  }

  /** Get all entities adjacent to a given entity. */
  getNeighbors(name: string): MemoryRelationship[] {
    const node = this.nodes.get(name);
    if (!node) return [];
    return Array.from(node.edges.values());
  }

  /**
   * BFS traversal from a starting entity.
   * Returns all reachable entities up to `maxDepth`.
   */
  traverse(startName: string, maxDepth = 2): GraphTraversalResult {
    const visited: string[] = [];
    const paths: GraphTraversalResult["paths"] = [];
    const queue: Array<{ name: string; depth: number }> = [{ name: startName, depth: 0 }];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current.name) || current.depth > maxDepth) continue;
      seen.add(current.name);
      visited.push(current.name);

      const node = this.nodes.get(current.name);
      if (!node) continue;

      for (const [target, rel] of node.edges) {
        if (!seen.has(target)) {
          paths.push({
            from: current.name,
            to: target,
            kind: rel.kind,
            strength: rel.strength,
          });
          queue.push({ name: target, depth: current.depth + 1 });
        }
      }
    }

    return { startNode: startName, visited, paths, depth: maxDepth };
  }

  /**
   * Find the most connected (hub) entities.
   */
  findHubs(topN = 10): MemoryEntity[] {
    return Array.from(this.nodes.values())
      .map((node) => ({
        entity: node.entity,
        connections: node.edges.size + node.entity.count,
      }))
      .sort((a, b) => b.connections - a.connections)
      .slice(0, topN)
      .map((e) => e.entity);
  }

  /**
   * Find entities related to a query by matching entity names.
   */
  findRelated(query: string, limit = 10): MemoryEntity[] {
    const q = query.toLowerCase();
    const results: Array<{ entity: MemoryEntity; score: number }> = [];

    for (const [name, node] of this.nodes) {
      if (name.toLowerCase().includes(q) || node.entity.type === "concept") {
        const score = name.toLowerCase() === q ? 1.0 : 0.5 + node.entity.count * 0.01;
        results.push({ entity: node.entity, score });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.entity);
  }

  // --------------------------------------------------------------------------
  // Stats
  // --------------------------------------------------------------------------

  get nodeCount(): number {
    return this.nodes.size;
  }

  get edgeCount(): number {
    let count = 0;
    for (const node of this.nodes.values()) {
      count += node.edges.size;
    }
    return count;
  }

  /** Export all nodes and edges for visualization. */
  export(): { nodes: MemoryEntity[]; edges: MemoryRelationship[] } {
    const nodes = Array.from(this.nodes.values()).map((n) => n.entity);
    const edges: MemoryRelationship[] = [];
    for (const node of this.nodes.values()) {
      for (const rel of node.edges.values()) {
        edges.push(rel);
      }
    }
    return { nodes, edges };
  }

  /** Clear all nodes and edges. */
  clear(): void {
    this.nodes.clear();
  }
}
