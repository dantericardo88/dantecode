// RepoMapTreeDataProvider

import * as vscode from 'vscode';
import { generateRepoMap } from '@dantecode/git-engine';

export class RepoMapTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!element) {
      // Root: show project name
      const projectName = this.projectRoot.split(/[\/]/).pop() || 'Project';
      return [new vscode.TreeItem(projectName, vscode.TreeItemCollapsibleState.Expanded)];
    }

    // Load repo map
    const repoMap = generateRepoMap(this.projectRoot, { maxFiles: 500 });
    return repoMap.map(file => {
      const item = new vscode.TreeItem(
        vscode.Uri.file(file.path),
        vscode.TreeItemCollapsibleState.None
      );
      item.description = `${(file.size / 1024).toFixed(1)} KB`;
      item.tooltip = `Modified: ${new Date(file.mtime).toLocaleString()}\nLanguage: ${file.language || 'unknown'}`;
      item.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [item.resourceUri]
      };
      item.iconPath = new vscode.ThemeIcon(file.language ? `file-${file.language.toLowerCase()}` : 'file');
      return item;
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}