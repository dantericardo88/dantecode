// ============================================================================
// DanteCode VS Code Extension — Inline Verification Annotations
// Shows squiggly underlines for verification issues with code actions
// ============================================================================

import * as vscode from "vscode";
import { runAntiStubScanner, runConstitutionCheck } from "@dantecode/danteforge";
import { readFile } from "node:fs/promises";

/**
 * Verification issue types.
 */
export interface VerificationIssue {
  range: vscode.Range;
  message: string;
  severity: vscode.DiagnosticSeverity;
  code?: string;
  suggestedFix?: string;
}

/**
 * DiagnosticCollection manager for verification issues.
 */
export class VerificationAnnotationProvider {
  private diagnostics: vscode.DiagnosticCollection;
  private codeActionProvider: VerificationCodeActionProvider;
  // @ts-expect-error - Unused for now, will be used for project-wide verification
  private _projectRoot: string;

  constructor(projectRoot: string) {
    this._projectRoot = projectRoot;
    this.diagnostics = vscode.languages.createDiagnosticCollection("dantecode-verification");
    this.codeActionProvider = new VerificationCodeActionProvider();
  }

  /**
   * Analyze file and show verification annotations.
   */
  async annotateFile(uri: vscode.Uri): Promise<void> {
    if (!this.shouldAnnotate(uri)) {
      return;
    }

    try {
      const content = await readFile(uri.fsPath, "utf-8");
      const issues = await this.findIssues(content, uri.fsPath);

      const diagnostics = issues.map((issue) => {
        const diagnostic = new vscode.Diagnostic(
          issue.range,
          issue.message,
          issue.severity
        );
        diagnostic.code = issue.code;
        diagnostic.source = "DanteCode";
        return diagnostic;
      });

      this.diagnostics.set(uri, diagnostics);

      // Store fixes for code actions
      this.codeActionProvider.setFixes(uri, issues);
    } catch (error) {
      // Silently skip files that can't be analyzed
    }
  }

  /**
   * Find verification issues in content.
   */
  private async findIssues(
    content: string,
    filePath: string
  ): Promise<VerificationIssue[]> {
    const issues: VerificationIssue[] = [];

    // Run anti-stub scanner
    try {
      const stubResult = await runAntiStubScanner(content, filePath);
      const violations = (stubResult as any).hardViolations || [];
      if (Array.isArray(violations) && violations.length > 0) {
        for (const violation of violations) {
          issues.push({
            range: this.findPatternRange(content, violation.pattern || ''),
            message: `Stub detected: ${violation.pattern || 'unknown'}`,
            severity: vscode.DiagnosticSeverity.Warning,
            code: "stub-violation",
          });
        }
      }
    } catch {
      // Skip if scanner fails
    }

    // Run constitution check
    try {
      const constitutionResult = await runConstitutionCheck(content);
      if (constitutionResult && Array.isArray(constitutionResult.violations) && constitutionResult.violations.length > 0) {
        for (const violation of constitutionResult.violations) {
          const rule = (violation as any).rule || (violation as any).pattern || "unknown";
          const message = (violation as any).message || rule;
          issues.push({
            range: this.findPatternRange(content, rule),
            message: `Constitution violation: ${message}`,
            severity: vscode.DiagnosticSeverity.Error,
            code: "constitution-violation",
          });
        }
      }
    } catch {
      // Skip if check fails
    }

    return issues;
  }

  /**
   * Find range for a pattern in content (best effort).
   */
  private findPatternRange(content: string, pattern: string): vscode.Range {
    const lines = content.split("\n");

    // Try to find pattern in content
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const index = line.toLowerCase().indexOf(pattern.toLowerCase());
      if (index >= 0) {
        return new vscode.Range(
          new vscode.Position(i, index),
          new vscode.Position(i, index + pattern.length)
        );
      }
    }

    // Default to first line if not found
    return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
  }

  /**
   * Check if file should be annotated.
   */
  private shouldAnnotate(uri: vscode.Uri): boolean {
    if (uri.scheme !== "file") {
      return false;
    }

    const path = uri.fsPath;
    const ext = path.split(".").pop()?.toLowerCase() || "";

    const sourceExts = ["ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "cpp", "c", "h"];
    const excludePatterns = [
      /node_modules/,
      /\.git/,
      /dist\//,
      /build\//,
      /\.next\//,
    ];

    return (
      sourceExts.includes(ext) &&
      !excludePatterns.some((pattern) => pattern.test(path))
    );
  }

  /**
   * Clear annotations for a file.
   */
  clearFile(uri: vscode.Uri): void {
    this.diagnostics.delete(uri);
    this.codeActionProvider.clearFixes(uri);
  }

  /**
   * Clear all annotations.
   */
  clearAll(): void {
    this.diagnostics.clear();
    this.codeActionProvider.clearAllFixes();
  }

  /**
   * Dispose resources.
   */
  dispose(): void {
    this.diagnostics.dispose();
  }

  /**
   * Get code action provider for registering.
   */
  getCodeActionProvider(): VerificationCodeActionProvider {
    return this.codeActionProvider;
  }
}

/**
 * Code action provider for verification issues.
 */
class VerificationCodeActionProvider implements vscode.CodeActionProvider {
  private fixes = new Map<string, VerificationIssue[]>();

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const issues = this.fixes.get(document.uri.toString()) || [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "DanteCode") {
        continue;
      }

      // Find matching issue
      const issue = issues.find((i) => i.range.isEqual(diagnostic.range));
      if (!issue) {
        continue;
      }

      // Add fix action if available
      if (issue.suggestedFix) {
        const fix = new vscode.CodeAction(
          `Fix: ${diagnostic.message}`,
          vscode.CodeActionKind.QuickFix
        );
        fix.edit = new vscode.WorkspaceEdit();
        fix.edit.replace(document.uri, issue.range, issue.suggestedFix);
        fix.diagnostics = [diagnostic];
        actions.push(fix);
      }

      // Add ignore action
      const ignore = new vscode.CodeAction(
        "Ignore this issue",
        vscode.CodeActionKind.QuickFix
      );
      ignore.command = {
        title: "Ignore",
        command: "dantecode.ignoreVerificationIssue",
        arguments: [document.uri, issue.range],
      };
      actions.push(ignore);
    }

    return actions;
  }

  setFixes(uri: vscode.Uri, issues: VerificationIssue[]): void {
    this.fixes.set(uri.toString(), issues);
  }

  clearFixes(uri: vscode.Uri): void {
    this.fixes.delete(uri.toString());
  }

  clearAllFixes(): void {
    this.fixes.clear();
  }
}

/**
 * Register verification annotations.
 */
export function registerVerificationAnnotations(
  context: vscode.ExtensionContext,
  projectRoot: string
): VerificationAnnotationProvider {
  const provider = new VerificationAnnotationProvider(projectRoot);

  // Register code action provider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file" },
      provider.getCodeActionProvider(),
      {
        providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
      }
    )
  );

  // Annotate on file open
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      void provider.annotateFile(doc.uri);
    })
  );

  // Re-annotate on file save
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      void provider.annotateFile(doc.uri);
    })
  );

  // Clear on file close
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      provider.clearFile(doc.uri);
    })
  );

  // Command to refresh annotations
  context.subscriptions.push(
    vscode.commands.registerCommand("dantecode.refreshAnnotations", async () => {
      provider.clearAll();
      const docs = vscode.workspace.textDocuments;
      for (const doc of docs) {
        await provider.annotateFile(doc.uri);
      }
      void vscode.window.showInformationMessage("Verification annotations refreshed");
    })
  );

  // Command to ignore issue
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "dantecode.ignoreVerificationIssue",
      (uri: vscode.Uri, _range: vscode.Range) => {
        provider.clearFile(uri);
        void vscode.window.showInformationMessage("Issue ignored");
      }
    )
  );

  // Annotate currently open files
  void (async () => {
    for (const doc of vscode.workspace.textDocuments) {
      await provider.annotateFile(doc.uri);
    }
  })();

  return provider;
}
