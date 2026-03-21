import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MultiAgent, type MultiAgentProgressCallback } from "./multi-agent.js";
import { ModelRouterImpl } from "./model-router.js";
import type { DanteCodeState } from "@dantecode/config-types";

const mockGenerate = vi.fn();

const mockRouter = {
  generate: mockGenerate,
} as unknown as ModelRouterImpl;

const mockState = {
  agents: {
    maxConcurrent: 2,
    defaultLane: "orchestrator",
    nomaEnabled: true,
    fileLockingEnabled: true,
  },
  pdse: {
    threshold: 60,
    hardViolationsAllowed: 0,
    maxRegenerationAttempts: 3,
    weights: { completeness: 0.3, correctness: 0.3, clarity: 0.2, consistency: 0.2 },
  },
  model: {
    default: { provider: "grok", modelId: "grok-3", maxTokens: 4096 },
    fallback: [],
    taskOverrides: {},
  },
} as unknown as DanteCodeState;

describe("MultiAgent", () => {
  let agent: MultiAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new MultiAgent(mockRouter, mockState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("coordinates simple task with delegation", async () => {
    // Default fallback for any extra iterations
    mockGenerate.mockResolvedValue('[{"role":"planner","task":"done"}]');
    // First iteration: delegation + agent executions
    mockGenerate
      .mockResolvedValueOnce(
        '[{"role":"planner","task":"plan subtask"},{"role":"coder","task":"code subtask"}]',
      )
      .mockResolvedValueOnce("Plan output with function export async")
      .mockResolvedValueOnce("Code output with function export async await");

    const result = await agent.coordinate("Implement login");

    expect(result.plan).toEqual([
      { role: "planner", task: "plan subtask" },
      { role: "coder", task: "code subtask" },
    ]);
    expect(result.iterations).toBeGreaterThanOrEqual(1);
    expect(mockGenerate).toHaveBeenCalled();
  });

  it("returns empty plan on invalid delegation JSON", async () => {
    mockGenerate.mockResolvedValue("not valid json");

    const result = await agent.coordinate("Bad task");

    // Falls back to defaultLane delegation
    expect(result.iterations).toBeGreaterThanOrEqual(1);
  });

  it("heuristicPdse scores code content higher than stubs", () => {
    const agentAny = agent as unknown as {
      heuristicPdse: (content: string) => number;
    };
    const codeScore = agentAny.heuristicPdse(
      "```ts\nexport async function foo() { await bar(); }\nexport interface Config { type: string; }",
    );
    const stubScore = agentAny.heuristicPdse("Bad stub");

    expect(codeScore).toBeGreaterThan(stubScore);
    expect(stubScore).toBeLessThan(70);
  });

  it("computeCompositePdse returns 0 for empty outputs", () => {
    const agentAny = agent as unknown as {
      computeCompositePdse: (
        outputs: Array<{ role: string; content: string; pdseScore: number }>,
      ) => number;
    };
    expect(agentAny.computeCompositePdse([])).toBe(0);
  });

  it("computeCompositePdse weights reviewer higher", () => {
    const agentAny = agent as unknown as {
      computeCompositePdse: (
        outputs: Array<{ role: string; content: string; pdseScore: number }>,
      ) => number;
    };
    const outputs = [
      { role: "coder", content: "", pdseScore: 60 },
      { role: "reviewer", content: "", pdseScore: 100 },
    ];
    const score = agentAny.computeCompositePdse(outputs);
    // avg=80, reviewer=100 => 80*0.8 + 100*0.2 = 84
    expect(score).toBe(84);
  });

  // ---------- Integration Tests ----------

  it("full happy-path: coordinate() with 3-lane delegation produces PDSE and outputs", async () => {
    // Delegation: orchestrator returns 3 lanes
    mockGenerate.mockResolvedValueOnce(
      '[{"role":"planner","task":"Break task into steps"},{"role":"coder","task":"Implement login form"},{"role":"reviewer","task":"Review code quality"}]',
    );
    // Planner lane output (rich content → high heuristic PDSE)
    mockGenerate.mockResolvedValueOnce(
      "1. Create LoginForm component\n2. Add validation\n3. Run tests\n\n```ts\nexport async function login() { await fetch('/api/auth'); }\nexport interface LoginConfig { type: string; }\n```",
    );
    // Coder lane output
    mockGenerate.mockResolvedValueOnce(
      "```ts\nexport async function handleLogin(email: string) {\n  await validateInput(email);\n  const result = await fetch('/api/auth');\n  return result;\n}\nexport interface AuthResult { type: string; token: string; }\n```",
    );
    // Reviewer lane output
    mockGenerate.mockResolvedValueOnce(
      "Code review: All functions complete. Export types present.\n```ts\nexport async function test() { await vi.fn()(); expect(true).toBe(true); }\nexport interface Review { type: string; }\n```",
    );

    const result = await agent.coordinate("Implement login");

    expect(result.plan.some((p) => p.role === "planner")).toBe(true);
    expect(result.plan.some((p) => p.role === "coder")).toBe(true);
    expect(result.plan.some((p) => p.role === "reviewer")).toBe(true);
    expect(result.outputs).toHaveLength(3);
    expect(result.outputs.every((o) => o.pdseScore > 0)).toBe(true);
    expect(result.compositePdse).toBeGreaterThan(0);
    expect(result.iterations).toBe(1);
  });

  it("iterates with feedback when composite PDSE is below threshold", async () => {
    const highThresholdState = {
      ...mockState,
      pdse: { ...mockState.pdse, threshold: 95 },
    } as unknown as DanteCodeState;
    const strictAgent = new MultiAgent(mockRouter, highThresholdState);

    // All iterations return stub content → low heuristic PDSE (< 95)
    mockGenerate.mockResolvedValue("stub");

    const result = await strictAgent.coordinate("Build something");

    expect(result.iterations).toBe(3); // Hit iteration limit
    expect(result.compositePdse).toBeLessThan(95);
  });

  it("handles agent lane failure gracefully via onProgress", async () => {
    // Delegation: 2 lanes
    mockGenerate.mockResolvedValueOnce(
      '[{"role":"planner","task":"plan it"},{"role":"coder","task":"code it"}]',
    );
    // Planner succeeds
    mockGenerate.mockResolvedValueOnce(
      "Plan: step 1, step 2\n```ts\nexport async function plan() { await work(); }\n```",
    );
    // Coder throws
    mockGenerate.mockRejectedValueOnce(new Error("model timeout"));
    // Fallback for potential re-iterations
    mockGenerate.mockResolvedValue('[{"role":"orchestrator","task":"try again"}]');

    const progressUpdates: Array<{ lane: string; status: string }> = [];
    const onProgress: MultiAgentProgressCallback = (update) => {
      progressUpdates.push({ lane: update.lane, status: update.status });
    };

    await agent.coordinate("Test task", {}, onProgress);

    const failedUpdates = progressUpdates.filter((u) => u.status === "failed");
    expect(failedUpdates.length).toBeGreaterThanOrEqual(1);
    expect(failedUpdates.some((u) => u.lane === "coder")).toBe(true);

    // Planner should still have produced output
    const plannerStarted = progressUpdates.find(
      (u) => u.lane === "planner" && u.status === "started",
    );
    expect(plannerStarted).toBeDefined();
  });

  it("onProgress reports started → completed for successful lanes", async () => {
    mockGenerate.mockResolvedValueOnce('[{"role":"coder","task":"implement feature"}]');
    mockGenerate.mockResolvedValueOnce(
      "```ts\nexport async function feature() { await doWork(); }\nexport interface Config { type: string; }\n```",
    );

    const progressUpdates: Array<{ lane: string; status: string; pdseScore?: number }> = [];
    const onProgress: MultiAgentProgressCallback = (update) => {
      progressUpdates.push({
        lane: update.lane,
        status: update.status,
        pdseScore: update.pdseScore,
      });
    };

    await agent.coordinate("Implement feature", {}, onProgress);

    const coderStarted = progressUpdates.find((u) => u.lane === "coder" && u.status === "started");
    const coderCompleted = progressUpdates.find(
      (u) => u.lane === "coder" && u.status === "completed",
    );
    expect(coderStarted).toBeDefined();
    expect(coderCompleted).toBeDefined();
    expect(coderCompleted!.pdseScore).toBeGreaterThan(0);
  });

  it("falls back to defaultLane when delegation returns non-JSON", async () => {
    // Orchestrator returns gibberish → falls back to defaultLane
    mockGenerate.mockResolvedValueOnce("I will plan this task carefully...");
    // DefaultLane (orchestrator) execution
    mockGenerate.mockResolvedValueOnce(
      "```ts\nexport async function work() { await process(); }\nexport interface Result { type: string; }\n```",
    );

    const result = await agent.coordinate("Do something");

    expect(result.outputs.length).toBeGreaterThanOrEqual(1);
    expect(result.outputs[0]!.role).toBe("orchestrator");
  });
});
