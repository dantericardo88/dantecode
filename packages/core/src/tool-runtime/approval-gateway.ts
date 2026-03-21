/**
 * approval-gateway.ts — DTR Phase 1: Approval rules for sensitive tools
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

/** Default rules — conservative for pipeline mode */
export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  {
    reason: 'Writing to system/config directories requires approval',
    tools: ['Write', 'Edit', 'Bash'],
    pathPatterns: [
      /^\/etc\//,
      /^\/usr\/local\//,
      /^~\//,
      /\.ssh\//,
      /\.aws\//,
      /\.config\//,
    ],
    decision: 'requires_approval',
  },
  {
    reason: 'npm publish / git push to remote requires approval',
    tools: ['Bash'],
    pathPatterns: [/\bnpm\s+publish\b/, /\bgit\s+push\s+.*--force\b/],
    decision: 'requires_approval',
  },
];

export class ApprovalGateway {
  private readonly _config: ApprovalGatewayConfig;

  constructor(config: Partial<ApprovalGatewayConfig> = {}) {
    this._config = {
      enabled: config.enabled ?? false, // Phase 1: disabled by default (additive)
      rules: config.rules ?? DEFAULT_APPROVAL_RULES,
    };
  }

  /**
   * Check whether a tool call should be auto-approved, require approval, or be denied.
   */
  check(
    toolName: string,
    input: Record<string, unknown>,
  ): ApprovalCheckResult {
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
}

/** Module-level singleton */
export const globalApprovalGateway = new ApprovalGateway({ enabled: false });
