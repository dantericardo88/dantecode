// ============================================================================
// @dantecode/core — HandoffEngine tests
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { HandoffEngine } from "./handoff-engine.js";
import type { AgentContext, HandoffSignal } from "./handoff-engine.js";
import { SubAgentManager } from "./subagent-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeManager(): SubAgentManager {
  return new SubAgentManager({ maxConcurrency: 4, maxDepth: 3 });
}

function makeEngine(maxHandoffs = 5): HandoffEngine {
  return new HandoffEngine({ manager: makeManager(), maxHandoffs });
}

function makeContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    id: "ctx-001",
    role: "planner",
    instructions: "Plan the task",
    variables: {},
    history: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("HandoffEngine.isHandoff()", () => {
  it("1. returns true for a valid HandoffSignal shape", () => {
    const engine = makeEngine();
    const signal: HandoffSignal = {
      _isHandoff: true,
      targetRole: "executor",
      reason: "planning complete",
      instructions: "execute the plan",
    };
    expect(engine.isHandoff(signal)).toBe(true);
  });

  it("2. returns false for a string", () => {
    const engine = makeEngine();
    expect(engine.isHandoff("not a signal")).toBe(false);
  });

  it("3. returns false for null", () => {
    const engine = makeEngine();
    // isHandoff uses short-circuit evaluation; null && ... returns null (falsy)
    expect(engine.isHandoff(null)).toBeFalsy();
  });

  it("4. returns false for a plain object missing required _isHandoff field", () => {
    const engine = makeEngine();
    const notASignal = { targetRole: "executor", reason: "oops", instructions: "go" };
    expect(engine.isHandoff(notASignal)).toBe(false);
  });
});

describe("HandoffEngine.createHandoff()", () => {
  it("5. returns object with correct targetRole and context", () => {
    const engine = makeEngine();
    const signal = engine.createHandoff("reviewer", "code ready", "review the PR", {
      prUrl: "https://example.com/pr/1",
    });
    expect(signal._isHandoff).toBe(true);
    expect(signal.targetRole).toBe("reviewer");
    expect(signal.reason).toBe("code ready");
    expect(signal.instructions).toBe("review the PR");
    expect(signal.contextUpdates?.prUrl).toBe("https://example.com/pr/1");
  });
});

describe("HandoffEngine.runHandoffLoop()", () => {
  it("6. terminal string response on first agent — no handoff, returns result", async () => {
    const engine = makeEngine();
    const ctx = makeContext();

    const executor = vi.fn(async (_ctx: AgentContext) => "Task complete.");

    const result = await engine.runHandoffLoop(ctx, executor);
    expect(result).toBe("Task complete.");
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("7. single handoff A→B→terminal", async () => {
    const engine = makeEngine();
    const ctx = makeContext({ role: "planner" });

    let callCount = 0;
    const executor = vi.fn(async (agentCtx: AgentContext) => {
      callCount++;
      if (agentCtx.role === "planner") {
        return engine.createHandoff("executor", "planning done", "execute the plan");
      }
      return "Execution complete.";
    });

    const result = await engine.runHandoffLoop(ctx, executor);
    expect(result).toBe("Execution complete.");
    expect(callCount).toBe(2);
  });

  it("8. max handoffs exceeded — terminates safely without infinite loop", async () => {
    const engine = makeEngine(2); // max 2 handoffs
    const ctx = makeContext({ role: "loop-agent" });

    // Agent always returns a handoff — never terminates on its own
    const executor = vi.fn(async (_agentCtx: AgentContext) => {
      return engine.createHandoff("loop-agent", "still looping", "keep going");
    });

    const result = await engine.runHandoffLoop(ctx, executor);
    // Should return error message, not throw
    expect(result).toContain("Max Swarm handoffs");
    expect(result).toContain("2");
    expect(executor.mock.calls.length).toBe(2); // called exactly maxHandoffs times
  });

  it("9. context variables persisted across handoffs", async () => {
    const engine = makeEngine();
    const ctx = makeContext({ variables: { step: 1 } });

    let firstCallCtx: AgentContext | null = null;
    let secondCallCtx: AgentContext | null = null;

    const executor = vi.fn(async (agentCtx: AgentContext) => {
      if (agentCtx.role === "planner") {
        firstCallCtx = { ...agentCtx };
        return engine.createHandoff("executor", "plan done", "execute", {
          step: 2,
          planResult: "approved",
        });
      }
      secondCallCtx = { ...agentCtx };
      return "Done with step " + agentCtx.variables.step;
    });

    const result = await engine.runHandoffLoop(ctx, executor);

    expect(firstCallCtx!.variables.step).toBe(1);
    // After handoff, variables should be merged
    expect(secondCallCtx!.variables.step).toBe(2);
    expect(secondCallCtx!.variables.planResult).toBe("approved");
    expect(result).toBe("Done with step 2");
  });

  it("10. error in agent executor — propagates, doesn't hang", async () => {
    const engine = makeEngine();
    const ctx = makeContext();

    const executor = vi.fn(async (_ctx: AgentContext): Promise<string | HandoffSignal> => {
      throw new Error("Executor exploded");
    });

    await expect(engine.runHandoffLoop(ctx, executor)).rejects.toThrow("Executor exploded");
  });
});
