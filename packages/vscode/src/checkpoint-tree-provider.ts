/**
 * checkpoint-tree-provider.ts
 *
 * Checkpoint Tree View Provider for VS Code sidebar.
 * Shows available checkpoints with session status and provides context menu actions.
 *
 * Wave 2 Task 2.7: VS Code Checkpoint/Resume UI
 */

import * as vscode from "vscode";
import { RecoveryManager, type StaleSession } from "@dantecode/core";

/**
 * Tree item representing a checkpoint session
 */
export class CheckpointTreeItem extends vscode.TreeItem {
  constructor(
    public readonly session: StaleSession,
    public readonly projectRoot: string,
  ) {
    super(session.sessionId.slice(0, 12), vscode.TreeItemCollapsibleState.None);

    // Set tooltip with full session info
    const timestamp = session.timestamp ? new Date(session.timestamp).toLocaleString() : "unknown";
    const eventInfo = session.lastEventId !== undefined ? `\nEvents: ${session.lastEventId}` : "";
    const stepInfo = session.step !== undefined ? `\nStep: ${session.step}` : "";
    const worktreeInfo = session.worktreeRef ? `\nWorktree: ${session.worktreeRef}` : "";

    this.tooltip = `Session: ${session.sessionId}\nStatus: ${session.status}\nTime: ${timestamp}${eventInfo}${stepInfo}${worktreeInfo}`;

    // Set icon and color based on status
    switch (session.status) {
      case "resumable":
        this.iconPath = new vscode.ThemeIcon("debug-start", new vscode.ThemeColor("charts.green"));
        this.description = `resumable • ${timestamp}`;
        break;
      case "stale":
        this.iconPath = new vscode.ThemeIcon("warning", new vscode.ThemeColor("charts.yellow"));
        this.description = `stale • ${timestamp}`;
        break;
      case "corrupt":
        this.iconPath = new vscode.ThemeIcon("error", new vscode.ThemeColor("charts.red"));
        this.description = `corrupt • ${timestamp}`;
        break;
    }

    // Context value for context menu
    this.contextValue = `checkpoint-${session.status}`;

    // Command to execute when clicked
    if (session.status === "resumable") {
      this.command = {
        command: "dantecode.resumeSession",
        title: "Resume Session",
        arguments: [session.sessionId],
      };
    }
  }
}

/**
 * Tree data provider for checkpoint list
 */
export class CheckpointTreeDataProvider implements vscode.TreeDataProvider<CheckpointTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    CheckpointTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private recoveryManager: RecoveryManager;
  private sessions: StaleSession[] = [];

  constructor(private readonly projectRoot: string) {
    this.recoveryManager = new RecoveryManager({ projectRoot });
  }

  /**
   * Refresh the checkpoint list
   */
  async refresh(): Promise<void> {
    this.sessions = await this.recoveryManager.scanStaleSessions();
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get tree item for a session
   */
  getTreeItem(element: CheckpointTreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Get children (top-level items are sessions)
   */
  async getChildren(element?: CheckpointTreeItem): Promise<CheckpointTreeItem[]> {
    if (element) {
      // No nested children
      return [];
    }

    // Refresh sessions on each getChildren call
    this.sessions = await this.recoveryManager.scanStaleSessions();

    // Return checkpoint tree items
    return this.sessions.map((session) => new CheckpointTreeItem(session, this.projectRoot));
  }

  /**
   * Get session by ID (for command handlers)
   */
  getSession(sessionId: string): StaleSession | undefined {
    return this.sessions.find(
      (s) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId),
    );
  }

  /**
   * Get checkpoint count for badge
   */
  getCheckpointCount(): number {
    return this.sessions.length;
  }

  /**
   * Get resumable checkpoint count
   */
  getResumableCount(): number {
    return this.sessions.filter((s) => s.status === "resumable").length;
  }
}
