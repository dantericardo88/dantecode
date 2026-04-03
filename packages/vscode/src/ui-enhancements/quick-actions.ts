// ============================================================================
// DanteCode VS Code Extension — Quick Actions Sidebar
// One-click access to most-used commands with customizable favorites
// ============================================================================

import * as vscode from "vscode";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Quick action definition.
 */
export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  command: string;
  description?: string;
  favorite?: boolean;
}

/**
 * Default quick actions (top 10 most-used commands).
 */
const DEFAULT_ACTIONS: QuickAction[] = [
  {
    id: "magic",
    label: "Magic Mode",
    icon: "sparkle",
    command: "/magic",
    description: "Balanced autoforge with checkpoints",
  },
  {
    id: "plan",
    label: "Generate Plan",
    icon: "list-tree",
    command: "/plan",
    description: "Create implementation plan",
  },
  {
    id: "commit",
    label: "Create Commit",
    icon: "git-commit",
    command: "/commit",
    description: "Generate commit with message",
  },
  {
    id: "pdse",
    label: "Check Quality",
    icon: "verified",
    command: "/pdse",
    description: "Run PDSE quality check",
  },
  {
    id: "diff",
    label: "Show Diff",
    icon: "diff",
    command: "/diff",
    description: "Visual diff viewer",
  },
  {
    id: "search",
    label: "Semantic Search",
    icon: "search",
    command: "/search",
    description: "Search codebase semantically",
  },
  {
    id: "verify",
    label: "Verify Output",
    icon: "check",
    command: "/verify-output",
    description: "Run verification checks",
  },
  {
    id: "bg",
    label: "Background Agent",
    icon: "run-all",
    command: "/bg",
    description: "Start background task",
  },
  {
    id: "memory",
    label: "Memory Browser",
    icon: "database",
    command: "/memory list",
    description: "Browse session memory",
  },
  {
    id: "help",
    label: "Help",
    icon: "question",
    command: "/help",
    description: "Show all commands",
  },
];

/**
 * Quick actions tree item.
 */
class QuickActionItem extends vscode.TreeItem {
  constructor(
    public readonly action: QuickAction,
    public readonly onExecute: (command: string) => void
  ) {
    super(action.label, vscode.TreeItemCollapsibleState.None);

    this.description = action.description;
    this.iconPath = new vscode.ThemeIcon(action.icon);
    this.command = {
      title: "Execute",
      command: "dantecode.executeQuickAction",
      arguments: [action.command],
    };

    // Contextual menu for favorites
    this.contextValue = action.favorite ? "quickAction.favorite" : "quickAction";
  }
}

/**
 * Quick actions tree data provider.
 */
export class QuickActionsProvider implements vscode.TreeDataProvider<QuickActionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    QuickActionItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private actions: QuickAction[] = [];
  private configPath: string;
  private onExecuteCommand: (command: string) => void;

  constructor(storageUri: vscode.Uri, onExecuteCommand: (command: string) => void) {
    this.configPath = join(storageUri.fsPath, "quick-actions.json");
    this.onExecuteCommand = onExecuteCommand;
    void this.loadActions();
  }

  getTreeItem(element: QuickActionItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: QuickActionItem): QuickActionItem[] {
    if (element) {
      return [];
    }

    // Sort: favorites first, then by label
    const sorted = [...this.actions].sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return a.label.localeCompare(b.label);
    });

    return sorted.map((action) => new QuickActionItem(action, this.onExecuteCommand));
  }

  /**
   * Load actions from storage.
   */
  private async loadActions(): Promise<void> {
    try {
      const content = await readFile(this.configPath, "utf-8");
      this.actions = JSON.parse(content);
    } catch {
      // Use defaults if config doesn't exist
      this.actions = [...DEFAULT_ACTIONS];
      await this.saveActions();
    }
    this.refresh();
  }

  /**
   * Save actions to storage.
   */
  private async saveActions(): Promise<void> {
    try {
      await writeFile(this.configPath, JSON.stringify(this.actions, null, 2), "utf-8");
    } catch {
      // Ignore save errors
    }
  }

  /**
   * Add action to favorites.
   */
  async addFavorite(actionId: string): Promise<void> {
    const action = this.actions.find((a) => a.id === actionId);
    if (action) {
      action.favorite = true;
      await this.saveActions();
      this.refresh();
    }
  }

  /**
   * Remove action from favorites.
   */
  async removeFavorite(actionId: string): Promise<void> {
    const action = this.actions.find((a) => a.id === actionId);
    if (action) {
      action.favorite = false;
      await this.saveActions();
      this.refresh();
    }
  }

  /**
   * Add custom action.
   */
  async addCustomAction(action: Omit<QuickAction, "id">): Promise<void> {
    const id = `custom-${Date.now()}`;
    this.actions.push({ ...action, id });
    await this.saveActions();
    this.refresh();
  }

  /**
   * Remove custom action.
   */
  async removeAction(actionId: string): Promise<void> {
    this.actions = this.actions.filter((a) => a.id !== actionId);
    await this.saveActions();
    this.refresh();
  }

  /**
   * Reset to defaults.
   */
  async resetToDefaults(): Promise<void> {
    this.actions = [...DEFAULT_ACTIONS];
    await this.saveActions();
    this.refresh();
  }

  /**
   * Refresh tree view.
   */
  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}

/**
 * Register quick actions panel.
 */
export function registerQuickActions(
  context: vscode.ExtensionContext,
  onExecuteCommand: (command: string) => void
): QuickActionsProvider {
  // Ensure storage exists
  if (!context.storageUri) {
    throw new Error("Storage URI not available");
  }

  const provider = new QuickActionsProvider(context.storageUri, onExecuteCommand);

  // Register tree view
  const treeView = vscode.window.createTreeView("dantecode.quickActions", {
    treeDataProvider: provider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // Command to execute quick action
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.executeQuickAction",
      (command: string) => {
        onExecuteCommand(command);
      }
    )
  );

  // Command to add favorite
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.addQuickActionFavorite",
      async (item: QuickActionItem) => {
        await provider.addFavorite(item.action.id);
        void vscode.window.showInformationMessage(`Added "${item.action.label}" to favorites`);
      }
    )
  );

  // Command to remove favorite
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.removeQuickActionFavorite",
      async (item: QuickActionItem) => {
        await provider.removeFavorite(item.action.id);
        void vscode.window.showInformationMessage(
          `Removed "${item.action.label}" from favorites`
        );
      }
    )
  );

  // Command to add custom action
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.addCustomQuickAction", async () => {
      const label = await vscode.window.showInputBox({
        prompt: "Action label",
        placeHolder: "My Custom Action",
      });
      if (!label) return;

      const command = await vscode.window.showInputBox({
        prompt: "Command to execute",
        placeHolder: "/my-command arg1 arg2",
      });
      if (!command) return;

      const description = await vscode.window.showInputBox({
        prompt: "Description (optional)",
        placeHolder: "What does this action do?",
      });

      await provider.addCustomAction({
        label,
        command,
        icon: "symbol-misc",
        description,
      });

      void vscode.window.showInformationMessage(`Added custom action "${label}"`);
    })
  );

  // Command to reset to defaults
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.resetQuickActions", async () => {
      const confirm = await vscode.window.showWarningMessage(
        "Reset quick actions to defaults?",
        "Yes",
        "No"
      );
      if (confirm === "Yes") {
        await provider.resetToDefaults();
        void vscode.window.showInformationMessage("Quick actions reset to defaults");
      }
    })
  );

  return provider;
}
