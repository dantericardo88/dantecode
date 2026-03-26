import {
  DEFAULT_APPROVAL_RULES,
  globalApprovalGateway,
  type ApprovalGatewayConfig,
  type ApprovalRule,
} from "@dantecode/core";

export type CanonicalApprovalMode = "review" | "apply" | "autoforge" | "plan" | "yolo";
export type ApprovalModeInput =
  | CanonicalApprovalMode
  | "default"
  | "auto-edit";

const REVIEW_APPROVAL_TOOLS = ["Write", "Edit", "NotebookEdit", "Bash", "GitCommit", "GitPush", "SubAgent"];
const APPLY_APPROVAL_TOOLS = ["Bash", "GitCommit", "GitPush", "SubAgent"];
const PLAN_DENIED_TOOLS = ["Write", "Edit", "NotebookEdit", "Bash", "GitCommit", "GitPush", "SubAgent"];

export function normalizeApprovalMode(mode: string): CanonicalApprovalMode | null {
  switch (mode.trim().toLowerCase()) {
    case "default":
    case "review":
      return "review";
    case "auto-edit":
    case "apply":
      return "apply";
    case "autoforge":
      return "autoforge";
    case "plan":
      return "plan";
    case "yolo":
      return "yolo";
    default:
      return null;
  }
}

function toolOnlyRule(reason: string, tools: string[], decision: ApprovalRule["decision"]): ApprovalRule {
  return {
    reason,
    tools,
    decision,
  };
}

export function buildApprovalGatewayProfile(mode: ApprovalModeInput): ApprovalGatewayConfig {
  const normalized = normalizeApprovalMode(mode);
  if (!normalized) {
    throw new Error(`Unknown approval mode: ${mode}`);
  }

  if (normalized === "yolo") {
    return {
      enabled: false,
      rules: [],
    };
  }

  if (normalized === "plan") {
    return {
      enabled: true,
      rules: [
        ...DEFAULT_APPROVAL_RULES,
        toolOnlyRule(
          "Plan mode blocks workspace mutations and subagents until the operator approves execution.",
          PLAN_DENIED_TOOLS,
          "auto_deny",
        ),
      ],
    };
  }

  if (normalized === "review") {
    return {
      enabled: true,
      rules: [
        ...DEFAULT_APPROVAL_RULES,
        toolOnlyRule(
          "Review mode requires operator approval before mutating the workspace or spawning subagents.",
          REVIEW_APPROVAL_TOOLS,
          "requires_approval",
        ),
      ],
    };
  }

  return {
    enabled: true,
    rules: [
      ...DEFAULT_APPROVAL_RULES,
      toolOnlyRule(
        normalized === "autoforge"
          ? "Autoforge mode still requires approval for shell, git, and subagent execution."
          : "Apply mode still requires approval for shell, git, and subagent execution.",
        APPLY_APPROVAL_TOOLS,
        "requires_approval",
      ),
    ],
  };
}

export function configureApprovalMode(mode: ApprovalModeInput): CanonicalApprovalMode {
  const normalized = normalizeApprovalMode(mode);
  if (!normalized) {
    throw new Error(`Unknown approval mode: ${mode}`);
  }

  globalApprovalGateway.configure(buildApprovalGatewayProfile(normalized));
  return normalized;
}
