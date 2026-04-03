// ============================================================================
// @dantecode/core — Multi-Agent Coordinator
// ============================================================================

import { ModelRouterImpl, type GenerateOptions } from "./model-router.js";
import type { DanteCodeState } from "@dantecode/config-types";
import { z } from "zod";

/** Callback for reporting multi-agent progress to the UI. */
export type MultiAgentProgressCallback = (update: {
  lane: string;
  status: "started" | "completed" | "failed";
  message: string;
  pdseScore?: number;
}) => void;

type SpecialistTask = { role: string; task: string };
type DelegationPlan = SpecialistTask[];

type AgentOutput = {
  role: string;
  content: string;
  pdseScore: number; // 0-100 heuristic
};

export interface MultiAgentConfig {
  maxConcurrent: number;
  defaultLane: string;
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
      defaultLane: state.agents.defaultLane || "coder",
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

    return { plan: [], outputs: [], compositePdse, iterations };
  }

  private async delegateTask(task: string): Promise<DelegationPlan> {
    const orchestratorSystem = `You are the orchestrator agent. Analyze the task and dynamically decompose it into subtasks for specialized agents. Create precise roles as needed (e.g., planner, coder, tester, reviewer).
Task: ${task}
Respond ONLY with a valid JSON array of objects: [{"role": "e.g. planner", "task": "subtask desc"}]`;

    const delegationText = await this.router.generate([{ role: "user", content: task }], {
      system: orchestratorSystem,
    });

    const planSchema = z.array(z.object({ role: z.string(), task: z.string() }));
    let parsed;
    try {
      parsed = planSchema.safeParse(JSON.parse(delegationText));
    } catch {
      parsed = { success: false };
    }
    return parsed.success && (parsed.data as DelegationPlan).length > 0
      ? (parsed.data as DelegationPlan)
      : [{ role: this.config.defaultLane, task }];
  }

  private async executeParallel(
    plan: DelegationPlan,
    options: GenerateOptions,
    onProgress?: MultiAgentProgressCallback,
  ): Promise<AgentOutput[]> {
    const outputs: AgentOutput[] = [];
    const semaphore = new Semaphore(this.config.maxConcurrent);

    await Promise.all(
      plan.map(async ({ role, task: subtask }) => {
        await semaphore.acquire();
        try {
          onProgress?.({ lane: role, status: "started", message: subtask.slice(0, 80) });
          const output = await this.executeAgent(role, subtask, options);
          onProgress?.({
            lane: role,
            status: "completed",
            message: `PDSE: ${output.pdseScore}`,
            pdseScore: output.pdseScore,
          });
          outputs.push(output);
        } catch (err) {
          onProgress?.({
            lane: role,
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
    role: string,
    subtask: string,
    options: GenerateOptions,
  ): Promise<AgentOutput> {
    const defaultSystem = `You are the ${role} agent. Perform your task with high quality and focus exactly on your assigned responsibilities.`;
    const content = await this.router.generate([{ role: "user", content: subtask }], {
      system: defaultSystem,
      ...options,
    });

    const pdseScore = this.heuristicPdse(content); // 0-100

    return { role, content, pdseScore };
  }

  private computeCompositePdse(outputs: AgentOutput[]): number {
    if (outputs.length === 0) return 0;
    const avg = outputs.reduce((sum, o) => sum + o.pdseScore, 0) / outputs.length;
    // Boost score slightly if a reviewer role was present
    const reviewer = outputs.find((o) => o.role.toLowerCase().includes("review"))?.pdseScore ?? avg;
    return Math.round(avg * 0.8 + reviewer * 0.2);
  }

  private refineTask(task: string, outputs: AgentOutput[]): string {
    const feedback = outputs
      .map((o) => `${o.role}: PDSE ${o.pdseScore} - ${o.content.slice(0, 100)}...`)
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
