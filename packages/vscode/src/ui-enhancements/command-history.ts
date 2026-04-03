// ============================================================================
// DanteCode VS Code Extension — Command History Panel
// History panel with re-run buttons, persists across sessions
// ============================================================================

import * as vscode from "vscode";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Command history entry.
 */
export interface CommandHistoryEntry {
  id: string;
  command: string;
  timestamp: number;
  success: boolean;
  duration?: number;
  favorite?: boolean;
}

/**
 * Tree item for command history.
 */
class CommandHistoryItem extends vscode.TreeItem {
  constructor(
    public readonly entry: CommandHistoryEntry,
    public readonly onRerun: (command: string) => void
  ) {
    const date = new Date(entry.timestamp);
    const timeStr = date.toLocaleTimeString();

    super(entry.command, vscode.TreeItemCollapsibleState.None);

    this.description = `${timeStr}${entry.duration ? ` (${entry.duration}ms)` : ""}`;
    this.tooltip = this.buildTooltip(entry, date);
    this.iconPath = this.getIcon(entry);

    this.command = {
      title: "Re-run Command",
      command: "dantecode.rerunCommand",
      arguments: [entry.command],
    };

    this.contextValue = entry.favorite ? "commandHistory.favorite" : "commandHistory";
  }

  private buildTooltip(entry: CommandHistoryEntry, date: Date): string {
    const lines = [
      `Command: ${entry.command}`,
      `Time: ${date.toLocaleString()}`,
      `Status: ${entry.success ? "Success" : "Failed"}`,
    ];

    if (entry.duration) {
      lines.push(`Duration: ${entry.duration}ms`);
    }

    return lines.join("\n");
  }

  private getIcon(entry: CommandHistoryEntry): vscode.ThemeIcon {
    if (entry.favorite) {
      return new vscode.ThemeIcon("star-full");
    }
    return entry.success
      ? new vscode.ThemeIcon("pass")
      : new vscode.ThemeIcon("error");
  }
}

/**
 * Command history tree data provider.
 */
export class CommandHistoryProvider
  implements vscode.TreeDataProvider<CommandHistoryItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    CommandHistoryItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private history: CommandHistoryEntry[] = [];
  private historyPath: string;
  private maxEntries = 100;
  private onRerunCommand: (command: string) => void;

  constructor(storageUri: vscode.Uri, onRerunCommand: (command: string) => void) {
    this.historyPath = join(storageUri.fsPath, "command-history.json");
    this.onRerunCommand = onRerunCommand;
    void this.loadHistory();
  }

  getTreeItem(element: CommandHistoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CommandHistoryItem): CommandHistoryItem[] {
    if (element) {
      return [];
    }

    // Sort: favorites first, then by timestamp (newest first)
    const sorted = [...this.history].sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return b.timestamp - a.timestamp;
    });

    return sorted.map((entry) => new CommandHistoryItem(entry, this.onRerunCommand));
  }

  /**
   * Add command to history.
   */
  async addCommand(
    command: string,
    success: boolean,
    duration?: number
  ): Promise<void> {
    const entry: CommandHistoryEntry = {
      id: `cmd-${Date.now()}-${Math.random()}`,
      command,
      timestamp: Date.now(),
      success,
      duration,
    };

    this.history.unshift(entry);

    // Trim to max entries
    if (this.history.length > this.maxEntries) {
      this.history = this.history.slice(0, this.maxEntries);
    }

    await this.saveHistory();
    this.refresh();
  }

  /**
   * Toggle favorite status.
   */
  async toggleFavorite(id: string): Promise<void> {
    const entry = this.history.find((e) => e.id === id);
    if (entry) {
      entry.favorite = !entry.favorite;
      await this.saveHistory();
      this.refresh();
    }
  }

  /**
   * Remove entry from history.
   */
  async removeEntry(id: string): Promise<void> {
    this.history = this.history.filter((e) => e.id !== id);
    await this.saveHistory();
    this.refresh();
  }

  /**
   * Clear all non-favorite history.
   */
  async clearHistory(): Promise<void> {
    this.history = this.history.filter((e) => e.favorite);
    await this.saveHistory();
    this.refresh();
  }

  /**
   * Get command by ID.
   */
  getEntry(id: string): CommandHistoryEntry | undefined {
    return this.history.find((e) => e.id === id);
  }

  /**
   * Load history from storage.
   */
  private async loadHistory(): Promise<void> {
    try {
      const content = await readFile(this.historyPath, "utf-8");
      this.history = JSON.parse(content);
    } catch {
      // No history file yet
      this.history = [];
    }
    this.refresh();
  }

  /**
   * Save history to storage.
   */
  private async saveHistory(): Promise<void> {
    try {
      await writeFile(this.historyPath, JSON.stringify(this.history, null, 2), "utf-8");
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Refresh tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /**
   * Export history as JSON.
   */
  async exportHistory(): Promise<void> {
    const json = JSON.stringify(this.history, null, 2);
    const doc = await vscode.workspace.openTextDocument({
      content: json,
      language: "json",
    });
    await vscode.window.showTextDocument(doc);
  }

  /**
   * Get command statistics.
   */
  getStats(): {
    total: number;
    successful: number;
    failed: number;
    favorites: number;
    avgDuration: number;
  } {
    const total = this.history.length;
    const successful = this.history.filter((e) => e.success).length;
    const failed = total - successful;
    const favorites = this.history.filter((e) => e.favorite).length;

    const durationsWithValues = this.history
      .filter((e) => e.duration !== undefined)
      .map((e) => e.duration!);

    const avgDuration =
      durationsWithValues.length > 0
        ? durationsWithValues.reduce((a, b) => a + b, 0) / durationsWithValues.length
        : 0;

    return { total, successful, failed, favorites, avgDuration };
  }
}

/**
 * Register command history panel.
 */
export function registerCommandHistory(
  context: vscode.ExtensionContext,
  onRerunCommand: (command: string) => void
): CommandHistoryProvider {
  if (!context.storageUri) {
    throw new Error("Storage URI not available");
  }

  const provider = new CommandHistoryProvider(context.storageUri, onRerunCommand);

  // Register tree view
  const treeView = vscode.window.createTreeView("dantecode.commandHistory", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // Command to re-run
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.rerunCommand", (command: string) => {
      onRerunCommand(command);
    })
  );

  // Command to toggle favorite
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.toggleCommandFavorite",
      async (item: CommandHistoryItem) => {
        await provider.toggleFavorite(item.entry.id);
      }
    )
  );

  // Command to remove entry
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.removeCommandHistoryEntry",
      async (item: CommandHistoryItem) => {
        await provider.removeEntry(item.entry.id);
        void vscode.window.showInformationMessage("Command removed from history");
      }
    )
  );

  // Command to clear history
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.clearCommandHistory", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Clear all command history (favorites will be preserved)?",
        "Yes",
        "No"
      );
      if (confirm === "Yes") {
        await provider.clearHistory();
        void vscode.window.showInformationMessage("Command history cleared");
      }
    })
  );

  // Command to export history
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.exportCommandHistory", async () => {
      await provider.exportHistory();
    })
  );

  // Command to show stats
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.showCommandHistoryStats", async () => {
      const stats = provider.getStats();
      const message = [
        `Command History Statistics`,
        ``,
        `Total Commands: ${stats.total}`,
        `Successful: ${stats.successful}`,
        `Failed: ${stats.failed}`,
        `Favorites: ${stats.favorites}`,
        `Avg Duration: ${stats.avgDuration.toFixed(0)}ms`,
      ].join("\n");

      await vscode.window.showInformationMessage(message);
    })
  );

  return provider;
}
