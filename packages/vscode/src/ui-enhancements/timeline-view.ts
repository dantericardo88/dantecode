// ============================================================================
// DanteCode VS Code Extension — Session Timeline View
// Visual timeline of checkpoints with graph of session evolution
// ============================================================================

import * as vscode from "vscode";
import { join } from "node:path";
import { readFile, readdir } from "node:fs/promises";

/**
 * Checkpoint entry from checkpoint store.
 */
interface CheckpointEntry {
  id: string;
  timestamp: number;
  type: "manual" | "periodic" | "pre-tool" | "recovery";
  messageCount: number;
  toolCalls: number;
  description?: string;
}

/**
 * Timeline item for a checkpoint.
 */
class TimelineCheckpointItem extends vscode.TreeItem {
  constructor(
    public readonly checkpoint: CheckpointEntry,
    public readonly onRestore: (id: string) => void
  ) {
    const date = new Date(checkpoint.timestamp);
    const timeStr = date.toLocaleTimeString();
    const dateStr = date.toLocaleDateString();

    super(`${timeStr} - ${checkpoint.type}`, vscode.TreeItemCollapsibleState.None);

    this.description = checkpoint.description || `${checkpoint.messageCount} messages`;
    this.tooltip = `${dateStr} ${timeStr}\nType: ${checkpoint.type}\nMessages: ${checkpoint.messageCount}\nTools: ${checkpoint.toolCalls}`;
    this.iconPath = this.getIconForType(checkpoint.type);

    this.command = {
      title: "View Checkpoint",
      command: "dantecode.viewCheckpoint",
      arguments: [checkpoint.id],
    };

    this.contextValue = "checkpoint";
  }

  private getIconForType(type: string): vscode.ThemeIcon {
    switch (type) {
      case "manual":
        return new vscode.ThemeIcon("bookmark");
      case "periodic":
        return new vscode.ThemeIcon("clock");
      case "pre-tool":
        return new vscode.ThemeIcon("wrench");
      case "recovery":
        return new vscode.ThemeIcon("history");
      default:
        return new vscode.ThemeIcon("circle-outline");
    }
  }
}

/**
 * Timeline tree data provider.
 */
export class TimelineViewProvider implements vscode.TreeDataProvider<TimelineCheckpointItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    TimelineCheckpointItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private checkpoints: CheckpointEntry[] = [];
  private checkpointDir: string;
  private onRestoreCheckpoint: (id: string) => void;

  constructor(projectRoot: string, onRestoreCheckpoint: (id: string) => void) {
    this.checkpointDir = join(projectRoot, ".dantecode", "checkpoints");
    this.onRestoreCheckpoint = onRestoreCheckpoint;
    void this.loadCheckpoints();
  }

  getTreeItem(element: TimelineCheckpointItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TimelineCheckpointItem): TimelineCheckpointItem[] {
    if (element) {
      return [];
    }

    // Sort by timestamp (newest first)
    const sorted = [...this.checkpoints].sort((a, b) => b.timestamp - a.timestamp);

    return sorted.map(
      (checkpoint) => new TimelineCheckpointItem(checkpoint, this.onRestoreCheckpoint)
    );
  }

  /**
   * Load checkpoints from disk.
   */
  private async loadCheckpoints(): Promise<void> {
    try {
      const files = await readdir(this.checkpointDir);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));

      this.checkpoints = [];
      for (const file of jsonFiles) {
        try {
          const path = join(this.checkpointDir, file);
          const content = await readFile(path, "utf-8");
          const data = JSON.parse(content);

          // Extract checkpoint info
          this.checkpoints.push({
            id: file.replace(".json", ""),
            timestamp: data.timestamp || Date.now(),
            type: data.type || "manual",
            messageCount: data.messages?.length || 0,
            toolCalls: this.countToolCalls(data.messages || []),
            description: data.description,
          });
        } catch {
          // Skip invalid checkpoint files
        }
      }
    } catch {
      // Checkpoint directory doesn't exist yet
      this.checkpoints = [];
    }

    this.refresh();
  }

  /**
   * Count tool calls in messages.
   */
  private countToolCalls(messages: Array<{ role: string; content: unknown }>): number {
    let count = 0;
    for (const msg of messages) {
      if (msg.role === "assistant" && typeof msg.content === "string") {
        // Simple heuristic: count tool_call blocks
        const matches = msg.content.match(/<tool_call>/g);
        count += matches?.length || 0;
      }
    }
    return count;
  }

  /**
   * Refresh timeline view.
   */
  async refresh(): Promise<void> {
    await this.loadCheckpoints();
    this._onDidChangeTreeData.fire();
  }

  /**
   * Get checkpoint by ID.
   */
  getCheckpoint(id: string): CheckpointEntry | undefined {
    return this.checkpoints.find((c) => c.id === id);
  }

  /**
   * Export timeline as JSON.
   */
  async exportTimeline(): Promise<void> {
    const json = JSON.stringify(this.checkpoints, null, 2);
    const doc = await vscode.workspace.openTextDocument({
      content: json,
      language: "json",
    });
    await vscode.window.showTextDocument(doc);
  }

  /**
   * Generate visual timeline graph (ASCII art).
   */
  generateGraph(): string {
    if (this.checkpoints.length === 0) {
      return "No checkpoints yet";
    }

    const sorted = [...this.checkpoints].sort((a, b) => a.timestamp - b.timestamp);
    const lines: string[] = [];

    lines.push("Session Timeline");
    lines.push("================");
    lines.push("");

    for (let i = 0; i < sorted.length; i++) {
      const checkpoint = sorted[i];
      if (!checkpoint) continue;

      const date = new Date(checkpoint.timestamp);
      const timeStr = date.toLocaleTimeString();

      const icon = this.getAsciiIcon(checkpoint.type);
      const connector = i === sorted.length - 1 ? "└─" : "├─";

      lines.push(`${connector} ${icon} ${timeStr} (${checkpoint.type})`);
      lines.push(`   ${checkpoint.messageCount} messages, ${checkpoint.toolCalls} tools`);

      if (i < sorted.length - 1) {
        lines.push("│");
      }
    }

    return lines.join("\n");
  }

  private getAsciiIcon(type: string): string {
    switch (type) {
      case "manual":
        return "📌";
      case "periodic":
        return "⏰";
      case "pre-tool":
        return "🔧";
      case "recovery":
        return "🔄";
      default:
        return "●";
    }
  }
}

/**
 * Register timeline view.
 */
export function registerTimelineView(
  context: vscode.ExtensionContext,
  projectRoot: string,
  onRestoreCheckpoint: (id: string) => void
): TimelineViewProvider {
  const provider = new TimelineViewProvider(projectRoot, onRestoreCheckpoint);

  // Register tree view
  const treeView = vscode.window.createTreeView("dantecode.timeline", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // Command to view checkpoint details
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.viewCheckpoint", async (id: string) => {
      const checkpoint = provider.getCheckpoint(id);
      if (!checkpoint) {
        void vscode.window.showErrorMessage("Checkpoint not found");
        return;
      }

      const date = new Date(checkpoint.timestamp);
      const details = [
        `Checkpoint: ${id}`,
        ``,
        `Time: ${date.toLocaleString()}`,
        `Type: ${checkpoint.type}`,
        `Messages: ${checkpoint.messageCount}`,
        `Tool Calls: ${checkpoint.toolCalls}`,
        ``,
        `Description: ${checkpoint.description || "None"}`,
      ].join("\n");

      const action = await vscode.window.showInformationMessage(
        details,
        "Restore",
        "Cancel"
      );

      if (action === "Restore") {
        onRestoreCheckpoint(id);
      }
    })
  );

  // Command to refresh timeline
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.refreshTimeline", async () => {
      await provider.refresh();
      void vscode.window.showInformationMessage("Timeline refreshed");
    })
  );

  // Command to export timeline
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.exportTimeline", async () => {
      await provider.exportTimeline();
    })
  );

  // Command to show timeline graph
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.showTimelineGraph", async () => {
      const graph = provider.generateGraph();
      const doc = await vscode.workspace.openTextDocument({
        content: graph,
        language: "plaintext",
      });
      await vscode.window.showTextDocument(doc);
    })
  );

  return provider;
}
