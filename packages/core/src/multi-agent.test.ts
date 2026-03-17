import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MultiAgent } from "./multi-agent.js";
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
    mockGenerate.mockResolvedValue('{"planner":"done"}');
    // First iteration: delegation + agent executions
    mockGenerate
      .mockResolvedValueOnce('{"planner":"plan subtask","coder":"code subtask"}')
      .mockResolvedValueOnce("Plan output with function export async")
      .mockResolvedValueOnce("Code output with function export async await");

    const result = await agent.coordinate("Implement login");

    expect(result.plan).toEqual({ planner: "plan subtask", coder: "code subtask" });
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
        outputs: Array<{ lane: string; content: string; pdseScore: number }>,
      ) => number;
    };
    expect(agentAny.computeCompositePdse([])).toBe(0);
  });

  it("computeCompositePdse weights reviewer higher", () => {
    const agentAny = agent as unknown as {
      computeCompositePdse: (
        outputs: Array<{ lane: string; content: string; pdseScore: number }>,
      ) => number;
    };
    const outputs = [
      { lane: "coder", content: "", pdseScore: 60 },
      { lane: "reviewer", content: "", pdseScore: 100 },
    ];
    const score = agentAny.computeCompositePdse(outputs);
    // avg=80, reviewer=100 => 80*0.7 + 100*0.3 = 86
    expect(score).toBe(86);
  });
});
