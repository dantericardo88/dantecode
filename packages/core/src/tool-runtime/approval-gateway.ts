/**
 * approval-gateway.ts - DTR Phase 1: Approval rules for sensitive tools
 *
 * Defines which tool calls require user approval before execution.
 * Phase 1: rule-based (by tool name, domain, or path pattern).
 * Phase 2+: interactive approval flow with resumable confirm handler.
 */

import {
  evaluateVerificationRules,
  type VerificationRule,
  type VerificationRuleDecision,
  type VerificationRuleEvaluation,
} from "./verification-rules.js";

export type ApprovalDecision = VerificationRuleDecision;
export type ApprovalRule = VerificationRule;
export type ApprovalCheckResult = VerificationRuleEvaluation;

export interface ApprovalGatewayConfig {
  /** Whether the gateway is active (false = all auto_approve, for non-pipeline mode) */
  enabled: boolean;
  rules: ApprovalRule[];
}

/** Default rules - conservative for pipeline mode */
export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  {
    reason: "Writing to system/config directories requires approval",
    tools: ["Write", "Edit", "Bash"],
    pathPatterns: [/^\/etc\//, /^\/usr\/local\//, /^~\//, /\.ssh\//, /\.aws\//, /\.config\//],
    decision: "requires_approval",
  },
  {
    reason: "npm publish / git push to remote requires approval",
    tools: ["Bash"],
    pathPatterns: [/\bnpm\s+publish\b/, /\bgit\s+push\s+.*--force\b/],
    decision: "requires_approval",
  },
];

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }

  return JSON.stringify(value);
}

function buildToolCallFingerprint(toolName: string, input: Record<string, unknown>): string {
  return `${toolName}:${stableSerialize(input)}`;
}

export class ApprovalGateway {
  private _config: ApprovalGatewayConfig;
  private readonly _approvedToolCalls = new Set<string>();

  constructor(config: Partial<ApprovalGatewayConfig> = {}) {
    this._config = {
      enabled: config.enabled ?? false,
      rules: config.rules ?? DEFAULT_APPROVAL_RULES,
    };
  }

  configure(config: Partial<ApprovalGatewayConfig>): void {
    this._config = {
      enabled: config.enabled ?? this._config.enabled,
      rules: config.rules ?? this._config.rules,
    };
  }

  setEnabled(enabled: boolean): void {
    this._config = {
      ...this._config,
      enabled,
    };
  }

  setRules(rules: ApprovalRule[]): void {
    this._config = {
      ...this._config,
      rules,
    };
  }

  reset(config: Partial<ApprovalGatewayConfig> = {}): void {
    this._approvedToolCalls.clear();
    this._config = {
      enabled: config.enabled ?? false,
      rules: config.rules ?? DEFAULT_APPROVAL_RULES,
    };
  }

  approveToolCall(toolName: string, input: Record<string, unknown>): void {
    this._approvedToolCalls.add(buildToolCallFingerprint(toolName, input));
  }

  revokeToolCallApproval(toolName: string, input: Record<string, unknown>): void {
    this._approvedToolCalls.delete(buildToolCallFingerprint(toolName, input));
  }

  clearApprovedToolCalls(): void {
    this._approvedToolCalls.clear();
  }

  /**
   * Non-consuming decision peek: checks the decision for a tool call without
   * consuming pre-approved fingerprints. Safe to call from pre-execution guards
   * where the tool scheduler also runs check() downstream.
   */
  peekDecision(toolName: string, input: Record<string, unknown>): ApprovalDecision {
    if (this._approvedToolCalls.has(buildToolCallFingerprint(toolName, input))) {
      return "auto_approve";
    }
    if (!this._config.enabled) {
      return "auto_approve";
    }
    return evaluateVerificationRules(toolName, input, this._config.rules).decision;
  }

  /**
   * Check whether a tool call should be auto-approved, require approval, or be denied.
   */
  check(toolName: string, input: Record<string, unknown>): ApprovalCheckResult {
    const fingerprint = buildToolCallFingerprint(toolName, input);
    if (this._approvedToolCalls.delete(fingerprint)) {
      return {
        decision: "auto_approve",
        reason: "Tool call explicitly approved by operator.",
        warnings: [],
        matchedRules: [],
        enforcedRules: [],
      };
    }

    if (!this._config.enabled) {
      return {
        decision: "auto_approve",
        warnings: [],
        matchedRules: [],
        enforcedRules: [],
      };
    }

    return evaluateVerificationRules(toolName, input, this._config.rules);
  }

  get enabled(): boolean {
    return this._config.enabled;
  }

  get rules(): ApprovalRule[] {
    return [...this._config.rules];
  }
}

/** Module-level singleton */
export const globalApprovalGateway = new ApprovalGateway({ enabled: false });
