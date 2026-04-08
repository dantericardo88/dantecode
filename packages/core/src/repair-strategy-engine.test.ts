// ============================================================================
// RepairStrategyEngine — unit tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { RepairStrategyEngine } from "./repair-strategy-engine.js";
import type { VerificationStageResult } from "./verification-engine.js";
import type { ParsedError } from "./error-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  stage: VerificationStageResult["stage"],
  errors: ParsedError[],
  opts: Partial<VerificationStageResult> = {},
): VerificationStageResult {
  return {
    stage,
    passed: false,
    exitCode: 1,
    stdout: "",
    stderr: opts.stderr ?? "",
    durationMs: 0,
    errorCount: errors.length,
    parsedErrors: errors,
    ...opts,
  };
}

function makeError(msg: string, opts: Partial<ParsedError> = {}): ParsedError {
  return {
    file: opts.file ?? "src/foo.ts",
    line: opts.line ?? 42,
    column: opts.column ?? null,
    message: msg,
    errorType: opts.errorType ?? "typescript",
    code: opts.code ?? null,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// describe: classifyError
// ---------------------------------------------------------------------------

describe("RepairStrategyEngine.classifyError", () => {
  const engine = new RepairStrategyEngine();

  it("classifies type mismatch", () => {
    const err = makeError("Type 'string' is not assignable to type 'number'");
    const result = engine.classifyError(err, "typecheck");
    expect(result.category).toBe("type_mismatch");
    expect(result.priority).toBe(1);
  });

  it("classifies missing import — cannot find module", () => {
    const err = makeError("Cannot find module '@dantecode/missing'");
    const result = engine.classifyError(err, "typecheck");
    expect(result.category).toBe("missing_import");
  });

  it("classifies missing import — no default export", () => {
    const err = makeError("has no default export");
    const result = engine.classifyError(err, "typecheck");
    expect(result.category).toBe("missing_import");
  });

  it("classifies missing export", () => {
    const err = makeError("named export 'Foo' not found");
    const result = engine.classifyError(err, "typecheck");
    expect(result.category).toBe("missing_export");
  });

  it("classifies undefined symbol — cannot find name", () => {
    const err = makeError("Cannot find name 'myVar'");
    const result = engine.classifyError(err, "typecheck");
    expect(result.category).toBe("undefined_symbol");
  });

  it("classifies lint violation by stage override", () => {
    const err = makeError("no-unused-vars: variable 'x' defined but never used", { code: "no-unused-vars" });
    const result = engine.classifyError(err, "lint");
    expect(result.category).toBe("lint_violation");
    expect(result.repairAction).toContain("no-unused-vars");
  });

  it("classifies test assertion error", () => {
    const err = makeError("Expected 5 to equal 3");
    const result = engine.classifyError(err, "unit");
    expect(result.category).toBe("test_assertion");
    expect(result.priority).toBe(3);
  });

  it("classifies test setup error", () => {
    const err = makeError("Cannot spy the someMethod property because it is not a function");
    const result = engine.classifyError(err, "unit");
    expect(result.category).toBe("test_setup");
  });

  it("falls back to unknown for unrecognized errors", () => {
    const err = makeError("Some completely unknown error 12345");
    const result = engine.classifyError(err, "unit");
    expect(result.category).toBe("unknown");
    expect(result.priority).toBe(3);
  });

  it("object is possibly null → type_mismatch", () => {
    const err = makeError("Object is possibly 'null'");
    const result = engine.classifyError(err, "typecheck");
    expect(result.category).toBe("type_mismatch");
  });
});

// ---------------------------------------------------------------------------
// describe: buildRepairPrompt
// ---------------------------------------------------------------------------

describe("RepairStrategyEngine.buildRepairPrompt", () => {
  const engine = new RepairStrategyEngine();

  it("returns a non-empty string for a typecheck failure", () => {
    const result = makeResult("typecheck", [
      makeError("Type 'string' is not assignable to type 'number'"),
    ]);
    const prompt = engine.buildRepairPrompt("typecheck", result);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(20);
  });

  it("includes error location in prompt", () => {
    const result = makeResult("typecheck", [
      makeError("Type mismatch", { file: "src/model.ts", line: 99 }),
    ]);
    const prompt = engine.buildRepairPrompt("typecheck", result);
    expect(prompt).toContain("src/model.ts");
  });

  it("includes stage header for lint", () => {
    const result = makeResult("lint", [
      makeError("no-unused-vars", { code: "no-unused-vars" }),
    ]);
    const prompt = engine.buildRepairPrompt("lint", result);
    expect(prompt.toLowerCase()).toContain("lint");
  });

  it("includes stage header for unit test assertion", () => {
    const result = makeResult("unit", [
      makeError("Expected 5 to equal 3"),
    ]);
    const prompt = engine.buildRepairPrompt("unit", result);
    expect(prompt.toLowerCase()).toContain("test");
  });

  it("falls back gracefully when no parsedErrors", () => {
    const result = makeResult("typecheck", [], {
      stderr: "Something weird happened\nerror line 2",
    });
    const prompt = engine.buildRepairPrompt("typecheck", result);
    expect(prompt).toContain("Something weird happened");
  });

  it("caps displayed errors at 10", () => {
    const errors = Array.from({ length: 15 }, (_, i) =>
      makeError(`Error ${i}`, { file: `src/file${i}.ts` }),
    );
    const result = makeResult("typecheck", errors);
    const prompt = engine.buildRepairPrompt("typecheck", result);
    expect(prompt).toContain("5 more errors");
  });
});

// ---------------------------------------------------------------------------
// describe: buildRepairPlan
// ---------------------------------------------------------------------------

describe("RepairStrategyEngine.buildRepairPlan", () => {
  const engine = new RepairStrategyEngine();

  it("returns difficulty=easy for < 5 errors", () => {
    const result = makeResult("typecheck", [makeError("Type mismatch")]);
    const plan = engine.buildRepairPlan("typecheck", result);
    expect(plan.difficulty).toBe("easy");
  });

  it("returns difficulty=medium for 5-14 errors", () => {
    const errors = Array.from({ length: 8 }, () => makeError("Type mismatch"));
    const result = makeResult("typecheck", errors);
    const plan = engine.buildRepairPlan("typecheck", result);
    expect(plan.difficulty).toBe("medium");
  });

  it("returns difficulty=hard for 15+ errors", () => {
    const errors = Array.from({ length: 20 }, () => makeError("Type mismatch"));
    const result = makeResult("typecheck", errors);
    const plan = engine.buildRepairPlan("typecheck", result);
    expect(plan.difficulty).toBe("hard");
  });

  it("computes dominant category correctly", () => {
    const errors = [
      makeError("Type 'string' is not assignable to type 'number'"),
      makeError("Type 'boolean' is not assignable to type 'string'"),
      makeError("Cannot find name 'x'"),
    ];
    const result = makeResult("typecheck", errors);
    const plan = engine.buildRepairPlan("typecheck", result);
    expect(plan.dominantCategory).toBe("type_mismatch");
  });

  it("stage field matches input", () => {
    const result = makeResult("lint", [makeError("eslint violation")]);
    const plan = engine.buildRepairPlan("lint", result);
    expect(plan.stage).toBe("lint");
  });
});
