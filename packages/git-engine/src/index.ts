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

// ─── Event Orchestrator ─────────────────────────────────────────────────────

export { GitEventWatcher, watchGitEvents } from "./git-event-watcher.js";
export { listGitWatchers, stopGitWatcher } from "./git-event-watcher.js";
export type {
  GitEventType,
  GitWatchEvent,
  GitWatchOptions,
  GitHookWatchData,
  GitBranchWatchData,
  GitFileWatchData,
} from "./git-event-watcher.js";

export { LocalWorkflowRunner, runLocalWorkflow } from "./local-workflow-runner.js";
export type {
  WorkflowOptions,
  WorkflowResult,
  WorkflowJobResult,
  WorkflowStepResult,
  WorkflowCommandRunner,
} from "./local-workflow-runner.js";

// ─── Automated Review & Release ─────────────────────────────────────────────

export { createAutoPR } from "./auto-pr-engine.js";
export type { AutoPROptions, PRResult } from "./auto-pr-engine.js";

export { addChangeset } from "./changeset-manager.js";
export type { BumpType, ChangesetOptions, ChangesetResult } from "./changeset-manager.js";

// ─── Webhooks & Scheduling ──────────────────────────────────────────────────

export { WebhookListener } from "./webhook-handler.js";
export { listWebhookListeners, stopWebhookListener } from "./webhook-handler.js";
export type { WebhookOptions, WebhookProvider, NormalizedWebhookEvent } from "./webhook-handler.js";

export { scheduleGitTask } from "./scheduled-tasks.js";
export { listScheduledGitTasks, stopScheduledGitTask } from "./scheduled-tasks.js";
export type {
  ScheduledTask,
  ScheduledTaskContext,
  ScheduledTaskOptions,
  ScheduledTaskSnapshot,
} from "./scheduled-tasks.js";

export { GitAutomationStore, keepLatest } from "./automation-store.js";
export type {
  StoredAutomationEvent,
  StoredAutomationTrigger,
  StoredGitWatcherRecord,
  StoredWorkflowRunRecord,
  StoredWebhookListenerRecord,
  StoredScheduledTaskRun,
  StoredScheduledTaskRecord,
  StoredAutoPRRecord,
  StoredAutomationExecutionRecord,
} from "./automation-store.js";

export { GitAutomationOrchestrator } from "./automation-orchestrator.js";
export type {
  AutomationTrigger,
  WorkflowBackgroundRequest,
  AutoPullRequestRequest,
  QueuedAutomationRun,
  GitAutomationOrchestratorOptions,
} from "./automation-orchestrator.js";

// ─── Event Normalizer ────────────────────────────────────────────────────────

export { normalizeGitEvent, computeEventFingerprint, isNoiseEvent, sortByPriority } from "./event-normalizer.js";
export type {
  GitAutomationEvent,
  GitAutomationEventType,
  GitAutomationEventPriority,
  RawGitEvent,
  NoiseDetectionOptions,
} from "./event-normalizer.js";

// ─── Event Queue ─────────────────────────────────────────────────────────────

export { GitEventQueue } from "./event-queue.js";
export type { EventQueueEntry, EventQueueOptions, EventQueueStats } from "./event-queue.js";

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

export { GitEventRateLimiter } from "./rate-limiter.js";
export type {
  RateLimiterOptions,
  RateLimiterRepoStats,
  RateLimiterGlobalStats,
} from "./rate-limiter.js";

// ─── Multi-Repo Coordinator ──────────────────────────────────────────────────

export { MultiRepoCoordinator } from "./multi-repo-coordinator.js";
export type {
  RepoCoordinatorEntry,
  MultiRepoCoordinatorOptions,
  WorkflowStartResult,
} from "./multi-repo-coordinator.js";

// ─── Council Merge Helpers ───────────────────────────────────────────────────

export {
  preserveCandidate,
  attemptMerge,
  rollbackMerge,
  applyPatch as applyGitPatch,
  getMergedBranches,
  getMergeBase,
} from "./merge.js";
export type {
  MergeAttemptResult,
  CandidateSnapshot,
  MergeOptions,
} from "./merge.js";

// ─── Automation Templates ────────────────────────────────────────────────────

export { getTemplate, listTemplates, BUILT_IN_TEMPLATES } from "./automation-templates.js";
export type { AutomationDefinition, AutomationTemplate } from "./automation-templates.js";

// ─── File Pattern Watcher ─────────────────────────────────────────────────────

export { FilePatternWatcher, matchGlob } from "./file-pattern-watcher.js";
export type { FilePatternWatcherOptions, FileChangeEvent } from "./file-pattern-watcher.js";

// ─── Automation Agent Bridge ─────────────────────────────────────────────────

export { runAutomationAgent, substitutePromptVars } from "./automation-agent-bridge.js";
export type { AgentBridgeConfig, AgentBridgeResult } from "./automation-agent-bridge.js";

// ─── Council Conflict Scanner ───────────────────────────────────────────────

export {
  listConflictedFiles,
  scanFileConflicts,
  scanAllConflicts,
  diffSymbols,
  predictConflicts,
} from "./conflict-scan.js";
export type {
  ConflictHunk,
  FileConflictInfo,
  ConflictScanResult,
  SymbolDiffEntry,
} from "./conflict-scan.js";
