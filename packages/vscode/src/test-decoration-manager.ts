import * as vscode from "vscode";

export interface TestResult {
  filePath: string;
  line: number; // 0-indexed line of the test declaration
  name: string;
  status: "pass" | "fail" | "skip";
  message?: string; // error message for failures
}

export interface TestDecorationManager {
  apply(results: TestResult[]): void;
  clear(): void;
  dispose(): void;
}

export function createTestDecorationManager(): TestDecorationManager {
  // Create decoration types using unicode circle icons (no file system needed)
  const passType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.parse(
      "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#4CAF50"/></svg>',
        ),
    ),
    gutterIconSize: "contain",
    overviewRulerColor: "rgba(76,175,80,0.8)",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  const failType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.parse(
      "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#F44336"/></svg>',
        ),
    ),
    gutterIconSize: "contain",
    overviewRulerColor: "rgba(244,67,54,0.8)",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
  });

  const skipType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.parse(
      "data:image/svg+xml;utf8," +
        encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="#9E9E9E"/></svg>',
        ),
    ),
    gutterIconSize: "contain",
  });

  function apply(results: TestResult[]): void {
    // Group by file
    const byFile = new Map<
      string,
      { pass: vscode.Range[]; fail: vscode.DecorationOptions[]; skip: vscode.Range[] }
    >();

    for (const r of results) {
      if (!byFile.has(r.filePath)) byFile.set(r.filePath, { pass: [], fail: [], skip: [] });
      const entry = byFile.get(r.filePath)!;
      const range = new vscode.Range(r.line, 0, r.line, 0);
      if (r.status === "pass") {
        entry.pass.push(range);
      } else if (r.status === "fail") {
        entry.fail.push({
          range,
          hoverMessage: new vscode.MarkdownString(
            `**FAIL** ${r.name}\n\n\`\`\`\n${r.message ?? ""}\n\`\`\``,
          ),
        });
      } else {
        entry.skip.push(range);
      }
    }

    for (const editor of vscode.window.visibleTextEditors) {
      const filePath = editor.document.uri.fsPath;
      const entry = byFile.get(filePath);
      if (!entry) continue;
      editor.setDecorations(passType, entry.pass);
      editor.setDecorations(failType, entry.fail);
      editor.setDecorations(skipType, entry.skip);
    }
  }

  function clear(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(passType, []);
      editor.setDecorations(failType, []);
      editor.setDecorations(skipType, []);
    }
  }

  function dispose(): void {
    passType.dispose();
    failType.dispose();
    skipType.dispose();
  }

  return { apply, clear, dispose };
}

/**
 * Parse vitest JSON reporter output into TestResult[].
 * Vitest JSON output: { testResults: [{ testFilePath, assertionResults: [{ title, status, location }] }] }
 */
export function parseVitestResults(jsonOutput: string): TestResult[] {
  try {
    const parsed = JSON.parse(jsonOutput) as {
      testResults?: Array<{
        testFilePath: string;
        assertionResults: Array<{
          title: string;
          status: "passed" | "failed" | "pending";
          failureMessages?: string[];
          location?: { line: number };
        }>;
      }>;
    };
    const results: TestResult[] = [];
    for (const suite of parsed.testResults ?? []) {
      for (const t of suite.assertionResults ?? []) {
        results.push({
          filePath: suite.testFilePath,
          line: Math.max(0, (t.location?.line ?? 1) - 1), // convert to 0-indexed
          name: t.title,
          status: t.status === "passed" ? "pass" : t.status === "failed" ? "fail" : "skip",
          message: t.failureMessages?.[0],
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}
