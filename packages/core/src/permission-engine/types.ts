/**
 * permission-engine/types.ts — Permission Engine Foundation
 *
 * Core types for the permission engine: rules, checks, configs, and decisions.
 * Pattern source: Qwen Code PermissionManager + OpenCode channel-based grants.
 *
 * Decision priority: deny > ask > allow
 */

import { z } from "zod";
import type { CanonicalApprovalMode } from "../approval-modes.js";

// ─── Decision Schema ─────────────────────────────────────────────────────────

export const PermissionDecisionSchema = z.enum(["allow", "ask", "deny"]);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

// ─── Specifier Kind ──────────────────────────────────────────────────────────

export const SpecifierKindSchema = z.enum([
  "command",
  "path",
  "domain",
  "skill",
  "literal",
]);
export type SpecifierKind = z.infer<typeof SpecifierKindSchema>;

// ─── Permission Rule ─────────────────────────────────────────────────────────

/**
 * A single permission rule parsed from a rule string.
 *
 * Examples:
 *   "allow Bash git *"       -> { decision: "allow", toolName: "Bash", specifier: "git *", specifierKind: "command" }
 *   "deny Write src/secret/*" -> { decision: "deny", toolName: "Write", specifier: "src/secret/*", specifierKind: "path" }
 *   "ask GitPush *"          -> { decision: "ask", toolName: "GitPush", specifier: "*", specifierKind: "literal" }
 */
export interface PermissionRule {
  /** The original raw rule string */
  raw: string;
  /** The decision this rule produces when matched */
  decision: PermissionDecision;
  /** The tool name this rule applies to */
  toolName: string;
  /** Optional specifier (glob pattern) to narrow the match */
  specifier?: string;
  /** What kind of specifier this is — determines which check field to match against */
  specifierKind: SpecifierKind;
}

// ─── Permission Check ────────────────────────────────────────────────────────

/**
 * A permission check request — describes the tool call being evaluated.
 */
export interface PermissionCheck {
  /** The tool being invoked */
  toolName: string;
  /** The shell command (for Bash tool calls) */
  command?: string;
  /** The file path (for Write/Edit/Read tool calls) */
  filePath?: string;
  /** The skill name (for skill-based tool calls) */
  skillName?: string;
  /** The current approval mode */
  mode: CanonicalApprovalMode;
  /** The sub-agent ID (for sub-agent scoped rules) */
  subagentId?: string;
}

// ─── Permission Config ───────────────────────────────────────────────────────

/**
 * Complete permission configuration: rules + default decision.
 */
export interface PermissionConfig {
  /** Ordered list of permission rules */
  rules: PermissionRule[];
  /** Default decision when no rules match */
  defaultDecision: PermissionDecision;
}

// ─── Evaluation Result ───────────────────────────────────────────────────────

/**
 * The result of evaluating a permission check against a config.
 */
export interface PermissionEvaluationResult {
  /** The final decision */
  decision: PermissionDecision;
  /** Rules that matched the check */
  matchedRules: PermissionRule[];
  /** The rule that determined the decision (highest priority match), or undefined if default */
  decidingRule?: PermissionRule;
  /** Whether the default decision was used */
  usedDefault: boolean;
}
