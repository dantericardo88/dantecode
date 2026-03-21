import { createWorktree, removeWorktree } from "@dantecode/git-engine";
import type { WorktreeSpec } from "@dantecode/config-types";

export interface WorktreeInstance {
  directory: string;
  branch: string;
}

/**
 * Hook for managing isolated git worktrees for subagents.
 */
export class WorktreeHook {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  setup(taskId: string): WorktreeInstance {
    const branch = `subagent/${taskId}`;
    const spec: WorktreeSpec = {
      directory: this.projectRoot,
      sessionId: taskId,
      branch: branch,
      baseBranch: "main", // default to main
    };

    // git-engine methods are synchronous
    const result = createWorktree(spec);

    return {
      directory: result.directory,
      branch: result.branch,
    };
  }

  cleanup(taskId: string): void {
    const directory = `${this.projectRoot}/.dantecode/worktrees/${taskId}`;
    removeWorktree(directory);
  }
}
