// ============================================================================
// DanteCode VS Code Extension — File Decorations (PDSE Badges)
// Shows green/yellow/red badges in file explorer based on PDSE scores
// ============================================================================

import * as vscode from "vscode";
import { runLocalPDSEScorer } from "@dantecode/danteforge";
import { readFile } from "node:fs/promises";

/**
 * PDSE score cache entry.
 */
interface ScoreCacheEntry {
  score: number;
  timestamp: number;
}

/**
 * FileDecorationProvider that shows PDSE scores as badges in explorer.
 */
export class PDSEFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[]>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private scoreCache = new Map<string, ScoreCacheEntry>();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  async provideFileDecoration(
    uri: vscode.Uri
  ): Promise<vscode.FileDecoration | undefined> {
    // Only decorate source files
    if (!this.isSourceFile(uri)) {
      return undefined;
    }

    const score = await this.getScore(uri);
    if (score === null) {
      return undefined;
    }

    return this.createDecoration(score);
  }

  /**
   * Check if file should have PDSE decoration.
   */
  private isSourceFile(uri: vscode.Uri): boolean {
    if (uri.scheme !== "file") {
      return false;
    }

    const path = uri.fsPath;
    const ext = path.split(".").pop()?.toLowerCase() || "";

    // Source file extensions
    const sourceExts = ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "cpp", "c", "h"];

    // Exclude patterns
    const excludePatterns = [
      /node_modules/,
      /\.git/,
      /dist\//,
      /build\//,
      /\.next\//,
      /\.turbo\//,
      /coverage\//,
    ];

    return (
      sourceExts.includes(ext) &&
      !excludePatterns.some((pattern) => pattern.test(path))
    );
  }

  /**
   * Get PDSE score for file (cached or fresh).
   */
  private async getScore(uri: vscode.Uri): Promise<number | null> {
    const path = uri.fsPath;
    const cached = this.scoreCache.get(path);

    // Return cached if fresh
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.score;
    }

    // Compute fresh score
    try {
      const content = await readFile(path, "utf-8");
      const result = await runLocalPDSEScorer(content, path);

      if (result && typeof (result as any).overall === 'number') {
        const score = (result as any).overall;
        this.scoreCache.set(path, {
          score,
          timestamp: Date.now(),
        });
        return score;
      }
    } catch {
      // File read or scoring failed
      return null;
    }

    return null;
  }

  /**
   * Create decoration based on score.
   */
  private createDecoration(score: number): vscode.FileDecoration {
    if (score >= 85) {
      // Green: high quality
      return {
        badge: "✓",
        color: new vscode.ThemeColor("charts.green"),
        tooltip: `PDSE: ${score} (High Quality)`,
      };
    } else if (score >= 70) {
      // Yellow: acceptable
      return {
        badge: "~",
        color: new vscode.ThemeColor("charts.yellow"),
        tooltip: `PDSE: ${score} (Acceptable)`,
      };
    } else {
      // Red: needs improvement
      return {
        badge: "!",
        color: new vscode.ThemeColor("charts.red"),
        tooltip: `PDSE: ${score} (Needs Improvement)`,
      };
    }
  }

  /**
   * Invalidate cache for a file and refresh decoration.
   */
  invalidate(uri: vscode.Uri): void {
    this.scoreCache.delete(uri.fsPath);
    this._onDidChangeFileDecorations.fire(uri);
  }

  /**
   * Clear all cached scores and refresh all decorations.
   */
  clearCache(): void {
    this.scoreCache.clear();
    this._onDidChangeFileDecorations.fire(vscode.Uri.file(this.projectRoot));
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}

/**
 * Register PDSE file decorations.
 */
export function registerFileDecorations(
  context: vscode.ExtensionContext,
  projectRoot: string
): PDSEFileDecorationProvider {
  const provider = new PDSEFileDecorationProvider(projectRoot);

  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider(provider)
  );

  // Invalidate cache on file save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      provider.invalidate(doc.uri);
    })
  );

  // Command to refresh all decorations
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.refreshPDSEBadges", () => {
      provider.clearCache();
      void vscode.window.showInformationMessage("PDSE badges refreshed");
    })
  );

  return provider;
}
