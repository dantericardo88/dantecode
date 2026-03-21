// ============================================================================
// @dantecode/memory-engine — Memory Visualizer
// Generates entity/relationship maps + scope summaries. GF-07 golden flow.
// ============================================================================

import type { MemoryVisualizeResult, MemoryScope } from "./types.js";
import type { GraphMemory } from "./graph-memory.js";
import type { ShortTermStore } from "./short-term-store.js";
import type { VectorStore } from "./vector-store.js";

/**
 * Memory Visualizer produces structured visualization data.
 *
 * Output format is JSON-serializable for:
 * - VS Code sidebar tree rendering
 * - CLI table display
 * - Downstream graph renderers (D3, Mermaid, etc.)
 */
export class MemoryVisualizer {
  private readonly graphMemory: GraphMemory;
  private readonly shortTerm: ShortTermStore;
  private readonly vectorStore: VectorStore;

  constructor(graphMemory: GraphMemory, shortTerm: ShortTermStore, vectorStore: VectorStore) {
    this.graphMemory = graphMemory;
    this.shortTerm = shortTerm;
    this.vectorStore = vectorStore;
  }

  // --------------------------------------------------------------------------
  // Core visualization
  // --------------------------------------------------------------------------

  /**
   * Generate a full visualization of the memory state.
   * GF-07: entity/relationship map + scope summary.
   */
  visualize(scope?: MemoryScope): MemoryVisualizeResult {
    const nodes: Array<Record<string, unknown>> = [];
    const edges: Array<Record<string, unknown>> = [];

    // Add scope overview nodes
    const scopes: MemoryScope[] = scope ? [scope] : ["session", "project", "user", "global"];

    for (const s of scopes) {
      const stItems = this.shortTerm.listByScope(s);
      const vecItems = this.vectorStore.listByScope(s);

      nodes.push({
        id: `scope:${s}`,
        type: "scope",
        label: s.toUpperCase(),
        shortTermCount: stItems.length,
        semanticCount: vecItems.length,
        avgScore: average(vecItems.map((i) => i.score)),
      });
    }

    // Add entity nodes from graph
    const { nodes: entityNodes, edges: entityEdges } = this.graphMemory.export();

    for (const entity of entityNodes) {
      nodes.push({
        id: `entity:${entity.name}`,
        type: "entity",
        label: entity.name,
        entityType: entity.type,
        count: entity.count,
        sessionCount: entity.sessionIds.length,
      });
    }

    // Add relationship edges
    for (const rel of entityEdges) {
      edges.push({
        source: `entity:${rel.from}`,
        target: `entity:${rel.to}`,
        kind: rel.kind,
        strength: rel.strength,
      });
    }

    // Add top short-term items as nodes
    const topST = this.shortTerm
      .listAll()
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    for (const item of topST) {
      nodes.push({
        id: `st:${item.scope}:${item.key}`,
        type: "short-term",
        label: item.key.slice(0, 50),
        scope: item.scope,
        score: item.score,
        recallCount: item.recallCount,
        verified: item.verified ?? false,
      });

      // Edge: scope → item
      edges.push({
        source: `scope:${item.scope}`,
        target: `st:${item.scope}:${item.key}`,
        kind: "contains",
        strength: item.score,
      });
    }

    // Add top semantic items
    const topVec = this.vectorStore
      .listAll()
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);

    for (const item of topVec) {
      // Avoid duplicate node if already in ST
      const existing = nodes.find((n) => n["id"] === `st:${item.scope}:${item.key}`);
      if (existing) continue;

      nodes.push({
        id: `sem:${item.scope}:${item.key}`,
        type: "semantic",
        label: item.key.slice(0, 50),
        scope: item.scope,
        score: item.score,
        recallCount: item.recallCount,
        summary: item.summary?.slice(0, 100),
      });

      edges.push({
        source: `scope:${item.scope}`,
        target: `sem:${item.scope}:${item.key}`,
        kind: "contains",
        strength: item.score,
      });
    }

    return { nodes, edges };
  }

  /**
   * Generate a Mermaid diagram string for the memory graph.
   */
  toMermaid(scope?: MemoryScope): string {
    const result = this.visualize(scope);
    const lines = ["graph LR"];

    // Scopes
    for (const node of result.nodes) {
      if (node["type"] === "scope") {
        lines.push(
          `  ${node["id"]}["${node["label"]} (ST:${node["shortTermCount"]} SEM:${node["semanticCount"]})"]`,
        );
      } else if (node["type"] === "entity") {
        lines.push(
          `  ${String(node["id"]).replace(/[^a-zA-Z0-9_]/g, "_")}["${node["label"]} (${node["entityType"]})"]`,
        );
      }
    }

    // Edges
    for (const edge of result.edges) {
      const src = String(edge["source"]).replace(/[^a-zA-Z0-9_]/g, "_");
      const tgt = String(edge["target"]).replace(/[^a-zA-Z0-9_]/g, "_");
      lines.push(`  ${src} -->|${edge["kind"]}| ${tgt}`);
    }

    return lines.join("\n");
  }

  /**
   * Generate a text summary table of memory state.
   */
  toTextSummary(): string {
    const scopes: MemoryScope[] = ["session", "project", "user", "global"];
    const lines = ["# Memory State Summary", ""];

    for (const scope of scopes) {
      const stItems = this.shortTerm.listByScope(scope);
      const vecItems = this.vectorStore.listByScope(scope);
      if (stItems.length === 0 && vecItems.length === 0) continue;

      lines.push(`## ${scope.toUpperCase()}`);
      lines.push(`- Short-term: ${stItems.length} items`);
      lines.push(`- Semantic: ${vecItems.length} items`);

      if (vecItems.length > 0) {
        const top = vecItems.sort((a, b) => b.score - a.score).slice(0, 3);
        lines.push(`- Top items: ${top.map((i) => i.key).join(", ")}`);
      }
      lines.push("");
    }

    const graphStats = this.graphMemory.export();
    lines.push("## Graph");
    lines.push(`- Entities: ${graphStats.nodes.length}`);
    lines.push(`- Relationships: ${graphStats.edges.length}`);

    if (graphStats.nodes.length > 0) {
      const hubs = this.graphMemory.findHubs(3);
      lines.push(`- Hub entities: ${hubs.map((e) => e.name).join(", ")}`);
    }

    return lines.join("\n");
  }
}

// ----------------------------------------------------------------------------
// Utility
// ----------------------------------------------------------------------------

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
