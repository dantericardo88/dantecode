// RepoMapTreeDataProvider

import * as vscode from 'vscode';
import { generateRepoMap } from '@dantecode/git-engine';

const LANGUAGE_ICON_MAP: Record<string, string> = {
  typescript: 'symbol-method',
  javascript: 'symbol-method',
  'javascript (react)': 'symbol-method',
  'typescript (react)': 'symbol-method',
  python: 'symbol-method',
  rust: 'symbol-method',
  go: 'symbol-method',
  java: 'symbol-method',
  c: 'symbol-method',
  'c++': 'symbol-method',
  'c++ header': 'symbol-method',
  'c# (csharp)': 'symbol-method',
  ruby: 'symbol-method',
  json: 'json',
  yaml: 'symbol-namespace',
  markdown: 'markdown',
  html: 'symbol-misc',
  css: 'symbol-color',
  scss: 'symbol-color',
  shell: 'terminal',
  bash: 'terminal',
  sql: 'database',
};

function getLanguageIcon(language: string | undefined): string {
  if (!language) return 'file';
  return LANGUAGE_ICON_MAP[language.toLowerCase()] || 'file';
}

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
      const projectName = this.projectRoot.split(/[\/\\]/).pop() || 'Project';
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
      item.tooltip = `Modified: ${new Date(file.lastModified || 0).toLocaleString()}\nLanguage: ${file.language || 'unknown'}`;
      item.command = {
        command: 'vscode.open',
        title: 'Open File',
        arguments: [item.resourceUri]
      };
      item.iconPath = new vscode.ThemeIcon(getLanguageIcon(file.language));
      return item;
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
}