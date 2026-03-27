import type { EvidenceBundle } from "@dantecode/runtime-spine";
import { ResearchPipeline } from "@dantecode/web-research";
import { SubAgentSpawner } from "../subagent-spawner.js";
import { WaveTreeManager } from "../hierarchy/tree-manager.js";
import { WorktreeHook } from "../isolation/worktree-hook.js";

export interface OrchestratorOptions {
  projectRoot: string;
  /**
   * Optional agent runner for real task execution.
   * When absent, executeSubTask returns a structured stub string (test/preview mode).
   */
  agentRunner?: (role: string, objective: string, projectRoot: string) => Promise<string>;
}

/**
 * Main Uplift Orchestrator.
 * Coordinates Research and Subagent execution.
 *
 * Uses the real ResearchPipeline (DDG + BM25 + cache + dedup).
 */
export class UpliftOrchestrator {
  private spawner = new SubAgentSpawner();
  private tree = new WaveTreeManager();
  private worktreeHook: WorktreeHook;
  private researchPipeline: ResearchPipeline;
  private options: OrchestratorOptions;

  constructor(options: OrchestratorOptions) {
    this.options = options;
    this.worktreeHook = new WorktreeHook(options.projectRoot);
    this.researchPipeline = new ResearchPipeline({
      projectRoot: options.projectRoot,
      maxResults: 10,
      fetchTopN: 3,
    });
  }

  async runResearchTask(objective: string): Promise<EvidenceBundle> {
    const result = await this.researchPipeline.run(objective);
    return result.evidenceBundle;
  }

  async executeSubTask(parentTaskId: string, role: string, objective: string): Promise<string> {
    const instance = this.spawner.spawn(role, objective);
    this.tree.addNode(instance.id, parentTaskId);

    const worktree = this.worktreeHook.setup(instance.id);

    try {
      this.spawner.updateStatus(instance.id, "running");

      if (!this.options.agentRunner) {
        throw new Error(`No agent runner configured for role: ${role}`);
      }

      const result = await this.options.agentRunner(role, objective, worktree.directory);

      this.spawner.updateStatus(instance.id, "completed");
      return result;
    } catch (err: unknown) {
      this.spawner.updateStatus(instance.id, "failed");
      // Re-throw configuration errors instead of catching them
      if (err instanceof Error && err.message.includes("No agent runner configured")) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      return `Task ${instance.id} failed: ${msg}`;
    } finally {
      this.worktreeHook.cleanup(instance.id);
    }
  }

  listSubAgents() {
    return this.spawner.listInstances();
  }
}
