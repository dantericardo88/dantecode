// ============================================================================
// @dantecode/workspace — Public API
// ============================================================================

// ── Core Interfaces ───────────────────────────────────────────────────────────
export type { Workspace } from "./workspace.js";
export { BaseWorkspace } from "./workspace.js";

// ── Implementations ───────────────────────────────────────────────────────────
export { LocalWorkspace } from "./local-workspace.js";
export { ContainerWorkspace } from "./container-workspace.js";
export { RemoteWorkspace } from "./remote-workspace.js";

// ── Factory & Manager ─────────────────────────────────────────────────────────
export {
  WorkspaceFactory,
  createLocalWorkspace,
  createContainerWorkspace,
  createRemoteWorkspace,
} from "./workspace-factory.js";
export {
  WorkspaceManager,
  getWorkspaceManager,
  setWorkspaceManager,
  resetWorkspaceManager,
} from "./workspace-manager.js";

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  WorkspaceStatus,
  WorkspaceType,
  WorkspaceConfig,
  WorkspaceSnapshot,
  WorkspaceStats,
  WorkspaceEvent,
  WorkspaceEventType,
  WorkspaceLifecycleHooks,
  ReadFileOptions,
  WriteFileOptions,
  ListFilesOptions,
  ExecOptions,
  ExecResult,
  FileChangeType,
  FileChangeEvent,
  FileWatchCallback,
  PathInfo,
} from "./types.js";

export { WorkspaceStatusSchema, WorkspaceTypeSchema, WorkspaceEventTypeSchema } from "./types.js";
