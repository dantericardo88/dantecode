// ============================================================================
// DanteCode VS Code Extension — Skills Tree Provider
// ============================================================================

import * as vscode from "vscode";
import { listSkills, type SkillRegistryEntry } from "@dantecode/skill-adapter";

export class SkillTreeItem extends vscode.TreeItem {
  constructor(
    public readonly skill: SkillRegistryEntry,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(skill.name, collapsibleState);

    this.tooltip = this.buildTooltip();
    this.description = this.buildDescription();
    this.contextValue = "skill";
    this.iconPath = new vscode.ThemeIcon(this.getIcon());
  }

  private buildTooltip(): string {
    const lines = [
      `${this.skill.name}`,
      "",
      `Description: ${this.skill.description || "No description"}`,
      `Import Source: ${this.skill.importSource || "unknown"}`,
    ];

    return lines.join("\n");
  }

  private buildDescription(): string {
    const parts: string[] = [];

    if (this.skill.importSource === "skillbridge") {
      parts.push("[bridge]");
    } else if (this.skill.importSource) {
      parts.push(`[${this.skill.importSource}]`);
    }

    return parts.join(" · ");
  }

  private getIcon(): string {
    // Use different icons based on import source
    if (this.skill.importSource === "skillbridge") {
      return "plug";
    }
    if (this.skill.importSource === "claude") {
      return "verified-filled";
    }

    return "tools";
  }
}

export class SkillsTreeDataProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly projectRoot: string) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (!this.projectRoot) {
      return [];
    }

    if (element) {
      // Skills have no children (flat list for now)
      return [];
    }

    try {
      const skills = await listSkills(this.projectRoot);

      // Sort by name for consistent display
      skills.sort((a, b) => a.name.localeCompare(b.name));

      return skills.map((skill) => new SkillTreeItem(skill, vscode.TreeItemCollapsibleState.None));
    } catch (error) {
      console.error("Failed to load skills:", error);
      return [];
    }
  }
}
