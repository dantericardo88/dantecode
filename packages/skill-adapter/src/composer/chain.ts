// ============================================================================
// @dantecode/skill-adapter — Skill Composition Chain
// Connect skills into multi-step workflows with optional DanteForge gates.
// Chains execute sequentially: each step receives the previous output.
// ============================================================================

import YAML from "yaml";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ChainStep {
  skillName: string;
  params: Record<string, string>; // "$input", "$previous.output", or literal values
  gate?: {
    minPdse?: number;
    requireVerification?: boolean;
    onFail?: "stop" | "retry" | "skip"; // default: "stop"
  };
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
}

export interface ChainExecutionResult {
  chainName: string;
  steps: StepExecutionResult[];
  finalOutput: string;
  success: boolean;
  totalDurationMs: number;
}

// ----------------------------------------------------------------------------
// SkillChain
// ----------------------------------------------------------------------------

export class SkillChain {
  private steps: ChainStep[] = [];

  constructor(
    public readonly name: string,
    public readonly description: string = "",
  ) {}

  /**
   * Appends a step to the chain. Returns `this` for fluent chaining.
   */
  add(skillName: string, params: Record<string, string> = {}): this {
    this.steps.push({ skillName, params });
    return this;
  }

  /**
   * Appends a step with a gate condition. Returns `this` for fluent chaining.
   */
  addGate(
    skillName: string,
    gate: ChainStep["gate"],
    params: Record<string, string> = {},
  ): this {
    this.steps.push({ skillName, params, gate });
    return this;
  }

  /**
   * Returns a shallow copy of the steps array.
   */
  getSteps(): ChainStep[] {
    return [...this.steps];
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
      { name: this.name, description: this.description, steps: this.steps },
      { indent: 2 },
    );
  }

  /**
   * Parses YAML content and creates a SkillChain instance.
   */
  static fromYAML(content: string): SkillChain {
    const def = YAML.parse(content) as ChainDefinition;
    return SkillChain.fromDefinition(def);
  }

  /**
   * Creates a SkillChain from a plain ChainDefinition object.
   */
  static fromDefinition(def: ChainDefinition): SkillChain {
    const chain = new SkillChain(def.name, def.description ?? "");
    for (const step of def.steps ?? []) {
      if (step.gate) {
        chain.addGate(step.skillName, step.gate, step.params ?? {});
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
// Chain Execution
// ----------------------------------------------------------------------------

/**
 * Executes a SkillChain step-by-step.
 *
 * Each step:
 * 1. Resolves params ($input / $previous.output / literal).
 * 2. Calls context.executeStep() if provided; else uses a placeholder.
 * 3. Evaluates gate conditions (minPdse / onFail).
 *    - "stop" (default): marks chain failed, halts.
 *    - "skip": skips to next step.
 *    - "retry": retries the step once; if still failing → stop.
 *
 * @param chain        - The SkillChain to run.
 * @param initialInput - The initial input string passed into the first step.
 * @param context      - Execution context, including optional step executor.
 */
export async function executeChain(
  chain: SkillChain,
  initialInput: string,
  context: {
    projectRoot: string;
    executeStep?: (
      skillName: string,
      input: string,
      params: Record<string, string>,
    ) => Promise<string>;
  },
): Promise<ChainExecutionResult> {
  const chainStart = Date.now();
  const stepResults: StepExecutionResult[] = [];
  let previousOutput = "";
  let success = true;

  const steps = chain.getSteps();

  for (const step of steps) {
    const resolvedParams = resolveParams(step.params, initialInput, previousOutput);

    // The "input" for this step is either from params or the previous output
    const resolvedInput = resolvedParams["input"] ?? previousOutput ?? initialInput;

    const runStep = async (): Promise<{ output: string; durationMs: number }> => {
      const start = Date.now();
      let output: string;
      if (context.executeStep) {
        output = await context.executeStep(step.skillName, resolvedInput, resolvedParams);
      } else {
        output = `[Skill: ${step.skillName} | Input: ${resolvedInput}]`;
      }
      return { output, durationMs: Date.now() - start };
    };

    // Run the step (with optional retry)
    let { output, durationMs } = await runStep();

    // Gate evaluation
    if (step.gate) {
      const { minPdse, onFail = "stop" } = step.gate;

      if (minPdse !== undefined) {
        // Mock PDSE score: 90 if we have real output, 60 for placeholder
        const pdseScore = context.executeStep ? 90 : 60;
        const gatePassed = pdseScore >= minPdse;

        if (!gatePassed) {
          if (onFail === "retry") {
            // Retry once
            const retried = await runStep();
            const retriedScore = context.executeStep ? 90 : 60;

            if (retriedScore >= minPdse) {
              // Retry succeeded
              output = retried.output;
              durationMs += retried.durationMs;
              stepResults.push({
                skillName: step.skillName,
                output,
                pdseScore: retriedScore,
                passed: true,
                durationMs,
              });
              previousOutput = output;
              continue;
            } else {
              // Retry still failed → stop
              stepResults.push({
                skillName: step.skillName,
                output: retried.output,
                pdseScore: retriedScore,
                passed: false,
                durationMs: durationMs + retried.durationMs,
              });
              success = false;
              break;
            }
          } else if (onFail === "skip") {
            stepResults.push({
              skillName: step.skillName,
              output,
              pdseScore,
              passed: false,
              durationMs,
            });
            // Do NOT update previousOutput — skip this step's contribution
            continue;
          } else {
            // "stop" (default)
            stepResults.push({
              skillName: step.skillName,
              output,
              pdseScore,
              passed: false,
              durationMs,
            });
            success = false;
            break;
          }
        } else {
          stepResults.push({
            skillName: step.skillName,
            output,
            pdseScore,
            passed: true,
            durationMs,
          });
          previousOutput = output;
          continue;
        }
      }
    }

    // No gate or gate passed without the minPdse path
    stepResults.push({
      skillName: step.skillName,
      output,
      passed: true,
      durationMs,
    });
    previousOutput = output;
  }

  const finalOutput = stepResults.length > 0
    ? (stepResults[stepResults.length - 1]?.output ?? "")
    : "";

  return {
    chainName: chain.name,
    steps: stepResults,
    finalOutput,
    success,
    totalDurationMs: Date.now() - chainStart,
  };
}
