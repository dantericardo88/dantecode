// ============================================================================
// @dantecode/core — Multi-Agent Coordinator
// ============================================================================

import { ModelRouterImpl, type GenerateOptions } from "./model-router.js";
import type { DanteCodeState } from "@dantecode/config-types";
import { decomposeTask, type SandboxGroupingStrategy, type SubTask } from "./task-decomposer.js";
import { z } from "zod";

/** Callback for reporting multi-agent progress to the UI. */
export type MultiAgentProgressCallback = (update: {
  lane: string;
  status: "started" | "completed" | "failed";
  message: string;
  pdseScore?: number;
}) => void;

const agentLanes = ["orchestrator", "planner", "coder", "tester", "reviewer", "deployer"] as const;
type AgentLane = (typeof agentLanes)[number];

type DelegationPlan = Partial<Record<AgentLane, string>>;

export type AgentOutput = {
  lane: AgentLane;
  content: string;
  pdseScore: number; // 0-100 heuristic
};

export interface MultiAgentConfig {
  maxConcurrent: number;
  defaultLane: AgentLane;
  iterationLimit: number;
}

export class MultiAgent {
  private readonly router: ModelRouterImpl;
  private readonly state: DanteCodeState;
  private readonly config: MultiAgentConfig;

  constructor(router: ModelRouterImpl, state: DanteCodeState) {
    this.router = router;
    this.state = state;
    this.config = {
      maxConcurrent: state.agents.maxConcurrent,
      defaultLane: state.agents.defaultLane as AgentLane,
      iterationLimit: 3,
    };
  }

  /**
   * Coordinates multi-agent execution for a high-level task.
   *
   * 1. Orchestrator delegates to specialist lanes.
   * 2. Parallel dispatch (respects maxConcurrent).
   * 3. Aggregate outputs, compute composite PDSE.
   * 4. Iterate if composite PDSE < state.pdse.threshold.
   */
  async coordinate(
    task: string,
    options: GenerateOptions = {},
    onProgress?: MultiAgentProgressCallback,
  ): Promise<{
    plan: DelegationPlan;
    outputs: AgentOutput[];
    compositePdse: number;
    iterations: number;
  }> {
    let iterations = 0;
    let compositePdse = 0;

    while (iterations < this.config.iterationLimit && compositePdse < this.state.pdse.threshold) {
      iterations++;

      // Step 1: Orchestrate delegation
      const plan = await this.delegateTask(task);

      // Step 2: Parallel execution
      const outputs = await this.executeParallel(plan, options, onProgress);

      // Step 3: Score & aggregate
      compositePdse = this.computeCompositePdse(outputs);

      if (compositePdse >= this.state.pdse.threshold) {
        return { plan, outputs, compositePdse, iterations };
      }

      // Feedback loop: Refine task with prior outputs
      task = this.refineTask(task, outputs);
    }

    return { plan: {}, outputs: [], compositePdse, iterations };
  }

  /**
   * Decompose a high-level task description into sub-tasks using the LLM,
   * then execute each parallel group sequentially via coordinate().
   * Harvests OpenHands' sandbox grouping strategy + multi-conversation parallelism.
   */
  async decomposeAndRun(
    taskDescription: string,
    llmCall: (prompt: string) => Promise<string>,
    options: {
      maxSubTasks?: number;
      strategy?: SandboxGroupingStrategy;
      projectRoot?: string;
      generateOptions?: GenerateOptions;
      onProgress?: MultiAgentProgressCallback;
    } = {},
  ): Promise<{ outputs: AgentOutput[]; compositePdse: number; totalIterations: number }> {
    const { parallelGroups } = await decomposeTask(taskDescription, llmCall, {
      maxSubTasks: options.maxSubTasks,
      strategy: options.strategy,
      projectRoot: options.projectRoot,
    });

    const allOutputs: AgentOutput[] = [];
    let totalIterations = 0;

    for (const group of parallelGroups) {
      // Run each sub-task in the group via coordinate() and collect outputs
      const groupRuns = await Promise.all(
        group.map((t: SubTask) =>
          this.coordinate(
            t.description,
            options.generateOptions ?? {},
            options.onProgress,
          ),
        ),
      );

      for (const run of groupRuns) {
        allOutputs.push(...run.outputs);
        totalIterations += run.iterations;
      }
    }

    const compositePdse =
      allOutputs.length === 0
        ? 0
        : Math.round(allOutputs.reduce((sum, o) => sum + o.pdseScore, 0) / allOutputs.length);

    return { outputs: allOutputs, compositePdse, totalIterations };
  }

  private async delegateTask(task: string): Promise<DelegationPlan> {
    const orchestratorSystem = `You are the orchestrator agent. Analyze the task and delegate subtasks to specialist agents:
- planner: Break down into steps
- coder: Implement code changes
- tester: Write/run tests
- reviewer: Audit for PDSE (completeness, correctness, clarity, consistency)
- deployer: Prepare commits/publish

Task: ${task}

Respond ONLY with valid JSON: { "planner": "subtask desc", "coder": "...", ... }`;

    const delegationText = await this.router.generate([{ role: "user", content: task }], {
      system: orchestratorSystem,
    });

    const planObj = agentLanes.reduce((obj: Record<string, z.ZodString>, lane) => {
      obj[lane] = z.string();
      return obj;
    }, {});
    const planSchema = z.object(planObj).partial();
    let parsed;
    try {
      parsed = planSchema.safeParse(JSON.parse(delegationText));
    } catch {
      parsed = { success: false };
    }
    return parsed.success ? (parsed.data as DelegationPlan) : { [this.config.defaultLane]: task };
  }

  private async executeParallel(
    plan: DelegationPlan,
    options: GenerateOptions,
    onProgress?: MultiAgentProgressCallback,
  ): Promise<AgentOutput[]> {
    const outputs: AgentOutput[] = [];
    const semaphore = new Semaphore(this.config.maxConcurrent);

    await Promise.all(
      Object.entries(plan)
        .filter(([, subtask]) => subtask && subtask.trim())
        .map(async ([lane, subtask]) => {
          await semaphore.acquire();
          try {
            onProgress?.({ lane, status: "started", message: subtask.slice(0, 80) });
            const output = await this.executeAgent(lane as AgentLane, subtask, options);
            onProgress?.({
              lane,
              status: "completed",
              message: `PDSE: ${output.pdseScore}`,
              pdseScore: output.pdseScore,
            });
            outputs.push(output);
          } catch (err) {
            onProgress?.({
              lane,
              status: "failed",
              message: err instanceof Error ? err.message : String(err),
            });
          } finally {
            semaphore.release();
          }
        }),
    );

    return outputs;
  }

  private async executeAgent(
    lane: AgentLane,
    subtask: string,
    options: GenerateOptions,
  ): Promise<AgentOutput> {
    const systemPrompts: Record<AgentLane, string> = {
      orchestrator: "You orchestrate multi-agent workflows.",
      planner: "You plan precise steps for tasks. Output structured plans.",
      coder: "You write production-ready TypeScript code. No stubs, full impls.",
      tester: "You write comprehensive Vitest tests. Mock minimally, test real.",
      reviewer: "You score PDSE: completeness/correctness/clarity/consistency. Critique.",
      deployer: "You prepare git commits, changelogs, publish scripts.",
    };

    const content = await this.router.generate([{ role: "user", content: subtask }], {
      system: systemPrompts[lane],
      ...options,
    });

    const pdseScore = this.heuristicPdse(content); // 0-100

    return { lane, content, pdseScore };
  }

  private computeCompositePdse(outputs: AgentOutput[]): number {
    if (outputs.length === 0) return 0;
    const avg = outputs.reduce((sum, o) => sum + o.pdseScore, 0) / outputs.length;
    // Weight reviewer higher
    const reviewer = outputs.find((o) => o.lane === "reviewer")?.pdseScore ?? avg;
    return Math.round(avg * 0.7 + reviewer * 0.3);
  }

  private refineTask(task: string, outputs: AgentOutput[]): string {
    const feedback = outputs
      .map((o) => `${o.lane}: PDSE ${o.pdseScore} - ${o.content.slice(0, 100)}...`)
      .join("\n");
    return `Refine: ${task}\nPrior feedback:\n${feedback}`;
  }

  /**
   * Heuristic PDSE scorer (core-native, no danteforge dep).
   * Completeness: length/token density
   * Correctness: keyword presence
   * Clarity: readability heuristics
   * Consistency: style markers
   */
  private heuristicPdse(content: string): number {
    if (!content) return 0;
    const len = content.length;
    const hasCode = /```[a-z]+\n/.test(content);
    const hasTests = /test|expect|vi\./.test(content);
    const hasDocs = /```|TODO|FIXME/.test(content) === false;
    const keywords = ["function", "export", "interface", "type", "await", "async"];
    const keywordDensity = keywords.filter((k) => content.includes(k)).length / keywords.length;

    let score = 50;
    score += Math.min(len / 500, 20); // completeness
    score += hasCode ? 10 : 0;
    score += hasTests ? 10 : 0;
    score += hasDocs ? 10 : 0;
    score += keywordDensity * 20;

    return Math.max(0, Math.min(100, Math.round(score)));
  }
}

/**
 * Simple semaphore for concurrency control.
 */
class Semaphore {
  private count: number;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    this.count = this.max;
  }

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      if (this.count > 0) {
        this.count--;
        resolve();
      } else {
        this.queue.push(resolve as () => void);
      }
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift()!;
      resolve();
    } else {
      this.count++;
    }
  }
}
