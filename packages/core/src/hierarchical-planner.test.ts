// ============================================================================
// @dantecode/core - HierarchicalPlanner tests
// ============================================================================

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionPlan, PlanStep } from "./architect-planner.js";
import * as architectPlanner from "./architect-planner.js";
import { HierarchicalPlanner } from "./hierarchical-planner.js";

vi.mock("./architect-planner.js", () => ({
  analyzeComplexity: vi.fn().mockReturnValue(0.5),
  parsePlanFromText: vi.fn(),
}));

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeStep(partial?: Partial<PlanStep>): PlanStep {
  return {
    id: partial?.id ?? "s1",
    description: partial?.description ?? "desc",
    files: partial?.files ?? [],
    dependencies: partial?.dependencies ?? [],
    status: partial?.status ?? "pending",
  };
}

function makePlan(steps?: Partial<PlanStep>[]): ExecutionPlan {
  return {
    goal: "Test Plan",
    steps: (
      steps ?? [
        {
          id: "s1",
          description: "Do step 1",
          dependencies: [],
          files: [],
        },
      ]
    ).map((s) => makeStep(s)),
    estimatedComplexity: 0.5,
    createdAt: new Date().toISOString(),
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("HierarchicalPlanner", () => {
  let planner: HierarchicalPlanner;

  beforeEach(() => {
    vi.clearAllMocks();
    planner = new HierarchicalPlanner({ maxDepth: 3, complexityThreshold: 0.65 });
  });

  // ── generateWaveTree ──────────────────────────────────────────────────────

  it("1. generateWaveTree() creates a WaveTree from a plan", () => {
    const plan = makePlan();
    const tree = planner.generateWaveTree(plan);
    expect(tree).toBeDefined();
    expect(tree.id).toBeDefined();
    expect(tree.rootNodes).toBeDefined();
  });

  it("2. generateWaveTree() creates root nodes from independent steps", () => {
    const plan = makePlan([
      { id: "s1", description: "Step A", dependencies: [] },
      { id: "s2", description: "Step B", dependencies: [] },
    ]);
    const tree = planner.generateWaveTree(plan);
    // Both steps are independent → they land in the same wave 0 node.
    expect(tree.rootNodes.length).toBeGreaterThanOrEqual(1);
    const allSteps = tree.rootNodes.flatMap((n) => n.steps);
    expect(allSteps).toHaveLength(2);
  });

  it("3. generateWaveTree() counts totalNodes correctly", () => {
    const plan = makePlan([
      { id: "s1", dependencies: [] },
      { id: "s2", dependencies: ["s1"] },
    ]);
    const tree = planner.generateWaveTree(plan);
    // Wave 0 for s1, wave 1 for s2 → 2 root nodes minimum.
    expect(tree.totalNodes).toBe(tree.rootNodes.length);
  });

  it("4. generateWaveTree() sets node status to 'pending'", () => {
    const plan = makePlan([{ id: "s1", dependencies: [] }]);
    const tree = planner.generateWaveTree(plan);
    for (const node of tree.rootNodes) {
      expect(node.status).toBe("pending");
    }
  });

  it("5. generateWaveTree() returns WaveTree with createdAt", () => {
    const plan = makePlan();
    const tree = planner.generateWaveTree(plan);
    expect(typeof tree.createdAt).toBe("string");
    expect(() => new Date(tree.createdAt)).not.toThrow();
  });

  // ── reDecompose ───────────────────────────────────────────────────────────

  it("6. reDecompose() skips completed nodes", () => {
    const plan = makePlan([{ id: "s1", dependencies: [] }]);
    const tree = planner.generateWaveTree(plan);
    const nodeId = tree.rootNodes[0]!.id;
    planner.completeNode(tree, nodeId);
    const childrenBefore = tree.rootNodes[0]!.children.length;
    planner.reDecompose(tree, { failedOnly: true });
    expect(tree.rootNodes[0]!.children.length).toBe(childrenBefore);
    expect(tree.rootNodes[0]!.status).toBe("completed");
  });

  it("7. reDecompose() processes failed nodes when failedOnly=true", () => {
    vi.mocked(architectPlanner.analyzeComplexity).mockReturnValue(0.9);
    const plan = makePlan([
      { id: "s1", description: "Alpha task" },
      { id: "s2", description: "Beta task" },
    ]);
    const tree = planner.generateWaveTree(plan);
    // Mark a node failed.
    const nodeId = tree.rootNodes[0]!.id;
    planner.failNode(tree, nodeId);
    const result = planner.reDecompose(tree, { failedOnly: true });
    expect(result).toBe(tree); // Same reference.
  });

  it("8. reDecompose() processes all nodes when failedOnly=false", () => {
    const plan = makePlan([{ id: "s1", dependencies: [] }]);
    const tree = planner.generateWaveTree(plan);
    const result = planner.reDecompose(tree, { failedOnly: false });
    expect(result).toBe(tree);
  });

  // ── getNextExecutable ─────────────────────────────────────────────────────

  it("9. getNextExecutable() returns pending root nodes", () => {
    const plan = makePlan([{ id: "s1", dependencies: [] }]);
    const tree = planner.generateWaveTree(plan);
    const nodes = planner.getNextExecutable(tree);
    expect(nodes.length).toBeGreaterThan(0);
    for (const n of nodes) {
      expect(n.status).toBe("pending");
    }
  });

  it("10. getNextExecutable() returns empty when all nodes completed", () => {
    const plan = makePlan([{ id: "s1", dependencies: [] }]);
    const tree = planner.generateWaveTree(plan);
    for (const node of tree.rootNodes) {
      planner.completeNode(tree, node.id);
    }
    const nodes = planner.getNextExecutable(tree);
    expect(nodes).toHaveLength(0);
  });

  // ── completeNode ──────────────────────────────────────────────────────────

  it("11. completeNode() marks the node as completed", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    const nodeId = tree.rootNodes[0]!.id;
    planner.completeNode(tree, nodeId);
    expect(tree.rootNodes[0]!.status).toBe("completed");
  });

  it("12. completeNode() stores pdseScore on the node", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    const nodeId = tree.rootNodes[0]!.id;
    planner.completeNode(tree, nodeId, 0.88);
    expect(tree.rootNodes[0]!.pdseScore).toBe(0.88);
  });

  // ── failNode ──────────────────────────────────────────────────────────────

  it("13. failNode() marks the node as failed", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    const nodeId = tree.rootNodes[0]!.id;
    planner.failNode(tree, nodeId);
    expect(tree.rootNodes[0]!.status).toBe("failed");
  });

  // ── formatTreeDisplay ─────────────────────────────────────────────────────

  it("14. formatTreeDisplay() returns a non-empty string", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    const display = planner.formatTreeDisplay(tree);
    expect(typeof display).toBe("string");
    expect(display.length).toBeGreaterThan(0);
  });

  it("15. formatTreeDisplay() contains node titles", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    const display = planner.formatTreeDisplay(tree);
    // Each root node title should appear somewhere in the output.
    for (const node of tree.rootNodes) {
      expect(display).toContain(node.title);
    }
  });

  // ── findNode ──────────────────────────────────────────────────────────────

  it("16. findNode() finds a root node by id", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    const nodeId = tree.rootNodes[0]!.id;
    const found = planner.findNode(tree, nodeId);
    expect(found).toBeDefined();
    expect(found!.id).toBe(nodeId);
  });

  it("17. findNode() returns undefined for an unknown id", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    const found = planner.findNode(tree, "non-existent-id");
    expect(found).toBeUndefined();
  });

  // ── getTreeStats ──────────────────────────────────────────────────────────

  it("18. getTreeStats() counts statuses correctly", () => {
    const plan = makePlan([
      { id: "s1", dependencies: [] },
      { id: "s2", dependencies: ["s1"] },
    ]);
    const tree = planner.generateWaveTree(plan);
    const firstId = tree.rootNodes[0]!.id;
    planner.completeNode(tree, firstId);
    const stats = planner.getTreeStats(tree);
    expect(stats.completed).toBeGreaterThanOrEqual(1);
    expect(stats.total).toBe(tree.rootNodes.length);
    expect(stats.completed + stats.failed + stats.pending + stats.running).toBe(stats.total);
  });

  it("19. getTreeStats() returns zeros for an empty tree", () => {
    const tree: import("./hierarchical-planner.js").WaveTree = {
      id: "empty",
      rootNodes: [],
      totalNodes: 0,
      completedNodes: 0,
      createdAt: new Date().toISOString(),
    };
    const stats = planner.getTreeStats(tree);
    expect(stats).toEqual({ total: 0, completed: 0, failed: 0, pending: 0, running: 0 });
  });

  // ── Topological wave grouping (via generateWaveTree) ──────────────────────

  it("20. Independent steps land in wave 0 (single root node)", () => {
    const plan = makePlan([
      { id: "a", dependencies: [] },
      { id: "b", dependencies: [] },
    ]);
    const tree = planner.generateWaveTree(plan);
    // Both steps have no dependencies → same wave → one root node.
    const wave0Node = tree.rootNodes.find((n) => n.steps.some((s) => s.id === "a"));
    expect(wave0Node).toBeDefined();
    const wave0Ids = wave0Node!.steps.map((s) => s.id);
    expect(wave0Ids).toContain("a");
    expect(wave0Ids).toContain("b");
  });

  it("21. Steps with dependencies appear in later waves (separate root node)", () => {
    const plan = makePlan([
      { id: "a", dependencies: [] },
      { id: "b", dependencies: ["a"] },
    ]);
    const tree = planner.generateWaveTree(plan);
    expect(tree.rootNodes.length).toBe(2);
    const wave1Node = tree.rootNodes.find((n) => n.steps.some((s) => s.id === "b"));
    expect(wave1Node).toBeDefined();
  });

  it("22. Multiple steps in the same wave share one root node", () => {
    const plan = makePlan([
      { id: "x", dependencies: [] },
      { id: "y", dependencies: [] },
      { id: "z", dependencies: ["x"] },
    ]);
    const tree = planner.generateWaveTree(plan);
    const wave0Node = tree.rootNodes[0]!;
    expect(wave0Node.steps.length).toBe(2);
    expect(wave0Node.steps.map((s) => s.id).sort()).toEqual(["x", "y"]);
  });

  // ── reDecompose totalNodes ─────────────────────────────────────────────────

  it("23. reDecompose() updates totalNodes after structural changes", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    const before = tree.totalNodes;
    planner.reDecompose(tree);
    // totalNodes should still reflect actual node count (may be same or more).
    expect(tree.totalNodes).toBeGreaterThanOrEqual(before);
  });

  // ── completeNode increments completedNodes ────────────────────────────────

  it("24. completeNode() increments tree.completedNodes", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    expect(tree.completedNodes).toBe(0);
    planner.completeNode(tree, tree.rootNodes[0]!.id);
    expect(tree.completedNodes).toBe(1);
  });

  // ── getNextExecutable skips non-pending ───────────────────────────────────

  it("25. getNextExecutable() skips running and failed root nodes", () => {
    const plan = makePlan([
      { id: "s1", dependencies: [] },
      { id: "s2", dependencies: [] },
      { id: "s3", dependencies: [] },
    ]);
    const tree = planner.generateWaveTree(plan);
    // The wave-0 node groups all three steps; mark it running.
    const wave0 = tree.rootNodes[0]!;
    wave0.status = "running";
    const nodes = planner.getNextExecutable(tree);
    expect(nodes.every((n) => n.status === "pending")).toBe(true);
    expect(nodes.find((n) => n.id === wave0.id)).toBeUndefined();
  });

  // ── Unique node IDs ───────────────────────────────────────────────────────

  it("26. WaveTree assigns unique IDs per node", () => {
    const plan = makePlan([
      { id: "s1", dependencies: [] },
      { id: "s2", dependencies: ["s1"] },
      { id: "s3", dependencies: ["s1"] },
    ]);
    const tree = planner.generateWaveTree(plan);
    const ids = tree.rootNodes.map((n) => n.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  // ── formatTreeDisplay indicators ──────────────────────────────────────────

  it("27. formatTreeDisplay() shows completion indicator for completed nodes", () => {
    const plan = makePlan([{ id: "s1" }]);
    const tree = planner.generateWaveTree(plan);
    planner.completeNode(tree, tree.rootNodes[0]!.id);
    const display = planner.formatTreeDisplay(tree);
    expect(display).toContain("✓");
  });

  // ── Empty plan ────────────────────────────────────────────────────────────

  it("28. Empty plan produces a tree with no root nodes", () => {
    const plan = makePlan([]);
    const tree = planner.generateWaveTree(plan);
    expect(tree.rootNodes).toHaveLength(0);
    expect(tree.totalNodes).toBe(0);
  });

  // ── Single step plan ──────────────────────────────────────────────────────

  it("29. Single step plan produces exactly one root node", () => {
    const plan = makePlan([{ id: "only", dependencies: [] }]);
    const tree = planner.generateWaveTree(plan);
    expect(tree.rootNodes).toHaveLength(1);
    expect(tree.rootNodes[0]!.steps[0]!.id).toBe("only");
  });

  // ── Deep tree (3 levels) ──────────────────────────────────────────────────

  it("30. Deep tree (3 levels) is handled without errors", () => {
    // Force high complexity so sub-decomposition triggers.
    vi.mocked(architectPlanner.analyzeComplexity).mockReturnValue(0.9);

    const deepPlanner = new HierarchicalPlanner({
      maxDepth: 3,
      complexityThreshold: 0.6,
    });

    const plan = makePlan([
      { id: "r1", dependencies: [] },
      { id: "r2", dependencies: [] },
      { id: "r3", dependencies: [] },
    ]);

    const tree = deepPlanner.generateWaveTree(plan);
    expect(tree).toBeDefined();
    expect(tree.rootNodes.length).toBeGreaterThanOrEqual(1);

    // Validate no node exceeds maxDepth.
    const checkDepth = (nodes: import("./hierarchical-planner.js").WaveNode[], limit: number) => {
      for (const node of nodes) {
        expect(node.depth).toBeLessThanOrEqual(limit);
        checkDepth(node.children, limit);
      }
    };
    checkDepth(tree.rootNodes, 3);
  });
});
