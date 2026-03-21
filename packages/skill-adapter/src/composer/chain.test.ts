import { describe, it, expect } from "vitest";
import { SkillChain, executeChain, resolveParams } from "./chain.js";
import { evaluateGate, scorePassesThreshold } from "./conditional.js";

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
      executeStep: async (_skillName) => {
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
  it("score above threshold → passed: true, suggestedAction: proceed", () => {
    const evaluation = evaluateGate(90, true, { minPdse: 85 }, 0);
    expect(evaluation.passed).toBe(true);
    expect(evaluation.suggestedAction).toBe("proceed");
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
