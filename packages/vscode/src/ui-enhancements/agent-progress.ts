// ============================================================================
// DanteCode VS Code Extension — Agent Progress Visualization
// Live tree view for background agents with real-time status updates
// ============================================================================

import * as vscode from "vscode";

/**
 * Agent task status.
 */
export type AgentTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/**
 * Agent task information.
 */
export interface AgentTask {
  id: string;
  name: string;
  status: AgentTaskStatus;
  progress: number; // 0-100
  parentId?: string;
  children: string[];
  startTime: number;
  endTime?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tree item for agent task.
 */
class AgentTaskItem extends vscode.TreeItem {
  constructor(
    public readonly task: AgentTask,
    private readonly allTasks: Map<string, AgentTask>
  ) {
    const hasChildren = task.children.length > 0;
    super(
      task.name,
      hasChildren
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None
    );

    this.description = this.buildDescription(task);
    this.tooltip = this.buildTooltip(task);
    this.iconPath = this.getIcon(task);
    this.contextValue = `agentTask.${task.status}`;
  }

  private buildDescription(task: AgentTask): string {
    const parts: string[] = [];

    // Status indicator
    parts.push(this.getStatusText(task.status));

    // Progress for running tasks
    if (task.status === "running" && task.progress > 0) {
      parts.push(`${task.progress}%`);
    }

    // Duration
    const duration = this.getDuration(task);
    if (duration) {
      parts.push(duration);
    }

    return parts.join(" · ");
  }

  private buildTooltip(task: AgentTask): string {
    const lines = [
      `Task: ${task.name}`,
      `Status: ${task.status}`,
      `Progress: ${task.progress}%`,
    ];

    const duration = this.getDuration(task);
    if (duration) {
      lines.push(`Duration: ${duration}`);
    }

    if (task.error) {
      lines.push(`Error: ${task.error}`);
    }

    if (task.children.length > 0) {
      lines.push(`Subtasks: ${task.children.length}`);
    }

    return lines.join("\n");
  }

  private getStatusText(status: AgentTaskStatus): string {
    switch (status) {
      case "pending":
        return "⏸ Pending";
      case "running":
        return "▶ Running";
      case "completed":
        return "✓ Completed";
      case "failed":
        return "✗ Failed";
      case "cancelled":
        return "⊘ Cancelled";
    }
  }

  private getIcon(task: AgentTask): vscode.ThemeIcon {
    switch (task.status) {
      case "pending":
        return new vscode.ThemeIcon("clock");
      case "running":
        return new vscode.ThemeIcon("loading~spin");
      case "completed":
        return new vscode.ThemeIcon("pass");
      case "failed":
        return new vscode.ThemeIcon("error");
      case "cancelled":
        return new vscode.ThemeIcon("circle-slash");
    }
  }

  private getDuration(task: AgentTask): string | null {
    const end = task.endTime || Date.now();
    const durationMs = end - task.startTime;

    if (durationMs < 1000) {
      return `${durationMs}ms`;
    } else if (durationMs < 60000) {
      return `${(durationMs / 1000).toFixed(1)}s`;
    } else {
      return `${(durationMs / 60000).toFixed(1)}min`;
    }
  }
}

/**
 * Agent progress tree data provider.
 */
export class AgentProgressProvider implements vscode.TreeDataProvider<AgentTaskItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    AgentTaskItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private tasks = new Map<string, AgentTask>();
  private refreshInterval: NodeJS.Timeout | undefined;

  constructor() {
    // Auto-refresh for running tasks (every 500ms)
    this.refreshInterval = setInterval(() => {
      const hasRunningTasks = Array.from(this.tasks.values()).some(
        (t) => t.status === "running"
      );
      if (hasRunningTasks) {
        this.refresh();
      }
    }, 500);
  }

  getTreeItem(element: AgentTaskItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: AgentTaskItem): AgentTaskItem[] {
    if (element) {
      // Return children of this task
      return element.task.children
        .map((id) => this.tasks.get(id))
        .filter((t): t is AgentTask => t !== undefined)
        .map((task) => new AgentTaskItem(task, this.tasks));
    }

    // Return root tasks (no parent)
    return Array.from(this.tasks.values())
      .filter((task) => !task.parentId)
      .sort((a, b) => b.startTime - a.startTime)
      .map((task) => new AgentTaskItem(task, this.tasks));
  }

  /**
   * Add or update a task.
   */
  updateTask(task: AgentTask): void {
    const existing = this.tasks.get(task.id);

    // Update parent's children list
    if (task.parentId) {
      const parent = this.tasks.get(task.parentId);
      if (parent && !parent.children.includes(task.id)) {
        parent.children.push(task.id);
      }
    }

    this.tasks.set(task.id, task);

    // Auto-end time for completed/failed/cancelled
    if (
      !task.endTime &&
      (task.status === "completed" || task.status === "failed" || task.status === "cancelled")
    ) {
      task.endTime = Date.now();
    }

    this.refresh();
  }

  /**
   * Update task progress.
   */
  updateProgress(taskId: string, progress: number): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.progress = Math.max(0, Math.min(100, progress));
      this.refresh();
    }
  }

  /**
   * Update task status.
   */
  updateStatus(taskId: string, status: AgentTaskStatus, error?: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.status = status;
      if (error) {
        task.error = error;
      }
      if (
        status === "completed" ||
        status === "failed" ||
        status === "cancelled"
      ) {
        task.endTime = Date.now();
      }
      this.refresh();
    }
  }

  /**
   * Remove a task.
   */
  removeTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      // Remove from parent's children
      if (task.parentId) {
        const parent = this.tasks.get(task.parentId);
        if (parent) {
          parent.children = parent.children.filter((id) => id !== taskId);
        }
      }

      // Remove children recursively
      for (const childId of task.children) {
        this.removeTask(childId);
      }

      this.tasks.delete(taskId);
      this.refresh();
    }
  }

  /**
   * Clear all completed tasks.
   */
  clearCompleted(): void {
    const completed = Array.from(this.tasks.values()).filter(
      (t) => t.status === "completed"
    );
    for (const task of completed) {
      this.removeTask(task.id);
    }
  }

  /**
   * Clear all tasks.
   */
  clearAll(): void {
    this.tasks.clear();
    this.refresh();
  }

  /**
   * Get task by ID.
   */
  getTask(taskId: string): AgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks.
   */
  getAllTasks(): AgentTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Refresh tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
  }
}

/**
 * Register agent progress view.
 */
export function registerAgentProgress(
  context: vscode.ExtensionContext
): AgentProgressProvider {
  const provider = new AgentProgressProvider();

  // Register tree view
  const treeView = vscode.window.createTreeView("dantecode.agentProgress", {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  // Command to clear completed
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.clearCompletedTasks", () => {
      provider.clearCompleted();
      void vscode.window.showInformationMessage("Completed tasks cleared");
    })
  );

  // Command to clear all
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.clearAllTasks", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Clear all agent tasks?",
        "Yes",
        "No"
      );
      if (confirm === "Yes") {
        provider.clearAll();
        void vscode.window.showInformationMessage("All tasks cleared");
      }
    })
  );

  // Command to cancel task
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.cancelAgentTask",
      (item: AgentTaskItem) => {
        provider.updateStatus(item.task.id, "cancelled");
        void vscode.window.showInformationMessage(`Task "${item.task.name}" cancelled`);
      }
    )
  );

  // Cleanup on dispose
  context.subscriptions.push({
    dispose: () => {
      provider.dispose();
    },
  });

  return provider;
}
