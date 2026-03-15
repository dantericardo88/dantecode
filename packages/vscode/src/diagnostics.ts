// ============================================================================
// DanteCode VS Code Extension — PDSE Diagnostics Provider
// Maps PDSEViolation objects to VS Code Diagnostics in the Problems panel.
// Provides a clear, actionable view of quality gate violations per file.
// ============================================================================

import * as vscode from "vscode";
import type { PDSEViolation, PDSEScore } from "@dantecode/config-types";

/**
 * The diagnostic collection name used in the Problems panel header.
 */
const DIAGNOSTIC_SOURCE = "DanteCode PDSE";

/**
 * Maps PDSE violation severity to VS Code DiagnosticSeverity.
 *
 * - "hard" violations map to Error (red squiggly) because they block
 *   the quality gate and must be fixed before the code is accepted.
 * - "soft" violations map to Warning (yellow squiggly) because they
 *   are advisory and do not block the gate on their own.
 */
function mapSeverity(severity: PDSEViolation["severity"]): vscode.DiagnosticSeverity {
  switch (severity) {
    case "hard":
      return vscode.DiagnosticSeverity.Error;
    case "soft":
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

/**
 * Maps a ViolationType to a human-readable category label for the
 * diagnostic message prefix.
 */
function violationLabel(type: PDSEViolation["type"]): string {
  const labels: Record<string, string> = {
    stub_detected: "Stub Detected",
    incomplete_function: "Incomplete Function",
    missing_error_handling: "Missing Error Handling",
    type_any: "Type 'any' Usage",
    hardcoded_secret: "Hardcoded Secret",
    background_process: "Background Process",
    console_log_leftover: "Console Log Leftover",
    test_skip: "Skipped Test",
    import_unused: "Unused Import",
    dead_code: "Dead Code",
  };
  return labels[type] ?? type;
}

/**
 * PDSEDiagnosticProvider manages a VS Code DiagnosticCollection and
 * converts PDSE scan results into Problems panel entries.
 *
 * Usage:
 *   const provider = new PDSEDiagnosticProvider();
 *   context.subscriptions.push(provider);
 *   provider.updateDiagnostics(uri, score);
 */
export class PDSEDiagnosticProvider implements vscode.Disposable {
  private readonly collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  }

  /**
   * Updates the diagnostics for a single file based on a PDSE score result.
   *
   * Clears any existing diagnostics for the URI, then creates new ones
   * from each violation in the score. Violations without a line number
   * are placed at line 0 (the top of the file) so they still appear
   * in the Problems panel.
   *
   * Each diagnostic includes:
   * - The violation category as a prefix in the message
   * - The full violation message
   * - The PDSE overall score in the diagnostic code field
   * - A related information link to the DanteCode documentation
   *
   * @param uri - The document URI to attach diagnostics to.
   * @param score - The PDSE score containing violations.
   */
  updateDiagnostics(uri: vscode.Uri, score: PDSEScore): void {
    const diagnostics: vscode.Diagnostic[] = [];

    for (const violation of score.violations) {
      // Determine the range. If a line number is provided, highlight the
      // entire line. Otherwise, place the diagnostic at the document start.
      const lineNumber = violation.line !== undefined ? violation.line - 1 : 0;
      const safeLineNumber = Math.max(0, lineNumber);

      const range = new vscode.Range(
        new vscode.Position(safeLineNumber, 0),
        new vscode.Position(safeLineNumber, Number.MAX_SAFE_INTEGER),
      );

      const label = violationLabel(violation.type);
      const message = `[${label}] ${violation.message}`;

      const diagnostic = new vscode.Diagnostic(range, message, mapSeverity(violation.severity));

      diagnostic.source = DIAGNOSTIC_SOURCE;

      // Encode the overall PDSE score in the diagnostic code so users
      // can see it at a glance in the Problems panel.
      diagnostic.code = {
        value: `PDSE ${score.overall}`,
        target: vscode.Uri.parse("https://github.com/dantecode/dantecode/blob/main/docs/pdse.md"),
      };

      // If the violation includes a regex pattern, add it as related info
      if (violation.pattern) {
        diagnostic.relatedInformation = [
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(uri, range),
            `Matched pattern: ${violation.pattern}`,
          ),
        ];
      }

      // Tag hard violations as "unnecessary" so they get a strikethrough
      // in editors that support diagnostic tags.
      if (violation.severity === "hard") {
        diagnostic.tags = [];
      }

      diagnostics.push(diagnostic);
    }

    // If the gate failed but there are no individual violations (edge case),
    // add a summary diagnostic so the user knows the gate did not pass.
    if (!score.passedGate && diagnostics.length === 0) {
      const summaryDiag = new vscode.Diagnostic(
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        `PDSE quality gate failed: overall score ${score.overall} is below threshold`,
        vscode.DiagnosticSeverity.Error,
      );
      summaryDiag.source = DIAGNOSTIC_SOURCE;
      summaryDiag.code = `PDSE ${score.overall}`;
      diagnostics.push(summaryDiag);
    }

    // Add a passing summary as an information diagnostic when the gate passes
    if (score.passedGate && diagnostics.length === 0) {
      const passDiag = new vscode.Diagnostic(
        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
        `PDSE quality gate passed: overall score ${score.overall}`,
        vscode.DiagnosticSeverity.Information,
      );
      passDiag.source = DIAGNOSTIC_SOURCE;
      passDiag.code = `PDSE ${score.overall}`;
      diagnostics.push(passDiag);
    }

    this.collection.set(uri, diagnostics);
  }

  /**
   * Clears diagnostics for a specific file URI.
   *
   * @param uri - The document URI to clear diagnostics for.
   */
  clearDiagnostics(uri: vscode.Uri): void {
    this.collection.delete(uri);
  }

  /**
   * Clears all PDSE diagnostics across every file.
   */
  clearAll(): void {
    this.collection.clear();
  }

  /**
   * Disposes the diagnostic collection, releasing VS Code resources.
   */
  dispose(): void {
    this.collection.dispose();
  }
}
