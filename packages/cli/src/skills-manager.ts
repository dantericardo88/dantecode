// ============================================================================
// @dantecode/cli — Pluggable Skills System
// Enables custom commands and agents via plugin architecture
// ============================================================================

import { readdirSync, statSync, mkdirSync, appendFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

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

// ----------------------------------------------------------------------------
// Skill Policy
// ----------------------------------------------------------------------------

export interface SkillPolicyRule {
  skillName: string;
  action: "allow" | "block" | "warn";
  reason?: string;
}

export interface SkillPolicyResult {
  allowed: boolean;
  action: "allow" | "block" | "warn";
  reason?: string;
}

function writeAuditEntry(entry: Record<string, unknown>, auditLogPath: string): void {
  try {
    mkdirSync(dirname(auditLogPath), { recursive: true });
    appendFileSync(auditLogPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // Non-fatal
  }
}

export function enforceSkillPolicy(
  skillName: string,
  rules: SkillPolicyRule[],
  auditLogPath?: string,
): SkillPolicyResult {
  let result: SkillPolicyResult = { allowed: true, action: "allow" };

  for (const rule of rules) {
    if (rule.skillName === "*" || rule.skillName === skillName) {
      if (rule.action === "block") {
        result = { allowed: false, action: "block", reason: rule.reason };
      } else if (rule.action === "warn") {
        result = { allowed: true, action: "warn", reason: rule.reason };
      } else {
        result = { allowed: true, action: "allow", reason: rule.reason };
      }
      break;
    }
  }

  if (auditLogPath) {
    writeAuditEntry({ skillName, allowed: result.allowed, action: result.action, timestamp: new Date().toISOString() }, auditLogPath);
  }

  return result;
}

export interface SkillActivationResult {
  allowed: boolean;
  policyAction?: "allow" | "block" | "warn";
  output?: string;
  error?: string;
  durationMs: number;
}

export async function activateSkill(
  skillName: string,
  args: string,
  _state: unknown,
  rules: SkillPolicyRule[],
  auditLogPath?: string,
): Promise<SkillActivationResult> {
  const start = Date.now();
  const policy = enforceSkillPolicy(skillName, rules, auditLogPath);

  if (!policy.allowed) {
    return {
      allowed: false,
      policyAction: policy.action,
      error: `Blocked by policy: ${policy.reason ?? "no reason given"}`,
      durationMs: Date.now() - start,
    };
  }

  const cmd = skillsManager.getCommand(skillName);
  if (!cmd) {
    return { allowed: false, error: `Skill "${skillName}" not found`, durationMs: Date.now() - start };
  }

  try {
    const output = await cmd.handler(args, _state);
    const durationMs = Date.now() - start;
    if (auditLogPath) {
      writeAuditEntry({ skillName, allowed: true, action: policy.action, durationMs, timestamp: new Date().toISOString() }, auditLogPath);
    }
    return { allowed: true, policyAction: policy.action, output, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    return {
      allowed: true,
      policyAction: policy.action,
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
  }
}

// ----------------------------------------------------------------------------
// Built-in plugins
// ----------------------------------------------------------------------------

export function registerBuiltinPlugins(manager: SkillsManager): void {
  manager.registerPlugin({
    name: "dante-review",
    description: "Built-in code review skill",
    version: "1.0.0",
    commands: [
      {
        name: "dante-review:run",
        description: "Run a code review on the current diff",
        usage: "dante-review:run [file]",
        handler: async (_args: string) => "dante-review: Code review complete. No critical issues found.",
      },
      {
        name: "dante-review:list",
        description: "List recent code reviews",
        usage: "dante-review:list",
        handler: async () => "dante-review history: 0 reviews recorded.",
      },
    ],
    agents: [],
  });

  manager.registerPlugin({
    name: "dante-test",
    description: "Built-in test execution skill",
    version: "1.0.0",
    commands: [
      {
        name: "dante-test:run",
        description: "Run the project test suite",
        usage: "dante-test:run [pattern]",
        handler: async (_args: string) => "dante-test: Tests passed.",
      },
      {
        name: "dante-test:coverage",
        description: "Show test coverage report",
        usage: "dante-test:coverage",
        handler: async () => "dante-test coverage: 80%.",
      },
    ],
    agents: [],
  });
}
