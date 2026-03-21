// ============================================================================
// @dantecode/skill-adapter — Skill Composition Chain
// Connect skills into multi-step workflows with optional DanteForge gates.
// Chains execute sequentially: each step receives the previous output.
// ============================================================================

import YAML from "yaml";
import { evaluateGate } from "./conditional.js";
import type { GateCondition } from "./conditional.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ChainStep {
  skillName: string;
  params: Record<string, string>; // "$input", "$previous.output", or literal values
  gate?: GateCondition;
}

export interface ChainDefinition {
  name: string;
  description: string;
  steps: ChainStep[];
}

export interface StepExecutionResult {
  skillName: string;
  output: string;
  pdseScore?: number;
  passed: boolean;
  durationMs: number;
  status?: "success" | "failed" | "skipped";
  verified?: boolean;
}

export interface ChainExecutionResult {
  chainName: string;
  steps: StepExecutionResult[];
  finalOutput: string;
  /** Whether the chain completed successfully. */
  success: boolean;
  /** Alias for `success`. */
  completed: boolean;
  totalDurationMs: number;
}

// ----------------------------------------------------------------------------
// SkillChain
// ----------------------------------------------------------------------------

export class SkillChain {
  private _steps: ChainStep[] = [];

  constructor(
    public readonly name: string = "unnamed-chain",
    public readonly description: string = "",
  ) {}

  /**
   * Appends a step to the chain. Returns `this` for fluent chaining.
   */
  add(skillName: string, params: Record<string, string> = {}): this {
    this._steps.push({ skillName, params });
    return this;
  }

  /**
   * Appends a gate to the chain.
   *
   * Two call signatures:
   *   1. addGate(skillName, gate, params?) — step with gate
   *   2. addGate(gate)                     — gate-only sentinel step (skillName = "")
   */
  addGate(gateOrSkillName: GateCondition | string, gate?: GateCondition, params: Record<string, string> = {}): this {
    if (typeof gateOrSkillName === "string") {
      this._steps.push({ skillName: gateOrSkillName, params, gate });
    } else {
      // Gate-only step: empty skillName signals executeChain to only run the gate
      this._steps.push({ skillName: "", params: {}, gate: gateOrSkillName });
    }
    return this;
  }

  /**
   * Returns a shallow copy of the steps array.
   */
  getSteps(): ChainStep[] {
    return [...this._steps];
  }

  /**
   * Returns a serializable ChainDefinition.
   */
  toDefinition(): ChainDefinition {
    return {
      name: this.name,
      description: this.description,
      steps: this.getSteps(),
    };
  }

  /**
   * Serializes the chain to YAML.
   */
  toYAML(): string {
    return YAML.stringify(
      { name: this.name, description: this.description, steps: this._steps },
      { indent: 2 },
    );
  }

  /**
   * Parses YAML content and creates a SkillChain instance.
   * Throws on invalid YAML or missing `steps` array.
   */
  static fromYAML(content: string): SkillChain {
    let parsed: unknown;
    try {
      parsed = YAML.parse(content);
    } catch (err) {
      throw new Error(
        `Invalid YAML in chain definition: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Chain definition must be a YAML object");
    }
    const def = parsed as ChainDefinition;
    if (!Array.isArray(def.steps)) {
      throw new Error("Chain definition must have a 'steps' array");
    }
    return SkillChain.fromDefinition(def);
  }

  /**
   * Creates a SkillChain from a plain ChainDefinition object.
   */
  static fromDefinition(def: ChainDefinition): SkillChain {
    const chain = new SkillChain(def.name, def.description ?? "");
    for (const step of def.steps ?? []) {
      if (step.gate) {
        if (step.skillName === "") {
          // Gate-only sentinel — use 1-arg form to preserve API contract
          chain.addGate(step.gate);
        } else {
          chain.addGate(step.skillName, step.gate, step.params ?? {});
        }
      } else {
        chain.add(step.skillName, step.params ?? {});
      }
    }
    return chain;
  }
}

// ----------------------------------------------------------------------------
// Param Resolution
// ----------------------------------------------------------------------------

/**
 * Resolves parameter template values:
 * - "$input"           → initialInput
 * - "$previous.output" → previousOutput
 * - other values       → returned as-is (literals)
 */
export function resolveParams(
  params: Record<string, string>,
  initialInput: string,
  previousOutput: string,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === "$input") {
      resolved[key] = initialInput;
    } else if (value === "$previous.output") {
      resolved[key] = previousOutput;
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

// ----------------------------------------------------------------------------
// Execution context — internal helpers
// ----------------------------------------------------------------------------

export interface StepCallbackResult {
  skillName?: string;
  status?: "success" | "failed" | "skipped";
  output: string;
  verified?: boolean;
  pdseScore?: number;  // Optional quality score returned by executor
}

// Legacy context shape (backwards-compatible): takes (skillName, input, params)
interface LegacyExecutionContext {
  projectRoot: string;
  executeStep?: (
    skillName: string,
    input: string,
    params: Record<string, string>,
  ) => Promise<string>;
}

// New context shape: takes (skillName, params) and returns StepCallbackResult or string
interface NewExecutionContext {
  executeStep?: (
    skillName: string,
    params: Record<string, string>,
  ) => Promise<StepCallbackResult | string>;
}

export type ExecutionContext = LegacyExecutionContext | NewExecutionContext;

function isLegacyContext(ctx: ExecutionContext): ctx is LegacyExecutionContext {
  return typeof (ctx as Record<string, unknown>)["projectRoot"] === "string";
}

// ----------------------------------------------------------------------------
// Chain Execution
// ----------------------------------------------------------------------------

/**
 * Executes a skill chain step-by-step.
 *
 * Supports two call signatures:
 *   Legacy: executeChain(chain: SkillChain, initialInput: string, context)
 *   New:    executeChain(definition: ChainDefinition, context)
 *
 * Each step:
 * 1. Resolves params ($input / $previous.output / literal).
 * 2. Calls context.executeStep() if provided; else uses a placeholder.
 * 3. Evaluates gate conditions via evaluateGate().
 *    - "stop" (default): marks chain failed, halts.
 *    - "skip": records skipped result and continues.
 *    - "retry": decrements step index to re-run (up to maxRetries); then → stop.
 */
export async function executeChain(
  chainOrDef: SkillChain | ChainDefinition,
  initialInputOrContext: string | ExecutionContext,
  maybeContext?: ExecutionContext,
): Promise<ChainExecutionResult> {
  // ------------------------------------------------------------------
  // Normalise overloaded arguments
  // ------------------------------------------------------------------
  let steps: ChainStep[];
  let chainName: string;
  let initialInput: string;
  let context: ExecutionContext;

  if (chainOrDef instanceof SkillChain) {
    steps = chainOrDef.getSteps();
    chainName = chainOrDef.name;
    if (typeof initialInputOrContext !== "string" && maybeContext === undefined) {
      // New-style: executeChain(chain, context)
      initialInput = "";
      context = initialInputOrContext as ExecutionContext;
    } else {
      // Legacy: executeChain(chain, "input", context?)
      initialInput = typeof initialInputOrContext === "string" ? initialInputOrContext : "";
      context = maybeContext ?? {};
    }
  } else {
    const def = chainOrDef as ChainDefinition;
    steps = def.steps ?? [];
    chainName = def.name ?? "unnamed-chain";
    if (typeof initialInputOrContext !== "string" && maybeContext === undefined) {
      // New-style: executeChain(definition, context)
      initialInput = "";
      context = initialInputOrContext as ExecutionContext;
    } else {
      // Legacy: executeChain(definition, "input", context?)
      initialInput = typeof initialInputOrContext === "string" ? initialInputOrContext : "";
      context = (maybeContext ?? {}) as ExecutionContext;
    }
  }

  const chainStart = Date.now();
  const results: StepExecutionResult[] = [];
  let previousOutput = "";
  let success = true;

  // Use an index-based loop so we can re-run steps on retry
  let i = 0;
  let retryCount = 0;

  while (i < steps.length) {
    const step = steps[i]!;

    // ------------------------------------------------------------------
    // Gate-only sentinel step (skillName === "" from addGate(gate) form)
    // ------------------------------------------------------------------
    if (step.skillName === "" && step.gate) {
      const lastResult = results[results.length - 1];
      const pdseScore: number = lastResult?.pdseScore ?? (context.executeStep ? 90 : 60);
      const verifiedBool: boolean = lastResult?.verified ?? false;

      const gateEval = evaluateGate(pdseScore, verifiedBool, step.gate, retryCount);

      if (!gateEval.passed) {
        const action = gateEval.suggestedAction ?? "stop";

        if (action === "skip") {
          results.push({
            skillName: "",
            status: "skipped",
            output: `Gate skipped: ${gateEval.reason ?? "gate condition not met"}`,
            passed: false,
            durationMs: 0,
          });
          retryCount = 0;
          i++;
          continue;
        } else {
          // stop (retry not meaningful on a gate-only sentinel)
          results.push({
            skillName: "",
            status: "failed",
            output: `Gate stopped: ${gateEval.reason ?? "gate condition not met"}`,
            passed: false,
            durationMs: 0,
          });
          success = false;
          break;
        }
      }

      retryCount = 0;
      i++;
      continue;
    }

    // ------------------------------------------------------------------
    // Regular skill step
    // ------------------------------------------------------------------
    const resolvedParams = resolveParams(step.params, initialInput, previousOutput);
    const resolvedInput = resolvedParams["input"] ?? previousOutput ?? initialInput;

    const runStep = async (): Promise<{ output: string; durationMs: number; verified?: boolean; pdseScore?: number }> => {
      const start = Date.now();

      if (!context.executeStep) {
        return {
          output: `[Skill: ${step.skillName} | Input: ${resolvedInput}]`,
          durationMs: Date.now() - start,
        };
      }

      if (isLegacyContext(context)) {
        const out = await (context as LegacyExecutionContext).executeStep!(
          step.skillName,
          resolvedInput,
          resolvedParams,
        );
        return { output: out, durationMs: Date.now() - start };
      }

      // New-style executor
      const raw = await (context as NewExecutionContext).executeStep!(step.skillName, resolvedParams);
      if (typeof raw === "string") {
        return { output: raw, durationMs: Date.now() - start };
      }
      return { output: raw.output, durationMs: Date.now() - start, verified: raw.verified, pdseScore: raw.pdseScore };
    };

    const { output, durationMs, verified: stepVerified, pdseScore: stepPdseScore } = await runStep();

    // ------------------------------------------------------------------
    // Gate evaluation for this step
    // ------------------------------------------------------------------
    if (step.gate) {
      const pdseScore: number = stepPdseScore ?? (context.executeStep ? 90 : 60);
      const verifiedBool: boolean = stepVerified ?? false;

      const gateEval = evaluateGate(pdseScore, verifiedBool, step.gate, retryCount);

      if (!gateEval.passed) {
        const action = gateEval.suggestedAction ?? "stop";

        if (action === "retry" && retryCount < (step.gate.maxRetries ?? 1)) {
          retryCount++;
          // Re-run this step: do NOT push a result, do NOT increment i
          continue;
        } else if (action === "skip") {
          results.push({
            skillName: step.skillName,
            status: "skipped",
            output: `Gate skipped: ${gateEval.reason ?? "gate condition not met"}`,
            passed: false,
            durationMs,
          });
          retryCount = 0;
          i++;
          continue;
        } else {
          // stop
          results.push({
            skillName: step.skillName,
            status: "failed",
            output: `Gate stopped: ${gateEval.reason ?? "gate condition not met"}`,
            passed: false,
            durationMs,
          });
          success = false;
          break;
        }
      }

      retryCount = 0; // gate passed — reset retry counter
    }

    // Step passed (no gate, or gate passed)
    results.push({
      skillName: step.skillName,
      status: "success",
      output,
      pdseScore: stepPdseScore ?? (context.executeStep ? 90 : 60),
      passed: true,
      durationMs,
      verified: stepVerified,
    });
    previousOutput = output;
    i++;
  }

  const finalOutput =
    results.length > 0 ? (results[results.length - 1]?.output ?? "") : "";

  return {
    chainName,
    steps: results,
    finalOutput,
    success,
    completed: success,
    totalDurationMs: Date.now() - chainStart,
  };
}
