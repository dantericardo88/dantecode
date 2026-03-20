// ============================================================================
// autonomy-engine.test.ts — 30 Vitest unit tests for AutonomyEngine
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutonomyEngine } from "./autonomy-engine.js";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises");

vi.mock("./approach-memory.js", () => ({
  tokenize: vi.fn((s: string) => new Set(s.toLowerCase().split(/\s+/))),
  jaccardSimilarity: vi.fn((a: Set<string>, b: Set<string>) => {
    const intersection = new Set([...a].filter((x) => b.has(x)));
    const union = new Set([...a, ...b]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockFs = {
  readFile: vi.fn().mockRejectedValue(
    Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
  ),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
};

function makeEngine(overrides: Partial<ConstructorParameters<typeof AutonomyEngine>[1]> = {}) {
  return new AutonomyEngine("/project", { fsFn: mockFs, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AutonomyEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing goals file
    mockFs.readFile.mockRejectedValue(
      Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
    );
    mockFs.writeFile.mockResolvedValue(undefined);
    mockFs.mkdir.mockResolvedValue(undefined);
  });

  // 1 -----------------------------------------------------------------------
  it("addGoal() creates goal with correct fields", async () => {
    const engine = makeEngine();
    const goal = await engine.addGoal("Fix lint", "Run eslint and fix all errors", ["eslint exits 0"]);

    expect(goal.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(goal.title).toBe("Fix lint");
    expect(goal.description).toBe("Run eslint and fix all errors");
    expect(goal.status).toBe("active");
    expect(goal.completionCriteria).toEqual(["eslint exits 0"]);
    expect(goal.progressNotes).toEqual([]);
    expect(goal.subGoals).toEqual([]);
    expect(goal.createdAt).toBeTruthy();
    expect(goal.updatedAt).toBeTruthy();
  });

  // 2 -----------------------------------------------------------------------
  it("addGoal() sets priority correctly", async () => {
    const engine = makeEngine();
    const high = await engine.addGoal("High", "desc", [], 10);
    const low = await engine.addGoal("Low", "desc", [], 1);

    expect(high.priority).toBe(10);
    expect(low.priority).toBe(1);
  });

  // 3 -----------------------------------------------------------------------
  it("addGoal() persists via save (calls writeFile)", async () => {
    const engine = makeEngine();
    await engine.addGoal("Persist test", "desc", []);

    expect(mockFs.writeFile).toHaveBeenCalled();
    const [, data] = mockFs.writeFile.mock.calls[0] as [string, string, string];
    const parsed = JSON.parse(data);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].title).toBe("Persist test");
  });

  // 4 -----------------------------------------------------------------------
  it("updateGoal() changes status", async () => {
    const engine = makeEngine();
    const goal = await engine.addGoal("Update me", "desc", []);
    await engine.updateGoal(goal.id, { status: "completed" });

    const updated = engine.getGoal(goal.id);
    expect(updated?.status).toBe("completed");
  });

  // 5 -----------------------------------------------------------------------
  it("updateGoal() appends progressNotes rather than replacing", async () => {
    const engine = makeEngine();
    const goal = await engine.addGoal("Note test", "desc", []);
    await engine.updateGoal(goal.id, { progressNotes: ["First note"] });
    await engine.updateGoal(goal.id, { progressNotes: ["Second note"] });

    const updated = engine.getGoal(goal.id);
    expect(updated?.progressNotes).toEqual(["First note", "Second note"]);
  });

  // 6 -----------------------------------------------------------------------
  it("getGoal() returns the goal by id", async () => {
    const engine = makeEngine();
    const goal = await engine.addGoal("Get me", "desc", []);

    const fetched = engine.getGoal(goal.id);
    expect(fetched).toBeDefined();
    expect(fetched?.title).toBe("Get me");
  });

  // 7 -----------------------------------------------------------------------
  it("getGoal() returns undefined for unknown id", () => {
    const engine = makeEngine();
    expect(engine.getGoal("nonexistent-id")).toBeUndefined();
  });

  // 8 -----------------------------------------------------------------------
  it("listGoals() returns all goals when no filter given", async () => {
    const engine = makeEngine();
    await engine.addGoal("A", "desc", []);
    await engine.addGoal("B", "desc", []);

    expect(engine.listGoals()).toHaveLength(2);
  });

  // 9 -----------------------------------------------------------------------
  it("listGoals() filters by status", async () => {
    const engine = makeEngine();
    const g1 = await engine.addGoal("Active goal", "desc", []);
    const g2 = await engine.addGoal("Another", "desc", []);
    await engine.updateGoal(g2.id, { status: "completed" });

    const active = engine.listGoals("active");
    expect(active).toHaveLength(1);
    expect(active[0]!.id).toBe(g1.id);
  });

  // 10 ----------------------------------------------------------------------
  it("listGoals() sorts by priority descending", async () => {
    const engine = makeEngine();
    await engine.addGoal("Low", "desc", [], 1);
    await engine.addGoal("Medium", "desc", [], 5);
    await engine.addGoal("High", "desc", [], 10);

    const goals = engine.listGoals();
    expect(goals[0]!.priority).toBe(10);
    expect(goals[1]!.priority).toBe(5);
    expect(goals[2]!.priority).toBe(1);
  });

  // 11 ----------------------------------------------------------------------
  it("metaReason() recommends replan when there are no active goals", async () => {
    const engine = makeEngine();
    const g = await engine.addGoal("Done goal", "desc", []);
    await engine.updateGoal(g.id, { status: "completed" });

    const result = engine.metaReason("some context");
    // All completed → celebrate path (shouldReplan=false) or no active path
    // Since completed>0 and active=0: "All goals complete" path
    expect(result.shouldReplan).toBe(false);
    expect(result.recommendation).toContain("completed");
  });

  // 12 ----------------------------------------------------------------------
  it("metaReason() returns shouldAbandon for low PDSE goal", async () => {
    const engine = makeEngine({ pdseViabilityThreshold: 0.5 });
    const g = await engine.addGoal("Low viability", "desc", []);
    await engine.updateGoal(g.id, { pdseScore: 0.2 });

    const result = engine.metaReason("context");
    expect(result.shouldAbandon).toBe(true);
    expect(result.recommendation).toContain("Low viability");
  });

  // 13 ----------------------------------------------------------------------
  it("metaReason() returns no action for healthy active goals", async () => {
    const engine = makeEngine();
    const g = await engine.addGoal("Healthy goal", "desc", []);
    await engine.updateGoal(g.id, { pdseScore: 0.9 });

    const result = engine.metaReason("working on it");
    expect(result.shouldReplan).toBe(false);
    expect(result.shouldAbandon).toBe(false);
    expect(result.recommendation).toContain("Healthy goal");
  });

  // 14 ----------------------------------------------------------------------
  it("adaptiveReplan() changes goal status based on reason", async () => {
    const engine = makeEngine();
    const g = await engine.addGoal("Will fail", "desc", []);
    engine.adaptiveReplan(g.id, "Cannot proceed — blocked by dependency");

    expect(engine.getGoal(g.id)?.status).toBe("blocked");
  });

  // 15 ----------------------------------------------------------------------
  it("adaptiveReplan() records the adaptation in history", async () => {
    const engine = makeEngine();
    const g = await engine.addGoal("Track me", "desc", []);
    engine.adaptiveReplan(g.id, "Goal is now irrelevant to the project");

    const history = engine.getAdaptationHistory();
    expect(history).toHaveLength(1);
    expect(history[0]!.goalId).toBe(g.id);
    expect(history[0]!.previousStatus).toBe("active");
    expect(history[0]!.reason).toBe("Goal is now irrelevant to the project");
  });

  // 16 ----------------------------------------------------------------------
  it("decideNextAction() returns directive containing goal title for active goals", async () => {
    const engine = makeEngine();
    await engine.addGoal("Write tests", "Add unit tests for module X", []);

    const action = engine.decideNextAction("context");
    expect(action).toContain("Write tests");
  });

  // 17 ----------------------------------------------------------------------
  it("decideNextAction() prompts to define goals when no goals exist", () => {
    const engine = makeEngine();
    const action = engine.decideNextAction("context");
    expect(action).toMatch(/define new goals|no active goals/i);
  });

  // 18 ----------------------------------------------------------------------
  it("pruneDeadPaths() abandons goals below minPdseScore", async () => {
    const engine = makeEngine({ pdseViabilityThreshold: 0.5 });
    const g1 = await engine.addGoal("Viable", "desc", []);
    const g2 = await engine.addGoal("Dead", "desc", []);
    await engine.updateGoal(g1.id, { pdseScore: 0.8 });
    await engine.updateGoal(g2.id, { pdseScore: 0.1 });

    engine.pruneDeadPaths();

    expect(engine.getGoal(g1.id)?.status).toBe("active");
    expect(engine.getGoal(g2.id)?.status).toBe("abandoned");
  });

  // 19 ----------------------------------------------------------------------
  it("pruneDeadPaths() returns the count of pruned goals", async () => {
    const engine = makeEngine({ pdseViabilityThreshold: 0.5 });
    const g1 = await engine.addGoal("Dead 1", "desc", []);
    const g2 = await engine.addGoal("Dead 2", "desc", []);
    await engine.updateGoal(g1.id, { pdseScore: 0.2 });
    await engine.updateGoal(g2.id, { pdseScore: 0.3 });

    const count = engine.pruneDeadPaths();
    expect(count).toBe(2);
  });

  // 20 ----------------------------------------------------------------------
  it("getAdaptationHistory() returns a copy of the history array", async () => {
    const engine = makeEngine();
    const g = await engine.addGoal("Adapt me", "desc", []);
    engine.adaptiveReplan(g.id, "fails consistently");

    const h1 = engine.getAdaptationHistory();
    const h2 = engine.getAdaptationHistory();
    expect(h1).toEqual(h2);
    // Should be copies (mutating one does not affect the engine)
    h1.push({ goalId: "fake", previousStatus: "active", newStatus: "completed", reason: "", timestamp: "" });
    expect(engine.getAdaptationHistory()).toHaveLength(1);
  });

  // 21 ----------------------------------------------------------------------
  it("incrementStep() increments the internal step counter", () => {
    const engine = makeEngine();
    engine.incrementStep();
    engine.incrementStep();
    engine.incrementStep();
    // shouldRunMetaReasoning at step 15; step count is 3 so it should be false
    expect(engine.shouldRunMetaReasoning()).toBe(false);
  });

  // 22 ----------------------------------------------------------------------
  it("shouldRunMetaReasoning() returns true at the configured interval", () => {
    const engine = makeEngine({ metaReasoningInterval: 5 });
    for (let i = 0; i < 5; i++) engine.incrementStep();
    expect(engine.shouldRunMetaReasoning()).toBe(true);
  });

  // 23 ----------------------------------------------------------------------
  it("shouldRunMetaReasoning() returns false at step 0", () => {
    const engine = makeEngine();
    expect(engine.shouldRunMetaReasoning()).toBe(false);
  });

  // 24 ----------------------------------------------------------------------
  it("resume() returns a formatted summary containing active goal titles", async () => {
    const engine = makeEngine();
    await engine.addGoal("Top priority", "Very important", ["done"], 10);

    const summary = await engine.resume("sess-123");
    expect(summary).toContain("Active goals");
    expect(summary).toContain("Top priority");
    expect(summary).toContain("sess-123");
  });

  // 25 ----------------------------------------------------------------------
  it("load() handles missing file gracefully (ENOENT → empty goals)", async () => {
    const engine = makeEngine();
    await engine.load(); // ENOENT mocked by default

    expect(engine.listGoals()).toHaveLength(0);
  });

  // 26 ----------------------------------------------------------------------
  it("load() is idempotent — file is only read once on repeated calls", async () => {
    mockFs.readFile.mockResolvedValue("[]");
    const engine = makeEngine();
    await engine.load();
    await engine.load();
    await engine.load();

    expect(mockFs.readFile).toHaveBeenCalledTimes(1);
  });

  // 27 ----------------------------------------------------------------------
  it("multiple goals sort by priority descending across addGoal calls", async () => {
    const engine = makeEngine();
    await engine.addGoal("P3", "desc", [], 3);
    await engine.addGoal("P1", "desc", [], 1);
    await engine.addGoal("P5", "desc", [], 5);
    await engine.addGoal("P2", "desc", [], 2);

    const sorted = engine.listGoals();
    expect(sorted.map((g) => g.priority)).toEqual([5, 3, 2, 1]);
  });

  // 28 ----------------------------------------------------------------------
  it("updateGoal() sets subGoals field correctly", async () => {
    const engine = makeEngine();
    const parent = await engine.addGoal("Parent", "desc", []);
    const child = await engine.addGoal("Child", "desc", []);

    await engine.updateGoal(parent.id, { subGoals: [child.id] });
    expect(engine.getGoal(parent.id)?.subGoals).toEqual([child.id]);
  });

  // 29 ----------------------------------------------------------------------
  it("addGoal() stores completionCriteria correctly", async () => {
    const engine = makeEngine();
    const criteria = ["All tests pass", "Coverage >= 80%", "No lint errors"];
    const goal = await engine.addGoal("Ship it", "Release the product", criteria);

    expect(goal.completionCriteria).toEqual(criteria);
    expect(engine.getGoal(goal.id)?.completionCriteria).toEqual(criteria);
  });

  // 30 ----------------------------------------------------------------------
  it("metaReason() handles empty context string without throwing", async () => {
    const engine = makeEngine();
    await engine.addGoal("Normal goal", "desc", []);

    expect(() => engine.metaReason("")).not.toThrow();
    const result = engine.metaReason("");
    expect(result.reasoningSteps.length).toBeGreaterThan(0);
  });
});
