/**
 * permission-engine/rule-parser.ts — Permission Rule Parser
 *
 * Parses human-readable rule strings into PermissionRule objects.
 *
 * Rule format: "<decision> <toolName> [specifier]"
 *
 * Examples:
 *   "allow Bash git *"           -> command specifier
 *   "deny Write src/sensitive/*" -> path specifier
 *   "ask GitPush *"              -> literal specifier (tool-level)
 *   "allow Read *.ts"            -> path specifier
 *   "deny Bash rm -rf *"         -> command specifier
 *   "allow Skill my-skill"       -> skill specifier
 *   "deny WebFetch *.evil.com"   -> domain specifier
 */

import type { PermissionDecision, PermissionRule, SpecifierKind } from "./types.js";

// ─── Tool → Default Specifier Kind Mapping ───────────────────────────────────

const TOOL_SPECIFIER_MAP: Record<string, SpecifierKind> = {
  Bash: "command",
  Write: "path",
  Edit: "path",
  Read: "path",
  Glob: "path",
  Grep: "path",
  NotebookEdit: "path",
  GitCommit: "literal",
  GitPush: "literal",
  SubAgent: "literal",
  WebSearch: "domain",
  WebFetch: "domain",
  Skill: "skill",
};

const VALID_DECISIONS = new Set<PermissionDecision>(["allow", "ask", "deny"]);

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a single rule string into a PermissionRule.
 *
 * @throws Error if the rule string is malformed (missing decision or tool name)
 */
export function parseRule(raw: string): PermissionRule {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error("Permission rule cannot be empty");
  }

  // Split into at most 3 parts: decision, toolName, rest-as-specifier
  const firstSpace = trimmed.indexOf(" ");
  if (firstSpace === -1) {
    throw new Error(
      `Invalid permission rule "${trimmed}": expected format "<decision> <toolName> [specifier]"`,
    );
  }

  const decisionStr = trimmed.slice(0, firstSpace).toLowerCase();
  if (!VALID_DECISIONS.has(decisionStr as PermissionDecision)) {
    throw new Error(
      `Invalid permission decision "${decisionStr}" in rule "${trimmed}". Must be one of: allow, ask, deny`,
    );
  }

  const decision = decisionStr as PermissionDecision;
  const rest = trimmed.slice(firstSpace + 1).trim();

  if (rest.length === 0) {
    throw new Error(
      `Invalid permission rule "${trimmed}": missing tool name after decision`,
    );
  }

  // Extract tool name (next token) and optional specifier (rest)
  const secondSpace = rest.indexOf(" ");
  const toolName = secondSpace === -1 ? rest : rest.slice(0, secondSpace);
  const specifier = secondSpace === -1 ? undefined : rest.slice(secondSpace + 1).trim() || undefined;

  const specifierKind = inferSpecifierKind(toolName, specifier);

  return {
    raw: trimmed,
    decision,
    toolName,
    specifier,
    specifierKind,
  };
}

/**
 * Parse multiple rule strings. Skips empty lines and lines starting with #.
 * Throws on the first malformed rule.
 */
export function parseRules(ruleStrings: string[]): PermissionRule[] {
  return ruleStrings
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("#");
    })
    .map((line) => parseRule(line));
}

// ─── Specifier Kind Inference ────────────────────────────────────────────────

/**
 * Infer the specifier kind based on tool name and specifier content.
 * Tool-specific mapping takes priority, with content-based heuristics as fallback.
 */
export function inferSpecifierKind(
  toolName: string,
  specifier: string | undefined,
): SpecifierKind {
  // No specifier = literal (tool-level rule)
  if (!specifier) {
    return "literal";
  }

  // Use tool-specific mapping if available
  const mapped = TOOL_SPECIFIER_MAP[toolName];
  if (mapped) {
    return mapped;
  }

  // Content-based heuristics
  if (specifier.includes("/") || specifier.includes("\\") || specifier.startsWith("*.")) {
    return "path";
  }

  if (specifier.includes(".") && !specifier.includes(" ")) {
    return "domain";
  }

  return "literal";
}

/**
 * Serialize a PermissionRule back to its string representation.
 * Useful for storing rules back to config files.
 */
export function serializeRule(rule: PermissionRule): string {
  const parts = [rule.decision, rule.toolName];
  if (rule.specifier) {
    parts.push(rule.specifier);
  }
  return parts.join(" ");
}
