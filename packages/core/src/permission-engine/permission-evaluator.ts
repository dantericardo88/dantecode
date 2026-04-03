/**
 * permission-engine/permission-evaluator.ts — Permission Evaluation Engine
 *
 * Evaluates a PermissionCheck against a PermissionConfig to produce a decision.
 *
 * Decision priority: deny (3) > ask (2) > allow (1)
 * When multiple rules match, the highest-priority decision wins.
 */

import type {
  PermissionCheck,
  PermissionConfig,
  PermissionDecision,
  PermissionEvaluationResult,
  PermissionRule,
} from "./types.js";

// ─── Priority Map ────────────────────────────────────────────────────────────

const DECISION_PRIORITY: Record<PermissionDecision, number> = {
  deny: 3,
  ask: 2,
  allow: 1,
};

// ─── Evaluator ───────────────────────────────────────────────────────────────

/**
 * Evaluate a permission check against the full config.
 *
 * Returns the decision along with all matching rules and the deciding rule.
 * If no rules match, returns the config's default decision.
 */
export function evaluatePermission(
  check: PermissionCheck,
  config: PermissionConfig,
): PermissionEvaluationResult {
  const matchingRules = config.rules.filter((rule) => ruleMatches(rule, check));

  if (matchingRules.length === 0) {
    return {
      decision: config.defaultDecision,
      matchedRules: [],
      decidingRule: undefined,
      usedDefault: true,
    };
  }

  // Find the highest-priority decision among matching rules
  let decidingRule = matchingRules[0]!;
  for (const rule of matchingRules) {
    if (DECISION_PRIORITY[rule.decision] > DECISION_PRIORITY[decidingRule.decision]) {
      decidingRule = rule;
    }
  }

  return {
    decision: decidingRule.decision,
    matchedRules: matchingRules,
    decidingRule,
    usedDefault: false,
  };
}

/**
 * Quick-evaluate: returns just the decision, no metadata.
 * Use this when you only need the verdict and want minimal allocation.
 */
export function evaluatePermissionDecision(
  check: PermissionCheck,
  config: PermissionConfig,
): PermissionDecision {
  const matchingRules = config.rules.filter((rule) => ruleMatches(rule, check));

  if (matchingRules.length === 0) {
    return config.defaultDecision;
  }

  let highest: PermissionDecision = "allow";
  for (const rule of matchingRules) {
    if (DECISION_PRIORITY[rule.decision] > DECISION_PRIORITY[highest]) {
      highest = rule.decision;
    }
  }

  return highest;
}

// ─── Rule Matching ───────────────────────────────────────────────────────────

/**
 * Check if a rule matches a given permission check.
 */
export function ruleMatches(rule: PermissionRule, check: PermissionCheck): boolean {
  // Tool name must match
  if (rule.toolName !== check.toolName) {
    return false;
  }

  // No specifier = tool-level rule, matches all invocations of this tool
  if (!rule.specifier) {
    return true;
  }

  // Match specifier against the appropriate check field
  switch (rule.specifierKind) {
    case "path":
      return check.filePath ? matchGlob(rule.specifier, check.filePath) : false;
    case "command":
      return check.command ? matchGlob(rule.specifier, check.command) : false;
    case "skill":
      return check.skillName ? matchGlob(rule.specifier, check.skillName) : false;
    case "domain":
      return check.command
        ? matchGlob(rule.specifier, check.command)
        : check.filePath
          ? matchGlob(rule.specifier, check.filePath)
          : false;
    case "literal":
      // Literal specifiers use glob matching against any available string
      return matchLiteral(rule.specifier, check);
  }
}

// ─── Glob Matching ───────────────────────────────────────────────────────────

/**
 * Match a glob pattern against a value.
 *
 * Supports:
 *   `*`   — matches any sequence of characters (except path separators for single *)
 *   `**`  — matches any sequence of characters including path separators
 *   `?`   — matches any single character
 *
 * Escaping: backslash escapes the next character.
 */
export function matchGlob(pattern: string, value: string): boolean {
  // Universal wildcard — matches everything
  if (pattern === "*" || pattern === "**") {
    return true;
  }

  const regexStr = globToRegex(pattern);
  const regex = new RegExp(`^${regexStr}$`, "i");
  return regex.test(value);
}

/**
 * Convert a glob pattern to a regex string.
 *
 * This handles **, *, and ? wildcards, plus character escaping.
 */
export function globToRegex(pattern: string): string {
  let result = "";
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index]!;

    if (char === "\\" && index + 1 < pattern.length) {
      // Escape next character
      result += escapeRegexChar(pattern[index + 1]!);
      index += 2;
      continue;
    }

    if (char === "*") {
      if (pattern[index + 1] === "*") {
        // ** matches everything including path separators
        result += ".*";
        index += 2;
        // Skip trailing slash after **
        if (pattern[index] === "/" || pattern[index] === "\\") {
          result += "[\\\\/]?";
          index += 1;
        }
        continue;
      }
      // Single * matches anything
      result += ".*";
      index += 1;
      continue;
    }

    if (char === "?") {
      result += ".";
      index += 1;
      continue;
    }

    result += escapeRegexChar(char);
    index += 1;
  }

  return result;
}

function escapeRegexChar(char: string): string {
  if ("\\^$.|?*+()[]{}".includes(char)) {
    return `\\${char}`;
  }
  return char;
}

// ─── Literal Matching ────────────────────────────────────────────────────────

/**
 * For literal specifier kind, try matching against any available check field.
 */
function matchLiteral(specifier: string, check: PermissionCheck): boolean {
  if (check.command && matchGlob(specifier, check.command)) return true;
  if (check.filePath && matchGlob(specifier, check.filePath)) return true;
  if (check.skillName && matchGlob(specifier, check.skillName)) return true;
  return false;
}
