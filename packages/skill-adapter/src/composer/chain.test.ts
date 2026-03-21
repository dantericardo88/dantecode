import { describe, it, expect } from "vitest";
import { SkillChain, executeChain, resolveParams } from "./chain.js";
import type { ChainDefinition } from "./chain.js";
import { evaluateGate, scorePassesThreshold, selectOnFail } from "./conditional.js";

// ----------------------------------------------------------------------------
// SkillChain construction
// ----------------------------------------------------------------------------

describe("SkillChain", () => {
  it("creates a chain and add() appends steps", () => {
    const chain = new SkillChain("test-chain", "A test chain");
    chain.add("skill-a").add("skill-b").add("skill-c");
    const steps = chain.getSteps();
    expect(steps).toHaveLength(3);
    expect(steps[0]?.skillName).toBe("skill-a");
    expect(steps[1]?.skillName).toBe("skill-b");
    expect(steps[2]?.skillName).toBe("skill-c");
  });

  it("add() returns this for fluent chaining", () => {
    const chain = new SkillChain("fluent");
    const result = chain.add("skill-a");
    expect(result).toBe(chain);
  });

  it("addGate() attaches a gate property to the step", () => {
    const chain = new SkillChain("gated-chain");
    chain.addGate("skill-gated", { minPdse: 80, onFail: "stop" });
    const steps = chain.getSteps();
    expect(steps).toHaveLength(1);
    expect(steps[0]?.gate).toBeDefined();
    expect(steps[0]?.gate?.minPdse).toBe(80);
    expect(steps[0]?.gate?.onFail).toBe("stop");
  });

  it("toYAML() + fromYAML() roundtrip preserves name, description, and steps", () => {
    const original = new SkillChain("roundtrip-chain", "Roundtrip test");
    original.add("skill-one", { input: "$input" });
    original.addGate("skill-two", { minPdse: 75, onFail: "skip" });

    const yaml = original.toYAML();
    const restored = SkillChain.fromYAML(yaml);

    expect(restored.name).toBe("roundtrip-chain");
    expect(restored.description).toBe("Roundtrip test");

    const steps = restored.getSteps();
    expect(steps).toHaveLength(2);
    expect(steps[0]?.skillName).toBe("skill-one");
    expect(steps[0]?.params?.["input"]).toBe("$input");
    expect(steps[1]?.skillName).toBe("skill-two");
    expect(steps[1]?.gate?.minPdse).toBe(75);
    expect(steps[1]?.gate?.onFail).toBe("skip");
  });

  it("fromDefinition() creates a chain from a plain object", () => {
    const def: import("./chain.js").ChainDefinition = {
      name: "def-chain",
      description: "From definition",
      steps: [
        { skillName: "skill-alpha", params: {} },
        { skillName: "skill-beta", params: { val: "hello" }, gate: { minPdse: 50 } },
      ],
    };
    const chain = SkillChain.fromDefinition(def);
    expect(chain.name).toBe("def-chain");
    expect(chain.description).toBe("From definition");
    const steps = chain.getSteps();
    expect(steps).toHaveLength(2);
    expect(steps[1]?.gate?.minPdse).toBe(50);
  });
});

// ----------------------------------------------------------------------------
// resolveParams
// ----------------------------------------------------------------------------

describe("resolveParams", () => {
  it("replaces $input with initialInput", () => {
    const result = resolveParams({ text: "$input" }, "hello world", "prev");
    expect(result["text"]).toBe("hello world");
  });

  it("replaces $previous.output with previousOutput", () => {
    const result = resolveParams({ data: "$previous.output" }, "initial", "prev-result");
    expect(result["data"]).toBe("prev-result");
  });

  it("returns literals unchanged", () => {
    const result = resolveParams({ mode: "strict", count: "5" }, "input", "prev");
    expect(result["mode"]).toBe("strict");
    expect(result["count"]).toBe("5");
  });
});

// ----------------------------------------------------------------------------
// executeChain
// ----------------------------------------------------------------------------

describe("executeChain", () => {
  it("executes 3 steps and returns finalOutput from the last step with success: true", async () => {
    const chain = new SkillChain("exec-chain");
    chain.add("step-1").add("step-2").add("step-3");

    const outputs = ["result-1", "result-2", "result-3"];
    let callIndex = 0;

    const result = await executeChain(chain, "start-input", {
      projectRoot: "/fake",
      executeStep: async (_skillName: string, _input: string, _params: Record<string, string>) => {
        return outputs[callIndex++] ?? "fallback";
      },
    });

    expect(result.success).toBe(true);
    expect(result.chainName).toBe("exec-chain");
    expect(result.steps).toHaveLength(3);
    expect(result.finalOutput).toBe("result-3");
  });

  it("gate with onFail: 'stop' and score below threshold → success: false", async () => {
    const chain = new SkillChain("gated-stop-chain");
    chain.addGate("skill-a", { minPdse: 95, onFail: "stop" });

    // No executeStep provided → placeholder output → score of 60 < 95
    const result = await executeChain(chain, "input", { projectRoot: "/fake" });

    expect(result.success).toBe(false);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.passed).toBe(false);
  });

  it("uses placeholder output when executeStep is not provided", async () => {
    const chain = new SkillChain("placeholder-chain");
    chain.add("my-skill");

    const result = await executeChain(chain, "test-input", { projectRoot: "/fake" });

    expect(result.success).toBe(true);
    expect(result.finalOutput).toContain("my-skill");
  });
});

// ----------------------------------------------------------------------------
// evaluateGate
// ----------------------------------------------------------------------------

describe("evaluateGate", () => {
  it("score above threshold → passed: true, suggestedAction: undefined", () => {
    const evaluation = evaluateGate(90, true, { minPdse: 85 }, 0);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.suggestedAction).toBeUndefined();
  });

  it("score below threshold with onFail: 'skip' → passed: false, suggestedAction: skip", () => {
    const evaluation = evaluateGate(70, false, { minPdse: 85, onFail: "skip" }, 0);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.suggestedAction).toBe("skip");
    expect(evaluation.reason).toContain("70");
    expect(evaluation.reason).toContain("85");
  });

  it("score below threshold with onFail: 'retry' and retryCount < maxRetries → retry", () => {
    const evaluation = evaluateGate(60, false, { minPdse: 80, onFail: "retry", maxRetries: 2 }, 1);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.suggestedAction).toBe("retry");
  });

  it("score below threshold with onFail: 'retry' and retryCount >= maxRetries → stop", () => {
    const evaluation = evaluateGate(60, false, { minPdse: 80, onFail: "retry", maxRetries: 1 }, 1);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.suggestedAction).toBe("stop");
  });
});

// ----------------------------------------------------------------------------
// scorePassesThreshold
// ----------------------------------------------------------------------------

describe("scorePassesThreshold", () => {
  it("returns true when score >= threshold", () => {
    expect(scorePassesThreshold(90, 85)).toBe(true);
    expect(scorePassesThreshold(85, 85)).toBe(true);
  });

  it("returns false when score < threshold", () => {
    expect(scorePassesThreshold(70, 85)).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// selectOnFail
// ----------------------------------------------------------------------------

describe("selectOnFail", () => {
  it("returns stop when onFail is stop", () => {
    const result = selectOnFail({ onFail: "stop" }, 0);
    expect(result).toBe("stop");
  });

  it("returns retry when retryCount < maxRetries", () => {
    const result = selectOnFail({ onFail: "retry", maxRetries: 3 }, 1);
    expect(result).toBe("retry");
  });

  it("returns stop when retryCount >= maxRetries", () => {
    const result = selectOnFail({ onFail: "retry", maxRetries: 1 }, 1);
    expect(result).toBe("stop");
  });

  it("returns skip when onFail is skip", () => {
    const result = selectOnFail({ onFail: "skip" }, 0);
    expect(result).toBe("skip");
  });

  it("defaults to stop when onFail is undefined", () => {
    const result = selectOnFail({}, 0);
    expect(result).toBe("stop");
  });
});

// ----------------------------------------------------------------------------
// evaluateGate — requireVerification tests
// ----------------------------------------------------------------------------

describe("evaluateGate — requireVerification", () => {
  it("fails when requireVerification is true but verified is false", () => {
    const result = evaluateGate(95, false, { requireVerification: true }, 0);
    expect(result.passed).toBe(false);
    expect(result.suggestedAction).toBe("stop");
  });

  it("passes when requireVerification is true and verified is true", () => {
    const result = evaluateGate(95, true, { requireVerification: true }, 0);
    expect(result.passed).toBe(true);
  });

  it("fails when both minPdse and requireVerification fail", () => {
    const result = evaluateGate(60, false, { minPdse: 80, requireVerification: true }, 0);
    expect(result.passed).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// SkillChain.fromYAML() validation
// ----------------------------------------------------------------------------

describe("SkillChain.fromYAML() validation", () => {
  it("throws on invalid YAML", () => {
    expect(() => SkillChain.fromYAML("{not: valid: yaml:")).toThrow(/Invalid YAML/);
  });

  it("throws when steps array is missing", () => {
    expect(() => SkillChain.fromYAML("name: my-chain\nparams: {}")).toThrow(/steps/);
  });

  it("round-trips a chain definition through YAML", () => {
    const chain = new SkillChain("yaml-chain").add("skill-a", {}).add("skill-b", {});
    const yaml = chain.toYAML();
    const restored = SkillChain.fromYAML(yaml);
    expect(restored.toDefinition().steps).toHaveLength(2);
  });
});

// ----------------------------------------------------------------------------
// Gate integration — requireVerification stops chain
// ----------------------------------------------------------------------------

describe("executeChain — gate integration with requireVerification", () => {
  it("stops chain when requireVerification gate fails because step is not verified", async () => {
    const chain = new SkillChain("verify-gate-chain")
      .add("skill-a", {})
      .addGate({ requireVerification: true, onFail: "stop" })
      .add("skill-b", {});

    const result = await executeChain(chain.toDefinition(), {
      executeStep: async (_skillName: string, _params: Record<string, string>) => ({
        skillName: _skillName,
        status: "success" as const,
        output: "done",
        verified: false, // not verified
      }),
    });

    // skill-b should not run because gate stops on unverified result
    expect(result.steps.some((s) => s.skillName === "skill-b")).toBe(false);
    expect(result.completed).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// FIX 1 + FIX 2: 2-arg executeChain threads context and respects pdseScore
// ----------------------------------------------------------------------------

describe("executeChain — 2-arg form context threading", () => {
  it("2-arg executeChain(def, context) correctly threads context to executeStep", async () => {
    const chain = new SkillChain("context-test").add("skill-a", { key: "val" });

    const result = await executeChain(chain.toDefinition(), {
      executeStep: async (_name: string, _params: Record<string, string>) => ({
        output: "result",
        verified: true,
        pdseScore: 88,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.steps[0]?.pdseScore).toBe(88); // Verify pdseScore is respected from callback
  });
});

// ----------------------------------------------------------------------------
// FIX 5 Test B: YAML round-trip for gate-only sentinel steps
// ----------------------------------------------------------------------------

describe("SkillChain — gate-only sentinel YAML round-trip", () => {
  it("toYAML + fromYAML round-trips gate-only sentinel steps", () => {
    const original = new SkillChain("sentinel-test");
    original.add("skill-a", { input: "$input" });
    original.addGate({ minPdse: 85, onFail: "stop" });
    original.add("skill-b", {});
    const yaml = original.toYAML();
    const restored = SkillChain.fromYAML(yaml);
    const def = restored.toDefinition();
    expect(def.steps).toHaveLength(3);
    expect(def.steps[1]!.gate?.minPdse).toBe(85);
    expect(def.steps[1]!.skillName).toBe(""); // gate-only sentinel has empty skillName
  });
});

// ----------------------------------------------------------------------------
// Edge-case tests: 0-step chains, gate-only sentinel semantics, legacy wiring
// ----------------------------------------------------------------------------

describe("executeChain edge cases", () => {
  it("0-step chain returns success with empty finalOutput", async () => {
    const result = await executeChain(new SkillChain("empty").toDefinition(), {});
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(0);
    expect(result.finalOutput).toBe("");
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("gate-only sentinel as first step defaults to pdseScore 60 and fails if minPdse > 60", async () => {
    const chain = new SkillChain("first-gate");
    chain.addGate({ minPdse: 70, onFail: "stop" });
    const result = await executeChain(chain.toDefinition(), {});
    expect(result.success).toBe(false);
    expect(result.steps[0]?.status).toBe("failed");
  });

  it("legacy 3-arg form threads initialInput through executeStep", async () => {
    let captured: string | undefined;
    const chain = new SkillChain("legacy-input").add("skill-a", { input: "$input" });
    await executeChain(chain, "hello-legacy", {
      projectRoot: "/project",
      executeStep: async (_name: string, input: string, _params: Record<string, string>) => {
        captured = input;
        return "done";
      },
    });
    expect(captured).toBe("hello-legacy");
  });

  it("new-style executeStep returning plain string produces output with default pdseScore 90", async () => {
    const chain = new SkillChain("str-ret").add("skill-a", {});
    const result = await executeChain(chain.toDefinition(), {
      executeStep: async (_name: string, _params: Record<string, string>) => "plain-string",
    });
    expect(result.steps[0]?.output).toBe("plain-string");
    expect(result.steps[0]?.pdseScore).toBe(90);
    expect(result.success).toBe(true);
  });

  it("all-skipped chain: success is true when all step gates have onFail: skip", async () => {
    const def: ChainDefinition = {
      name: "all-skip",
      description: "",
      steps: [
        { skillName: "step-one", params: {}, gate: { minPdse: 999, onFail: "skip" } },
        { skillName: "step-two", params: {}, gate: { minPdse: 999, onFail: "skip" } },
      ],
    };
    const result = await executeChain(def, {
      executeStep: async (_name: string, _params: Record<string, string>) => ({ output: "ran", pdseScore: 50 }),
    });
    expect(result.success).toBe(true);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.status).toBe("skipped");
    expect(result.steps[1]?.status).toBe("skipped");
    expect(result.finalOutput).toContain("Gate skipped");
  });
});
