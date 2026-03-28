/**
 * approval-gateway.ts - DTR Phase 1: Approval rules for sensitive tools
 *
 * Defines which tool calls require user approval before execution.
 * Phase 1: rule-based (by tool name, domain, or path pattern).
 * Phase 2+: interactive approval flow with resumable confirm handler.
 *
 * Phase 3 (Blade Wave 1): Permission engine integration.
 * The permission engine layer sits ABOVE the verification rules layer.
 * If a PermissionConfig is attached, permission decisions are evaluated
 * first. A permission "deny" short-circuits to auto_deny. A permission
 * "allow" short-circuits to auto_approve (respecting mode). A permission
 * "ask" falls through to the existing verification rules layer.
 */

import {
  evaluateVerificationRules,
  type VerificationRule,
  type VerificationRuleDecision,
  type VerificationRuleEvaluation,
} from "./verification-rules.js";
import {
  evaluatePermission,
  type PermissionCheck,
  type PermissionConfig,
  type PermissionEvaluationResult,
} from "../permission-engine/index.js";
import type { CanonicalApprovalMode } from "../approval-modes.js";

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

/** Result of a permission-aware approval check */
export interface PermissionAwareCheckResult extends ApprovalCheckResult {
  /** The permission engine evaluation, if a PermissionConfig was active */
  permissionResult?: PermissionEvaluationResult;
}

export class ApprovalGateway {
  private _config: ApprovalGatewayConfig;
  private readonly _approvedToolCalls = new Set<string>();
  private _permissionConfig: PermissionConfig | null = null;
  private _approvalMode: CanonicalApprovalMode = "review";

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

  // ─── Permission Engine Integration ──────────────────────────────────────────

  /**
   * Attach a permission config to the gateway.
   * When set, permission rules are evaluated BEFORE verification rules.
   */
  setPermissionConfig(config: PermissionConfig | null): void {
    this._permissionConfig = config;
  }

  /**
   * Set the current approval mode for permission checks.
   */
  setApprovalMode(mode: CanonicalApprovalMode): void {
    this._approvalMode = mode;
  }

  /**
   * Check a tool call with both permission engine and verification rules.
   *
   * Evaluation order:
   * 1. Pre-approved fingerprint → auto_approve
   * 2. Gateway disabled → auto_approve
   * 3. Permission engine (if configured):
   *    - deny → auto_deny (short-circuit)
   *    - allow → auto_approve (short-circuit)
   *    - ask → fall through to verification rules
   * 4. Verification rules → existing behavior
   */
  checkWithPermissions(
    toolName: string,
    input: Record<string, unknown>,
  ): PermissionAwareCheckResult {
    // Step 1: fingerprint check (consuming)
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

    // Step 2: gateway disabled
    if (!this._config.enabled) {
      return {
        decision: "auto_approve",
        warnings: [],
        matchedRules: [],
        enforcedRules: [],
      };
    }

    // Step 3: permission engine
    if (this._permissionConfig) {
      const permissionCheck: PermissionCheck = {
        toolName,
        command: typeof input["command"] === "string" ? input["command"] : undefined,
        filePath:
          typeof input["file_path"] === "string"
            ? input["file_path"]
            : typeof input["path"] === "string"
              ? input["path"]
              : undefined,
        skillName: typeof input["skill_name"] === "string" ? input["skill_name"] : undefined,
        mode: this._approvalMode,
        subagentId: typeof input["subagent_id"] === "string" ? input["subagent_id"] : undefined,
      };

      const permissionResult = evaluatePermission(permissionCheck, this._permissionConfig);

      if (permissionResult.decision === "deny") {
        const reason = permissionResult.decidingRule
          ? `Permission denied by rule: "${permissionResult.decidingRule.raw}"`
          : "Permission denied by default policy.";
        return {
          decision: "auto_deny",
          reason,
          warnings: [],
          matchedRules: [],
          enforcedRules: [],
          permissionResult,
        };
      }

      if (permissionResult.decision === "allow") {
        return {
          decision: "auto_approve",
          reason: permissionResult.decidingRule
            ? `Permission allowed by rule: "${permissionResult.decidingRule.raw}"`
            : "Permission allowed by default policy.",
          warnings: [],
          matchedRules: [],
          enforcedRules: [],
          permissionResult,
        };
      }

      // decision === "ask" → fall through to verification rules
      const verificationResult = evaluateVerificationRules(toolName, input, this._config.rules);
      return {
        ...verificationResult,
        permissionResult,
      };
    }

    // Step 4: no permission config → verification rules only
    return evaluateVerificationRules(toolName, input, this._config.rules);
  }

  get enabled(): boolean {
    return this._config.enabled;
  }

  get rules(): ApprovalRule[] {
    return [...this._config.rules];
  }

  get permissionConfig(): PermissionConfig | null {
    return this._permissionConfig;
  }

  get approvalMode(): CanonicalApprovalMode {
    return this._approvalMode;
  }
}

/** Module-level singleton */
export const globalApprovalGateway = new ApprovalGateway({ enabled: false });
