// Version check command for DanteCode
// Shows version, build time, and verifies updates worked

import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { stat } from "node:fs/promises";

interface VersionInfo {
  version: string;
  buildTime: string;
  buildAge: string;
  extensionPath: string;
  fixes: string[];
}

export async function showVersionInfo(context: vscode.ExtensionContext): Promise<void> {
  try {
    // Get package.json version
    const pkgPath = join(context.extensionPath, "package.json");
    const pkgContent = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(pkgContent);

    // Get build time from extension.js
    const distPath = join(context.extensionPath, "dist", "extension.js");
    const stats = await stat(distPath);
    const buildTime = stats.mtime;

    // Calculate age
    const ageMs = Date.now() - buildTime.getTime();
    const ageMinutes = Math.floor(ageMs / 1000 / 60);
    const ageHours = Math.floor(ageMinutes / 60);
    const ageDays = Math.floor(ageHours / 24);

    let buildAge: string;
    if (ageDays > 0) {
      buildAge = `${ageDays} day${ageDays !== 1 ? 's' : ''} ago`;
    } else if (ageHours > 0) {
      buildAge = `${ageHours} hour${ageHours !== 1 ? 's' : ''} ago`;
    } else if (ageMinutes > 0) {
      buildAge = `${ageMinutes} minute${ageMinutes !== 1 ? 's' : ''} ago`;
    } else {
      buildAge = 'just now';
    }

    // List of fixes included
    const fixes = [
      "✅ cd command support (isRepoInternalCdChain fix)",
      "✅ Detailed parse error diagnostics",
      "✅ Anti-confabulation grace period",
      "✅ Command translation suggestions"
    ];

    const info: VersionInfo = {
      version: pkg.version,
      buildTime: buildTime.toLocaleString(),
      buildAge,
      extensionPath: context.extensionPath,
      fixes
    };

    // Create message
    const message = `
**DanteCode Version Info**

📦 **Version:** ${info.version}
🕐 **Built:** ${info.buildTime}
⏱️  **Age:** ${info.buildAge}
📁 **Path:** ${info.extensionPath}

**Fixes Included:**
${info.fixes.join('\n')}

${ageMinutes < 10 ? '✅ **Recently updated!**' : ''}
    `.trim();

    // Show in dialog
    const action = await vscode.window.showInformationMessage(
      `DanteCode ${info.version} (built ${info.buildAge})`,
      {
        modal: false,
        detail: message
      },
      "Copy Info",
      "View Extension Folder"
    );

    if (action === "Copy Info") {
      await vscode.env.clipboard.writeText(message);
      vscode.window.showInformationMessage("Version info copied to clipboard!");
    } else if (action === "View Extension Folder") {
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(distPath));
    }

  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to get version info: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function registerVersionCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand("dantecode.showVersion", () => {
    void showVersionInfo(context);
  });
}
