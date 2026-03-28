/**
 * permission-engine/index.ts — Public API
 *
 * Permission Engine Foundation: allow/ask/deny rule evaluation
 * with glob pattern matching and priority-based decision resolution.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export {
  PermissionDecisionSchema,
  SpecifierKindSchema,
} from "./types.js";

export type {
  PermissionDecision,
  SpecifierKind,
  PermissionRule,
  PermissionCheck,
  PermissionConfig,
  PermissionEvaluationResult,
} from "./types.js";

// ─── Rule Parser ─────────────────────────────────────────────────────────────

export {
  parseRule,
  parseRules,
  inferSpecifierKind,
  serializeRule,
} from "./rule-parser.js";

// ─── Evaluator ───────────────────────────────────────────────────────────────

export {
  evaluatePermission,
  evaluatePermissionDecision,
  ruleMatches,
  matchGlob,
  globToRegex,
} from "./permission-evaluator.js";

// ─── Store ───────────────────────────────────────────────────────────────────

export {
  loadPermissionConfig,
  savePermissionConfig,
  normalizeConfigFile,
  mergePermissionRules,
  DEFAULT_PERMISSION_CONFIG,
} from "./permission-store.js";

export type { PermissionConfigFile } from "./permission-store.js";
