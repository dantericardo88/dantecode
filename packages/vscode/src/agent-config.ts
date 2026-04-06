import {
  ApprovalGateway,
  buildApprovalGatewayProfile,
  isExecutionApprovalMode,
  type CanonicalApprovalMode,
} from "@dantecode/core";

export type AgentMode = CanonicalApprovalMode | "architect";
export type PersistedAgentMode = AgentMode | "build" | "default" | "auto-edit";
export type PermissionLevel = "allow" | "ask" | "deny";

export interface AgentConfig {
  agentMode: AgentMode;
  permissions: {
    edit: PermissionLevel;
    bash: PermissionLevel;
    tools: PermissionLevel;
  };
  maxToolRounds: number;
  runUntilComplete: boolean;
  showLiveDiffs: boolean;
}

export interface AgentToolAccess {
  decision: "allow" | "ask" | "deny";
  reasons: string[];
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  agentMode: "apply",
  permissions: { edit: "allow", bash: "ask", tools: "allow" },
  maxToolRounds: 15,
  runUntilComplete: false,
  showLiveDiffs: true,
};

export const PLAN_MODE_TOOLS = new Set(["Read", "ListDir", "Glob", "Grep"]);

function normalizePermissionLevel(
  value: PermissionLevel | undefined,
  fallback: PermissionLevel,
): PermissionLevel {
  return value === "allow" || value === "ask" || value === "deny" ? value : fallback;
}

export function normalizeAgentMode(mode: string | null | undefined): AgentMode {
  const raw = mode?.trim().toLowerCase();
  if (raw === "build") {
    return "apply";
  }
  if (raw === "default") {
    return "review";
  }
  if (raw === "auto-edit") {
    return "apply";
  }
  if (
    raw === "review" ||
    raw === "apply" ||
    raw === "autoforge" ||
    raw === "plan" ||
    raw === "yolo" ||
    raw === "chat" ||
    raw === "architect"
  ) {
    return raw;
  }
  return DEFAULT_AGENT_CONFIG.agentMode;
}

export function normalizeAgentConfig(
  partial: (Partial<AgentConfig> & { agentMode?: PersistedAgentMode | string }) | null | undefined,
): AgentConfig {
  const merged: AgentConfig = {
    ...DEFAULT_AGENT_CONFIG,
    ...partial,
    permissions: {
      edit: normalizePermissionLevel(
        partial?.permissions?.edit,
        DEFAULT_AGENT_CONFIG.permissions.edit,
      ),
      bash: normalizePermissionLevel(
        partial?.permissions?.bash,
        DEFAULT_AGENT_CONFIG.permissions.bash,
      ),
      tools: normalizePermissionLevel(
        partial?.permissions?.tools,
        DEFAULT_AGENT_CONFIG.permissions.tools,
      ),
    },
    agentMode: normalizeAgentMode(partial?.agentMode),
  };

  if (merged.agentMode === "plan") {
    merged.permissions = { ...merged.permissions, edit: "deny", bash: "deny" };
  }

  if (merged.agentMode === "chat") {
    merged.permissions = { ...merged.permissions, edit: "deny", bash: "deny" };
  }

  if (merged.agentMode === "yolo") {
    merged.permissions = { edit: "allow", bash: "allow", tools: "allow" };
    merged.maxToolRounds = Math.max(merged.maxToolRounds, 50);
    merged.runUntilComplete = true;
  }

  if (merged.agentMode === "autoforge") {
    merged.maxToolRounds = Math.max(merged.maxToolRounds, 30);
    merged.runUntilComplete = true;
  }

  if (merged.agentMode === "architect") {
    merged.maxToolRounds = Math.max(merged.maxToolRounds, 40);
  }

  return merged;
}

export function createAgentApprovalGateway(mode: AgentMode): ApprovalGateway {
  // "architect" is a DanteCode-specific mode not in CanonicalApprovalMode; map to "apply"
  const resolvedMode: import("@dantecode/core").ApprovalModeInput =
    mode === "architect" ? "apply" : mode;
  return new ApprovalGateway(buildApprovalGatewayProfile(resolvedMode));
}

export function isExecutionAgentMode(mode: AgentMode): boolean {
  if (mode === "architect") return true;
  return isExecutionApprovalMode(mode);
}

function isEditTool(toolName: string): boolean {
  return toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit";
}

function isBashTool(toolName: string): boolean {
  return toolName === "Bash" || toolName === "GitCommit" || toolName === "GitPush";
}

export function evaluateAgentToolAccess(config: AgentConfig, toolName: string): AgentToolAccess {
  if (config.agentMode === "plan" && !PLAN_MODE_TOOLS.has(toolName)) {
    return {
      decision: "deny",
      reasons: ["Plan mode only allows read-only tools."],
    };
  }

  const reasons: string[] = [];
  let decision: AgentToolAccess["decision"] = "allow";

  if (config.permissions.tools === "deny") {
    return {
      decision: "deny",
      reasons: ["All tools are denied by permissions."],
    };
  }
  if (config.permissions.tools === "ask") {
    decision = "ask";
    reasons.push("All tools require operator confirmation.");
  }

  if (isEditTool(toolName)) {
    if (config.permissions.edit === "deny") {
      return {
        decision: "deny",
        reasons: ["File editing is denied by permissions."],
      };
    }
    if (config.permissions.edit === "ask") {
      decision = "ask";
      reasons.push("File editing requires operator confirmation.");
    }
  }

  if (isBashTool(toolName)) {
    if (config.permissions.bash === "deny") {
      return {
        decision: "deny",
        reasons: ["Shell commands are denied by permissions."],
      };
    }
    if (config.permissions.bash === "ask") {
      decision = "ask";
      reasons.push("Shell commands require operator confirmation.");
    }
  }

  return {
    decision,
    reasons,
  };
}
