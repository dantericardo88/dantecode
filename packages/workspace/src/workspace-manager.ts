// ============================================================================
// @dantecode/workspace — Workspace Manager
// ============================================================================

import type { Workspace } from "./workspace.js";
import { WorkspaceFactory } from "./workspace-factory.js";
import type { WorkspaceConfig, WorkspaceSnapshot, WorkspaceStats } from "./types.js";

/**
 * Global workspace manager for tracking and managing workspace lifecycle.
 * Provides centralized workspace registry and cleanup.
 */
export class WorkspaceManager {
  private _workspaces: Map<string, Workspace> = new Map();
  private _snapshots: Map<string, WorkspaceSnapshot> = new Map();

  /**
   * Create and register a new workspace.
   */
  async create(config: WorkspaceConfig): Promise<Workspace> {
    if (this._workspaces.has(config.id)) {
      throw new Error(`Workspace already exists: ${config.id}`);
    }

    const workspace = WorkspaceFactory.create(config);
    await workspace.initialize();

    this._workspaces.set(config.id, workspace);
    return workspace;
  }

  /**
   * Get an existing workspace by ID.
   */
  get(id: string): Workspace | undefined {
    return this._workspaces.get(id);
  }

  /**
   * Check if a workspace exists.
   */
  has(id: string): boolean {
    return this._workspaces.has(id);
  }

  /**
   * List all workspace IDs.
   */
  list(): string[] {
    return Array.from(this._workspaces.keys());
  }

  /**
   * Get all workspace statistics.
   */
  async getStats(): Promise<Map<string, WorkspaceStats>> {
    const stats = new Map<string, WorkspaceStats>();

    for (const [id, workspace] of this._workspaces) {
      const workspaceStats = await workspace.getStats();
      stats.set(id, workspaceStats);
    }

    return stats;
  }

  /**
   * Suspend a workspace and save its snapshot.
   */
  async suspend(id: string): Promise<WorkspaceSnapshot> {
    const workspace = this._workspaces.get(id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }

    const snapshot = await workspace.suspend();
    this._snapshots.set(snapshot.id, snapshot);

    return snapshot;
  }

  /**
   * Resume a workspace from a snapshot.
   */
  async resume(snapshotId: string): Promise<Workspace> {
    const snapshot = this._snapshots.get(snapshotId);
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    let workspace = this._workspaces.get(snapshot.workspaceId);

    if (!workspace) {
      // Recreate workspace from snapshot metadata
      const config: WorkspaceConfig = {
        id: snapshot.workspaceId,
        type: snapshot.type,
        basePath: snapshot.cwd,
        env: snapshot.env,
        metadata: snapshot.metadata,
      };

      workspace = WorkspaceFactory.create(config);
      this._workspaces.set(workspace.id, workspace);
    }

    await workspace.resume(snapshot);
    return workspace;
  }

  /**
   * Get a snapshot by ID.
   */
  getSnapshot(snapshotId: string): WorkspaceSnapshot | undefined {
    return this._snapshots.get(snapshotId);
  }

  /**
   * List all snapshot IDs.
   */
  listSnapshots(): string[] {
    return Array.from(this._snapshots.keys());
  }

  /**
   * Delete a snapshot.
   */
  deleteSnapshot(snapshotId: string): boolean {
    return this._snapshots.delete(snapshotId);
  }

  /**
   * Destroy a workspace and clean up resources.
   */
  async destroy(id: string): Promise<void> {
    const workspace = this._workspaces.get(id);
    if (!workspace) {
      throw new Error(`Workspace not found: ${id}`);
    }

    await workspace.destroy();
    this._workspaces.delete(id);
  }

  /**
   * Destroy all workspaces and clean up resources.
   */
  async destroyAll(): Promise<void> {
    const destroyPromises: Promise<void>[] = [];

    for (const workspace of this._workspaces.values()) {
      destroyPromises.push(workspace.destroy());
    }

    await Promise.all(destroyPromises);
    this._workspaces.clear();
  }

  /**
   * Clean up stale workspaces (destroyed or errored).
   */
  async cleanup(): Promise<number> {
    const toRemove: string[] = [];

    for (const [id, workspace] of this._workspaces) {
      const status = workspace.getStatus();
      if (status === "destroyed" || status === "error") {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      this._workspaces.delete(id);
    }

    return toRemove.length;
  }

  /**
   * Get total number of workspaces.
   */
  get size(): number {
    return this._workspaces.size;
  }

  /**
   * Clear all workspaces without destroying (use with caution).
   */
  clear(): void {
    this._workspaces.clear();
  }
}

// Global workspace manager instance
let _globalManager: WorkspaceManager | undefined;

/**
 * Get the global workspace manager instance.
 * Creates one if it doesn't exist.
 */
export function getWorkspaceManager(): WorkspaceManager {
  if (!_globalManager) {
    _globalManager = new WorkspaceManager();
  }
  return _globalManager;
}

/**
 * Set a custom global workspace manager.
 */
export function setWorkspaceManager(manager: WorkspaceManager): void {
  _globalManager = manager;
}

/**
 * Reset the global workspace manager (useful for tests).
 */
export function resetWorkspaceManager(): void {
  _globalManager = undefined;
}
