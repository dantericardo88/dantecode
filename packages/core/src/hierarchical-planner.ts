// ============================================================================
// @dantecode/core - Hierarchical Wave Tree Planner
// Extends ArchitectPlanner with hierarchical decomposition of execution plans
// into wave-based dependency trees. Waves are derived from topological sort of
// PlanStep dependencies; high-complexity waves are recursively sub-decomposed.
// ============================================================================

import { randomUUID } from "node:crypto";
import { analyzeComplexity, type ExecutionPlan, type PlanStep } from "./architect-planner.js";

// ── Public Interfaces ────────────────────────────────────────────────────────

/**
 * A single node in the wave tree, representing one wave of related steps.
 */
export interface WaveNode {
  /** Unique node identifier (UUID v4). */
  id: string;
  /** Human-readable title derived from the first step or wave index. */
  title: string;
  /** Summary description of what this wave accomplishes. */
  description: string;
  /** Depth in the tree; root nodes have depth 0. */
  depth: number;
  /** Parent node id, undefined for root-level nodes. */
  parentId?: string;
  /** Child nodes created during sub-decomposition. */
  children: WaveNode[];
  /** The original PlanSteps contained in this wave. */
  steps: PlanStep[];
  /** Execution lifecycle status. */
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  /** Plan-Do-Solve-Execute score set upon completion (0–1). */
  pdseScore?: number;
}

/**
 * Top-level container for the hierarchical wave tree.
 */
export interface WaveTree {
  /** Unique tree identifier (UUID v4). */
  id: string;
  /** Root-level wave nodes (depth = 0). */
  rootNodes: WaveNode[];
  /** Total number of nodes across all depths. */
  totalNodes: number;
  /** Number of nodes currently in "completed" status. */
  completedNodes: number;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
}

/**
 * Options controlling re-decomposition behaviour.
 */
export interface ReDecomposeOptions {
  /**
   * Only re-decompose failed or pending branches, leaving completed nodes
   * untouched.  Default: true.
   */
  failedOnly?: boolean;
  /**
   * Maximum additional depth levels allowed during re-decomposition.
   * Default: 2.
   */
  maxAdditionalDepth?: number;
}

/**
 * Configuration for the HierarchicalPlanner.
 */
export interface HierarchicalPlannerOptions {
  /**
   * Maximum tree depth; nodes at this depth are never sub-decomposed further.
   * Default: 3.
   */
  maxDepth?: number;
  /**
   * Complexity score (0–1) above which a wave node is eligible for
   * sub-decomposition.  Default: 0.65.
   */
  complexityThreshold?: number;
}

// ── Internal Stats Type ──────────────────────────────────────────────────────

export interface TreeStats {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  running: number;
}

// ── HierarchicalPlanner ──────────────────────────────────────────────────────

/**
 * Converts a flat ExecutionPlan into a hierarchical WaveTree by grouping steps
 * into dependency-sorted waves and optionally sub-decomposing complex waves.
 *
 * @example
 * ```ts
 * const planner = new HierarchicalPlanner({ maxDepth: 3, complexityThreshold: 0.65 });
 * const tree = planner.generateWaveTree(plan);
 * const nextNodes = planner.getNextExecutable(tree);
 * ```
 */
export class HierarchicalPlanner {
  private readonly maxDepth: number;
  private readonly complexityThreshold: number;

  constructor(options: HierarchicalPlannerOptions = {}) {
    this.maxDepth = options.maxDepth ?? 3;
    this.complexityThreshold = options.complexityThreshold ?? 0.65;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Convert an ExecutionPlan into a WaveTree.
   *
   * Steps are grouped into waves via topological sort: steps with no unresolved
   * dependencies form wave 0, their dependents form wave 1, and so on.  Each
   * wave becomes a WaveNode at depth 0.  When a wave's combined description
   * exceeds the complexity threshold and the tree depth limit has not been
   * reached, child nodes are synthesised via sub-decomposition.
   *
   * @param plan - The execution plan to convert.
   * @param description - Optional override for root-level description context.
   * @returns A fully initialised WaveTree.
   */
  generateWaveTree(plan: ExecutionPlan, description?: string): WaveTree {
    const waves = this.groupStepsByWave(plan.steps);
    const rootNodes: WaveNode[] = waves.map((waveSteps, waveIndex) => {
      const node = this.createNode(`Wave ${waveIndex + 1}`, waveSteps, 0, undefined);

      // Attempt sub-decomposition when the wave is complex enough.
      if (this.shouldSubDecompose(node, 0)) {
        this.subDecompose(node, 1);
      }

      return node;
    });

    // Use the description parameter if provided (future extensibility).
    void description;

    const totalNodes = this.countNodes(rootNodes);

    return {
      id: randomUUID(),
      rootNodes,
      totalNodes,
      completedNodes: 0,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Re-decompose eligible nodes in an existing WaveTree.
   *
   * By default only failed or pending nodes are processed (`failedOnly: true`).
   * Completed nodes are never touched.  The `maxAdditionalDepth` option limits
   * how many additional levels can be added below a node's current depth.
   *
   * @param tree - The tree to modify in-place.
   * @param options - Re-decomposition configuration.
   * @returns The same tree reference with updated nodes and totalNodes.
   */
  reDecompose(tree: WaveTree, options: ReDecomposeOptions = {}): WaveTree {
    const failedOnly = options.failedOnly ?? true;
    const maxAdditionalDepth = options.maxAdditionalDepth ?? 2;

    const processNode = (node: WaveNode): void => {
      // Never touch completed nodes.
      if (node.status === "completed") return;

      // Skip running/skipped unless failedOnly is false.
      if (failedOnly && node.status !== "failed" && node.status !== "pending") return;

      // Recurse into children first (depth-first).
      for (const child of node.children) {
        processNode(child);
      }

      // Only sub-decompose leaf nodes that qualify.
      if (node.children.length === 0 && this.shouldSubDecompose(node, node.depth)) {
        const targetDepth = node.depth + 1;
        if (targetDepth <= node.depth + maxAdditionalDepth && targetDepth <= this.maxDepth) {
          this.subDecompose(node, targetDepth);
        }
      }
    };

    for (const root of tree.rootNodes) {
      processNode(root);
    }

    // Recount after structural changes.
    tree.totalNodes = this.countNodes(tree.rootNodes);

    return tree;
  }

  /**
   * Return all nodes that are ready to execute now.
   *
   * A node is executable when:
   * - Its status is "pending".
   * - All ancestor nodes are completed (i.e., the parent chain is clear).
   *
   * This implementation performs a breadth-first traversal and returns root
   * nodes whose status is "pending", plus child nodes whose parent is
   * "completed".
   *
   * @param tree - The tree to query.
   * @returns Array of WaveNodes ready to start.
   */
  getNextExecutable(tree: WaveTree): WaveNode[] {
    const executable: WaveNode[] = [];

    const visit = (nodes: WaveNode[], parentCompleted: boolean): void => {
      for (const node of nodes) {
        if (!parentCompleted) continue;
        if (node.status === "pending") {
          executable.push(node);
        }
        // Only descend into children if the current node is completed.
        if (node.status === "completed") {
          visit(node.children, true);
        }
      }
    };

    // Root nodes have an implicit "parent completed" = true.
    visit(tree.rootNodes, true);

    return executable;
  }

  /**
   * Mark a node as completed and record its PDSE score.
   *
   * Also increments the tree's `completedNodes` counter.
   *
   * @param tree - The tree containing the node.
   * @param nodeId - The id of the node to complete.
   * @param pdseScore - Optional quality score in the range 0–1.
   */
  completeNode(tree: WaveTree, nodeId: string, pdseScore?: number): void {
    const node = this.findNode(tree, nodeId);
    if (!node) return;

    node.status = "completed";
    if (pdseScore !== undefined) {
      node.pdseScore = pdseScore;
    }
    tree.completedNodes += 1;
  }

  /**
   * Mark a node as failed.
   *
   * Failed nodes are eligible for re-decomposition via `reDecompose()`.
   *
   * @param tree - The tree containing the node.
   * @param nodeId - The id of the node to fail.
   */
  failNode(tree: WaveTree, nodeId: string): void {
    const node = this.findNode(tree, nodeId);
    if (!node) return;
    node.status = "failed";
  }

  /**
   * Produce an ASCII tree visualisation of the wave tree.
   *
   * Each node is rendered on its own line with depth-based indentation,
   * a status indicator, and its title.  Indicators:
   * - `✓` completed
   * - `✗` failed
   * - `⟳` running
   * - `○` pending / skipped
   *
   * @param tree - The tree to render.
   * @returns Multi-line string representation.
   */
  formatTreeDisplay(tree: WaveTree): string {
    const lines: string[] = [`WaveTree ${tree.id.slice(0, 8)} (${tree.totalNodes} nodes)`];

    const renderNode = (node: WaveNode, indent: string, isLast: boolean): void => {
      const indicator = this.statusIndicator(node.status);
      const branch = isLast ? "└─" : "├─";
      const pdse = node.pdseScore !== undefined ? ` [PDSE: ${node.pdseScore.toFixed(2)}]` : "";
      lines.push(`${indent}${branch} ${indicator} ${node.title}${pdse}`);

      const childIndent = indent + (isLast ? "   " : "│  ");
      node.children.forEach((child, i) => {
        renderNode(child, childIndent, i === node.children.length - 1);
      });
    };

    tree.rootNodes.forEach((root, i) => {
      renderNode(root, "", i === tree.rootNodes.length - 1);
    });

    return lines.join("\n");
  }

  /**
   * Find a node anywhere in the tree by its id.
   *
   * @param tree - The tree to search.
   * @param nodeId - The target id.
   * @returns The matching WaveNode, or undefined if not found.
   */
  findNode(tree: WaveTree, nodeId: string): WaveNode | undefined {
    return this.findInNodes(tree.rootNodes, nodeId);
  }

  /**
   * Compute aggregate status counts for the tree.
   *
   * @param tree - The tree to inspect.
   * @returns An object with counts for each status category.
   */
  getTreeStats(tree: WaveTree): TreeStats {
    const stats: TreeStats = { total: 0, completed: 0, failed: 0, pending: 0, running: 0 };

    const tally = (nodes: WaveNode[]): void => {
      for (const node of nodes) {
        stats.total += 1;
        if (node.status === "completed") stats.completed += 1;
        else if (node.status === "failed") stats.failed += 1;
        else if (node.status === "pending" || node.status === "skipped") stats.pending += 1;
        else if (node.status === "running") stats.running += 1;
        tally(node.children);
      }
    };

    tally(tree.rootNodes);
    return stats;
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  /**
   * Group steps into dependency waves using a simple topological sort.
   *
   * Wave 0 contains steps with no (or empty) dependencies.  Wave N contains
   * steps whose dependencies are all satisfied by waves 0..N-1.
   *
   * @param steps - The flat list of plan steps.
   * @returns Array of waves (each wave is an array of PlanSteps).
   */
  private groupStepsByWave(steps: PlanStep[]): PlanStep[][] {
    if (steps.length === 0) return [];

    const stepById = new Map<string, PlanStep>(steps.map((s) => [s.id, s]));
    const waveOf = new Map<string, number>();
    const result: PlanStep[][] = [];

    // Assign each step to its wave number.
    const assignWave = (step: PlanStep, visited: Set<string>): number => {
      if (waveOf.has(step.id)) return waveOf.get(step.id)!;
      if (visited.has(step.id)) {
        // Cycle guard: treat cyclic steps as wave 0.
        return 0;
      }

      visited.add(step.id);

      const deps = step.dependencies ?? [];
      if (deps.length === 0) {
        waveOf.set(step.id, 0);
        return 0;
      }

      let maxDepWave = -1;
      for (const depId of deps) {
        const depStep = stepById.get(depId);
        if (!depStep) continue; // Unknown dependency — ignore.
        const depWave = assignWave(depStep, new Set(visited));
        if (depWave > maxDepWave) maxDepWave = depWave;
      }

      const wave = maxDepWave + 1;
      waveOf.set(step.id, wave);
      return wave;
    };

    for (const step of steps) {
      assignWave(step, new Set());
    }

    // Bucket steps into waves.
    for (const step of steps) {
      const w = waveOf.get(step.id) ?? 0;
      while (result.length <= w) result.push([]);
      result[w]!.push(step);
    }

    return result;
  }

  /**
   * Create a new WaveNode with a stable UUID and default "pending" status.
   *
   * @param title - Display title for the node.
   * @param steps - The PlanSteps this node encapsulates.
   * @param depth - Tree depth level.
   * @param parentId - Parent node id, if any.
   * @returns A fully initialised WaveNode.
   */
  private createNode(title: string, steps: PlanStep[], depth: number, parentId?: string): WaveNode {
    const description = steps.length > 0 ? steps.map((s) => s.description).join("; ") : title;

    return {
      id: randomUUID(),
      title,
      description,
      depth,
      parentId,
      children: [],
      steps,
      status: "pending",
    };
  }

  /**
   * Determine whether a node qualifies for sub-decomposition.
   *
   * Sub-decomposition is triggered when:
   * - The node contains more than one step, AND
   * - `analyzeComplexity` of the combined description exceeds the threshold, AND
   * - The current depth is below the maximum.
   *
   * @param node - The candidate node.
   * @param currentDepth - The depth at which sub-decomposition would occur.
   * @returns True when sub-decomposition should proceed.
   */
  private shouldSubDecompose(node: WaveNode, currentDepth: number): boolean {
    if (currentDepth >= this.maxDepth) return false;
    if (node.steps.length <= 1) return false;

    const complexity = analyzeComplexity(node.description);
    return complexity >= this.complexityThreshold;
  }

  /**
   * Sub-decompose a node by splitting its steps into sub-waves and attaching
   * them as children.
   *
   * Steps within the node are grouped by their internal dependencies to form
   * child waves.  Each sub-wave becomes a child WaveNode.
   *
   * @param node - The parent node to decompose.
   * @param childDepth - The depth at which child nodes will be created.
   */
  private subDecompose(node: WaveNode, childDepth: number): void {
    if (childDepth > this.maxDepth) return;

    const subWaves = this.groupStepsByWave(node.steps);
    node.children = subWaves.map((waveSteps, i) => {
      const child = this.createNode(`${node.title}.${i + 1}`, waveSteps, childDepth, node.id);

      // Recurse if still complex enough and within depth budget.
      if (this.shouldSubDecompose(child, childDepth)) {
        this.subDecompose(child, childDepth + 1);
      }

      return child;
    });
  }

  /**
   * Recursively count all nodes in a node list (including descendants).
   *
   * @param nodes - Root list to count from.
   * @returns Total node count.
   */
  private countNodes(nodes: WaveNode[]): number {
    let count = nodes.length;
    for (const node of nodes) {
      count += this.countNodes(node.children);
    }
    return count;
  }

  /**
   * Recursive depth-first search for a node by id.
   *
   * @param nodes - List of nodes to search.
   * @param nodeId - Target node id.
   * @returns The matching WaveNode, or undefined.
   */
  private findInNodes(nodes: WaveNode[], nodeId: string): WaveNode | undefined {
    for (const node of nodes) {
      if (node.id === nodeId) return node;
      const found = this.findInNodes(node.children, nodeId);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * Map a WaveNode status to its ASCII display indicator.
   *
   * @param status - Node status.
   * @returns Single-character or Unicode indicator.
   */
  private statusIndicator(status: WaveNode["status"]): string {
    switch (status) {
      case "completed":
        return "✓";
      case "failed":
        return "✗";
      case "running":
        return "⟳";
      default:
        return "○";
    }
  }
}
