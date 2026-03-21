// ============================================================================
// @dantecode/dante-sandbox — ApprovalEngine
// Three-tier approval policy for tool / command execution.
// Supports allow-list rules, deny-list rules, and per-request prompting.
// ============================================================================

import type { RiskLevel } from "./types.js";

export type ApprovalPolicy = "manual" | "on-request" | "auto";

export interface ApprovalRequest {
  toolName: string;
  command?: string;
  riskLevel: RiskLevel;
  reason?: string;
}

export interface ApprovalDecision {
  approved: boolean;
  policy: ApprovalPolicy;
  matchedRule?: string;
  reason?: string;
}

export interface ApprovalEngineSnapshot {
  policy: ApprovalPolicy;
  allowPatterns: string[];
  denyPatterns: string[];
}

/** Default allow patterns covering common safe, read-only operations. */
export const DEFAULT_ALLOW_PATTERNS: RegExp[] = [
  /^(npm|npx)\s+(test|run\s+test|install)\b/,
  /^(git\s+(status|log|diff|show|branch|fetch))\b/,
  /^(ls|cat|echo|pwd|which|node|tsc)\b/,
];

export class ApprovalEngine {
  policy: ApprovalPolicy;
  private _allowRules: RegExp[];
  private _denyRules: RegExp[];

  get allowRules(): RegExp[] {
    return [...this._allowRules];
  }
  get denyRules(): RegExp[] {
    return [...this._denyRules];
  }

  constructor(policy: ApprovalPolicy = "on-request") {
    this.policy = policy;
    this._allowRules = [...DEFAULT_ALLOW_PATTERNS];
    this._denyRules = [];
  }

  /**
   * Returns true when the user should be prompted for approval.
   * - 'manual': always true
   * - 'on-request': true for medium+ risk AND no allow rule matched
   * - 'auto': always false
   */
  shouldPrompt(req: ApprovalRequest): boolean {
    switch (this.policy) {
      case "manual":
        return true;
      case "auto":
        return false;
      case "on-request": {
        if (req.riskLevel === "low") return false;
        const subject = req.command ?? req.toolName;
        return !this._allowRules.some((r) => r.test(subject));
      }
    }
  }

  /**
   * Evaluates whether a request should be approved or blocked.
   * Priority: deny rules > allow rules > policy.
   */
  evaluate(req: ApprovalRequest): ApprovalDecision {
    const subject = req.command ?? req.toolName;

    for (const rule of this._denyRules) {
      if (rule.test(subject)) {
        return {
          approved: false,
          policy: this.policy,
          matchedRule: rule.source,
          reason: `Blocked by deny rule: ${rule.source}`,
        };
      }
    }

    for (const rule of this._allowRules) {
      if (rule.test(subject)) {
        return {
          approved: true,
          policy: this.policy,
          matchedRule: rule.source,
          reason: `Permitted by allow rule: ${rule.source}`,
        };
      }
    }

    switch (this.policy) {
      case "manual":
        return { approved: false, policy: this.policy, reason: "Manual approval required" };
      case "auto":
        return { approved: true, policy: this.policy, reason: "Auto-approved by policy" };
      case "on-request": {
        const isLow = req.riskLevel === "low";
        return {
          approved: isLow,
          policy: this.policy,
          reason: isLow ? "Low-risk auto-approved" : `${req.riskLevel} risk requires approval`,
        };
      }
    }
  }

  addAllowRule(pattern: string): void {
    this._allowRules.push(new RegExp(pattern));
  }

  addDenyRule(pattern: string): void {
    this._denyRules.push(new RegExp(pattern));
  }

  setPolicy(policy: ApprovalPolicy): void {
    this.policy = policy;
  }

  toJSON(): ApprovalEngineSnapshot {
    const defaultSources = new Set(DEFAULT_ALLOW_PATTERNS.map((r) => r.source));
    return {
      policy: this.policy,
      allowPatterns: this._allowRules
        .filter((r) => !defaultSources.has(r.source))
        .map((r) => r.source),
      denyPatterns: this._denyRules.map((r) => r.source),
    };
  }

  static fromJSON(data: ApprovalEngineSnapshot): ApprovalEngine {
    const engine = new ApprovalEngine(data.policy);
    for (const p of data.allowPatterns ?? []) engine.addAllowRule(p);
    for (const p of data.denyPatterns ?? []) engine.addDenyRule(p);
    return engine;
  }

  /** @deprecated use evaluate() instead */
  recordDecision(_req: ApprovalRequest, _approved: boolean): void {}
}

export const globalApprovalEngine = new ApprovalEngine("on-request");

export function getGlobalApprovalEngine(): ApprovalEngine {
  return globalApprovalEngine;
}
