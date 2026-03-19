/**
 * approval-gateway.ts — DTR Phase 1: Approval rules for sensitive tools
 *
 * Defines which tool calls require user approval before execution.
 * Phase 1: rule-based (by tool name, domain, or path pattern).
 * Phase 2+: interactive approval flow with resumable confirm handler.
 */

export type ApprovalDecision = 'auto_approve' | 'requires_approval' | 'auto_deny';

export interface ApprovalRule {
  /** Human-readable reason shown when requiring approval */
  reason: string;
  /** Tools this rule applies to (empty = all tools) */
  tools?: string[];
  /** URL domains this rule applies to (for WebFetch/WebSearch) */
  domains?: string[];
  /** File path patterns (for Write/Edit/Bash) */
  pathPatterns?: RegExp[];
  decision: ApprovalDecision;
}

export interface ApprovalGatewayConfig {
  /** Whether the gateway is active (false = all auto_approve, for non-pipeline mode) */
  enabled: boolean;
  rules: ApprovalRule[];
}

/** Default rules — conservative for pipeline mode */
const DEFAULT_RULES: ApprovalRule[] = [
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
      rules: config.rules ?? DEFAULT_RULES,
    };
  }

  /**
   * Check whether a tool call should be auto-approved, require approval, or be denied.
   */
  check(
    toolName: string,
    input: Record<string, unknown>,
  ): { decision: ApprovalDecision; reason?: string } {
    if (!this._config.enabled) {
      return { decision: 'auto_approve' };
    }

    for (const rule of this._config.rules) {
      if (!this._ruleApplies(rule, toolName, input)) continue;
      return { decision: rule.decision, reason: rule.reason };
    }

    return { decision: 'auto_approve' };
  }

  private _ruleApplies(
    rule: ApprovalRule,
    toolName: string,
    input: Record<string, unknown>,
  ): boolean {
    // Check tool name filter
    if (rule.tools && rule.tools.length > 0 && !rule.tools.includes(toolName)) {
      return false;
    }

    // Check domain filter (for WebFetch/WebSearch)
    if (rule.domains && rule.domains.length > 0) {
      const url = String(input['url'] ?? input['query'] ?? '');
      const matchesDomain = rule.domains.some((d) => url.includes(d));
      if (!matchesDomain) return false;
    }

    // Check path patterns
    if (rule.pathPatterns && rule.pathPatterns.length > 0) {
      // For Bash: check command string
      // For Write/Edit: check file_path
      const checkStr =
        String(input['command'] ?? input['file_path'] ?? input['path'] ?? '');
      const matchesPath = rule.pathPatterns.some((p) => p.test(checkStr));
      if (!matchesPath) return false;
    }

    return true;
  }

  get enabled(): boolean {
    return this._config.enabled;
  }
}

/** Module-level singleton */
export const globalApprovalGateway = new ApprovalGateway({ enabled: false });
