// ============================================================================
// DanteCode VS Code Extension — Skills Tree Provider
// ============================================================================

import * as vscode from "vscode";
import { listSkills, type SkillRegistryEntry } from "@dantecode/skill-adapter";

// Extend SkillRegistryEntry with optional test/legacy fields
type SkillEntry = SkillRegistryEntry & {
  source?: string;
  license?: string;
  id?: string;
  metadata?: Record<string, string | undefined>;
};

export class SkillTreeItem extends vscode.TreeItem {
  public readonly skill: SkillEntry;
  private readonly _src: string;

  constructor(
    skill: SkillEntry,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
  ) {
    super(skill.name ?? skill.id ?? "skill", collapsibleState);
    this.skill = skill;
    // Normalize: accept both `importSource` (runtime) and `source` (test/legacy)
    this._src = skill.importSource ?? skill.source ?? "project";

    this.tooltip = this.buildTooltip();
    this.description = this.buildDescription();
    this.contextValue = "skill";
    this.iconPath = new vscode.ThemeIcon(this.getIcon());
  }

  private buildTooltip(): string {
    const lines = [
      this.skill.name,
      "",
      `Description: ${this.skill.description || "No description"}`,
      `Source: ${this._src}`,
    ];

    if (this.skill.license) {
      lines.push(`License: ${this.skill.license}`);
    }
    const meta = this.skill.metadata;
    if (meta?.trustTier) {
      lines.push(`Trust: ${meta.trustTier}`);
    }
    if (meta?.category) {
      lines.push(`Category: ${meta.category}`);
    }

    return lines.join("\n");
  }

  private buildDescription(): string {
    const parts: string[] = [];

    const meta = this.skill.metadata;
    if (meta?.category) {
      parts.push(meta.category);
    }

    if (this._src === "skillbridge") {
      parts.push("[bridge]");
    } else if (this._src && this._src !== "project") {
      parts.push(`[${this._src}]`);
    }

    return parts.join(" · ");
  }

  private getIcon(): string {
    if (this._src === "skillbridge") {
      return "plug";
    }
    if (this._src === "claude") {
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

      return skills.map((skill) => new SkillTreeItem(skill as SkillEntry, vscode.TreeItemCollapsibleState.None));
    } catch (error) {
      console.error("Failed to load skills:", error);
      return [];
    }
  }
}
