import {
  DEFAULT_APPROVAL_RULES,
  type ApprovalGatewayConfig,
  type ApprovalRule,
} from "./tool-runtime/approval-gateway.js";

export type CanonicalApprovalMode = "review" | "apply" | "autoforge" | "plan" | "yolo";
export type ApprovalModeInput = CanonicalApprovalMode | "default" | "auto-edit";

const REVIEW_APPROVAL_TOOLS = [
  "Write",
  "Edit",
  "NotebookEdit",
  "Bash",
  "GitCommit",
  "GitPush",
  "SubAgent",
];
const APPLY_APPROVAL_TOOLS = ["Bash", "GitCommit", "GitPush", "SubAgent"];
const PLAN_DENIED_TOOLS = [
  "Write",
  "Edit",
  "NotebookEdit",
  "Bash",
  "GitCommit",
  "GitPush",
  "SubAgent",
];

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

export function isExecutionApprovalMode(mode: CanonicalApprovalMode): boolean {
  return mode !== "plan";
}

/**
 * Returns the list of tool names that should be excluded from the tool set
 * sent to the model for a given approval mode.
 *
 * This is architectural mode enforcement: tools are filtered BEFORE the model
 * ever sees them, so it cannot attempt to call tools it should not use.
 *
 * - `plan` and `review` modes exclude all mutation and execution tools.
 * - `apply`, `autoforge`, and `yolo` modes allow all tools (enforcement
 *   happens at the approval gateway layer instead).
 */
export function getModeToolExclusions(mode: CanonicalApprovalMode): string[] {
  switch (mode) {
    case "plan":
    case "review":
      return ["Write", "Edit", "NotebookEdit", "Bash", "GitCommit", "GitPush", "SubAgent"];
    case "apply":
    case "autoforge":
    case "yolo":
      return [];
  }
}

function toolOnlyRule(
  reason: string,
  tools: string[],
  decision: ApprovalRule["decision"],
): ApprovalRule {
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
