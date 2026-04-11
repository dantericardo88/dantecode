// ============================================================================
// @dantecode/cli — Pluggable Skills System
// Enables custom commands and agents via plugin architecture
// ============================================================================

import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export interface SkillPlugin {
  name: string;
  description: string;
  version: string;
  commands: SkillCommand[];
  agents: SkillAgent[];
}

export interface SkillCommand {
  name: string;
  description: string;
  usage: string;
  handler: (args: string, state: any) => Promise<string>;
}

export interface SkillAgent {
  name: string;
  description: string;
  capabilities: string[];
  execute: (task: string, context: any) => Promise<any>;
}

class SkillsManager {
  private plugins: Map<string, SkillPlugin> = new Map();
  private commands: Map<string, SkillCommand> = new Map();

  async loadPlugins(pluginsDir: string): Promise<void> {
    try {
      const entries = readdirSync(pluginsDir);
      for (const entry of entries) {
        const fullPath = join(pluginsDir, entry);
        if (statSync(fullPath).isDirectory()) {
          const pluginPath = join(fullPath, "plugin.js");
          try {
            const pluginModule = await import(pluginPath);
            const plugin: SkillPlugin = pluginModule.default;
            this.registerPlugin(plugin);
          } catch (e) {
            console.warn(`Failed to load plugin ${entry}: ${e}`);
          }
        }
      }
    } catch (e) {
      // Plugins directory doesn't exist — that's fine
    }
  }

  registerPlugin(plugin: SkillPlugin): void {
    this.plugins.set(plugin.name, plugin);
    for (const command of plugin.commands) {
      this.commands.set(command.name, command);
    }
  }

  getCommand(name: string): SkillCommand | undefined {
    return this.commands.get(name);
  }

  listPlugins(): string[] {
    return Array.from(this.plugins.keys());
  }

  listCommands(): Array<{ name: string; description: string }> {
    return Array.from(this.commands.values()).map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }
}

export const skillsManager = new SkillsManager();

// Initialize plugins on module load
const pluginsDir = resolve(process.cwd(), ".dantecode", "plugins");
skillsManager.loadPlugins(pluginsDir);
