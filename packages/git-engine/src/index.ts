// ============================================================================
// @dantecode/git-engine — Public API
// ============================================================================

// ─── Auto-Commit System ─────────────────────────────────────────────────────

export {
  autoCommit,
  getLastCommitHash,
  revertLastCommit,
  pushBranch,
  getStatus,
} from "./commit.js";
export type { CommitResult, PushResult, StatusEntry, GitStatusResult } from "./commit.js";

// ─── Worktree Management ────────────────────────────────────────────────────

export {
  createWorktree,
  removeWorktree,
  listWorktrees,
  mergeWorktree,
  isWorktree,
} from "./worktree.js";
export type { WorktreeCreateResult, WorktreeEntry, WorktreeMergeResult } from "./worktree.js";

// ─── Diff Parsing & Review ──────────────────────────────────────────────────

export { getDiff, getStagedDiff, parseDiffHunks, applyDiff, generateColoredHunk } from "./diff.js";
export type { DiffHunk, DiffLine, ColoredDiffHunk } from "./diff.js";

// ─── Repository Map Generation ──────────────────────────────────────────────

export { generateRepoMap, formatRepoMapForContext } from "./repo-map.js";
export type { RepoMapEntry, RepoMapOptions } from "./repo-map.js";
