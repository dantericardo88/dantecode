import * as vscode from "vscode";
import type { DebugSnapshot } from "./debug-attach-provider.js";

export interface BreakpointLocation {
  filePath: string;   // absolute path
  line: number;       // 1-indexed
  condition?: string;
}

export interface DebugLaunchConfig {
  type: "node" | "python" | "go" | "rust" | "auto";
  program?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface DebugControlResult {
  success: boolean;
  snapshot?: DebugSnapshot;
  error?: string;
}

export class DebugControlProvider {
  private _breakpoints: vscode.Breakpoint[] = [];

  /**
   * Start a debug session using the given config, or auto-detect from workspace.
   */
  async startDebugging(config: DebugLaunchConfig): Promise<vscode.DebugSession | null> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return null;

    const launchConfig = await this._resolveLaunchConfig(config, folder);
    const started = await vscode.debug.startDebugging(folder, launchConfig);
    if (!started) return null;
    return vscode.debug.activeDebugSession ?? null;
  }

  /**
   * Set breakpoints at given locations. Clears previously set breakpoints first.
   */
  setBreakpoints(locations: BreakpointLocation[]): void {
    vscode.debug.removeBreakpoints(this._breakpoints);
    this._breakpoints = [];

    const newBps: vscode.Breakpoint[] = locations.map((loc) => {
      const uri = vscode.Uri.file(loc.filePath);
      const pos = new vscode.Position(loc.line - 1, 0);
      const bpLoc = new vscode.Location(uri, pos);
      return loc.condition
        ? new vscode.SourceBreakpoint(bpLoc, true, loc.condition)
        : new vscode.SourceBreakpoint(bpLoc, true);
    });

    vscode.debug.addBreakpoints(newBps);
    this._breakpoints = newBps;
  }

  clearBreakpoints(): void {
    vscode.debug.removeBreakpoints(this._breakpoints);
    this._breakpoints = [];
  }

  /**
   * Send a DAP command to the active debug session.
   */
  async sendCommand(command: "continue" | "next" | "stepIn" | "stepOut" | "pause"): Promise<void> {
    const session = vscode.debug.activeDebugSession;
    if (!session) return;
    const dapCmd: Record<string, string> = {
      continue: "continue",
      next: "next",
      stepIn: "stepIn",
      stepOut: "stepOut",
      pause: "pause",
    };
    await session.customRequest(dapCmd[command] ?? command, { threadId: 1 });
  }

  /**
   * Stop the active debug session.
   */
  stopDebugging(): Thenable<void> {
    return vscode.debug.stopDebugging();
  }

  /**
   * Generate a .vscode/launch.json for the given debug type.
   * Does NOT overwrite an existing launch.json unless force=true.
   */
  async generateLaunchConfig(config: DebugLaunchConfig, workspaceRoot: string, force = false): Promise<string> {
    const { writeFile, mkdir, access } = await import("node:fs/promises");
    const { join } = await import("node:path");

    const vscodeDir = join(workspaceRoot, ".vscode");
    await mkdir(vscodeDir, { recursive: true });
    const launchPath = join(vscodeDir, "launch.json");

    if (!force) {
      try {
        await access(launchPath);
        return launchPath; // Already exists, skip
      } catch { /* doesn't exist, create it */ }
    }

    const launchJson = {
      version: "0.2.0",
      configurations: [this._buildDebugConfiguration(
        config.type === "auto" ? "node" : config.type,
        config,
      )],
    };
    await writeFile(launchPath, JSON.stringify(launchJson, null, 2));
    return launchPath;
  }

  private async _resolveLaunchConfig(
    config: DebugLaunchConfig,
    folder: vscode.WorkspaceFolder,
  ): Promise<vscode.DebugConfiguration> {
    const type = config.type === "auto"
      ? await this._detectDebugType(folder.uri.fsPath)
      : config.type;
    return this._buildDebugConfiguration(type, config);
  }

  async _detectDebugType(root: string): Promise<DebugLaunchConfig["type"]> {
    const { access } = await import("node:fs/promises");
    const checks: Array<[string, DebugLaunchConfig["type"]]> = [
      ["pyproject.toml", "python"],
      ["Cargo.toml", "rust"],
      ["go.mod", "go"],
      ["package.json", "node"],
    ];
    for (const [file, type] of checks) {
      try {
        await access(`${root}/${file}`);
        return type;
      } catch { /* next */ }
    }
    return "node";
  }

  private _buildDebugConfiguration(
    type: DebugLaunchConfig["type"],
    config: DebugLaunchConfig,
  ): vscode.DebugConfiguration {
    const base = { name: `DanteCode: ${type}`, request: "launch" };
    switch (type) {
      case "python":
        return { ...base, type: "debugpy", program: config.program ?? "${file}", args: config.args ?? [], env: config.env ?? {}, cwd: config.cwd ?? "${workspaceFolder}" };
      case "go":
        return { ...base, type: "go", mode: "debug", program: config.program ?? "${workspaceFolder}", args: config.args ?? [], env: config.env ?? {} };
      case "rust":
        return { ...base, type: "lldb", program: config.program ?? "${workspaceFolder}/target/debug/${workspaceFolderBasename}", args: config.args ?? [] };
      default:
        return { ...base, type: "node", program: config.program ?? "${workspaceFolder}/index.js", args: config.args ?? [], env: config.env ?? {}, cwd: config.cwd ?? "${workspaceFolder}" };
    }
  }
}

export const globalDebugControl = new DebugControlProvider();
