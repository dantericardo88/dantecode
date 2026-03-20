import type {
  EvidenceBundle,
} from "@dantecode/runtime-spine";
import { ResearchPipeline } from "@dantecode/web-research";
import { SubAgentSpawner } from "../subagent-spawner.js";
import { WaveTreeManager } from "../hierarchy/tree-manager.js";
import { WorktreeHook } from "../isolation/worktree-hook.js";

export interface OrchestratorOptions {
  projectRoot: string;
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

  constructor(options: OrchestratorOptions) {
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
      return `Task ${instance.id} completed in ${worktree.directory}`;
    } finally {
      this.spawner.updateStatus(instance.id, "completed");
      this.worktreeHook.cleanup(instance.id);
    }
  }

  listSubAgents() {
    return this.spawner.listInstances();
  }
}
