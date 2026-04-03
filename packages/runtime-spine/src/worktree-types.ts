// ============================================================================
// @dantecode/runtime-spine — Worktree Types (Shared)
// Extracted from git-engine to break circular dependency with core
// ============================================================================

export interface WorktreeCreateResult {
  directory: string;
  branch: string;
}

export interface WorktreeMergeResult {
  merged: boolean;
  worktreeBranch: string;
  targetBranch: string;
  mergeCommitHash: string;
  worktreeClean: boolean;
  mainBranchClean: boolean;
}

export interface WorktreeEntry {
  path: string;
  branch: string;
  commit: string;
}

export interface WorktreeHooks {
  createWorktree: (spec: {
    directory: string;
    sessionId: string;
    branch: string;
    baseBranch: string;
  }) => WorktreeCreateResult;
  removeWorktree: (directory: string) => void;
  mergeWorktree: (
    directory: string,
    targetBranch: string,
    projectRoot: string,
  ) => WorktreeMergeResult;
}
