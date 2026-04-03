// ============================================================================
// @dantecode/skills-policy — allowed-tools advisory mapper
//
// Per Agent Skills spec: allowed-tools is experimental/advisory.
// We map it to PolicyRule[] but mark every rule as advisory: true.
// Unsupported tools (not in KNOWN_DANTE_TOOLS) are collected separately.
// ============================================================================

/** Known tools Dante can execute natively. */
export const KNOWN_DANTE_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "web_search",
  "web_fetch",
  "github_search",
  "github_ops",
  "sub_agent",
  "todo_write",
  "git_commit",
  "git_push",
  // Aliases / alternate casings
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "GitHubSearch",
  "GitHubOps",
  "SubAgent",
  "TodoWrite",
  "GitCommit",
  "GitPush",
]);

export interface PolicyRule {
  /** The original tool name from allowed-tools. */
  tool: string;
  /** Always true — allowed-tools is advisory per spec. */
  advisory: true;
  /** True when the tool is not in KNOWN_DANTE_TOOLS. */
  unsupported: boolean;
}

export interface AllowedToolsMappingResult {
  rules: PolicyRule[];
  /** Tools that are not in KNOWN_DANTE_TOOLS. */
  unsupportedTools: string[];
}

/**
 * Maps an `allowed-tools` list from a SKILL.md to advisory PolicyRule[].
 *
 * Per the Agent Skills spec: `allowed-tools` is experimental/advisory.
 * It MUST NOT be used as blind execution authority. Dante maps it as input
 * to the policy engine, not as a permission grant.
 *
 * @param tools - List of tool names from SKILL.md allowed-tools field.
 */
export function mapAllowedToolsToPolicy(tools: string[]): AllowedToolsMappingResult {
  const rules: PolicyRule[] = [];
  const unsupportedTools: string[] = [];

  for (const tool of tools) {
    const unsupported = !KNOWN_DANTE_TOOLS.has(tool);
    if (unsupported) {
      unsupportedTools.push(tool);
    }
    rules.push({ tool, advisory: true, unsupported });
  }

  return { rules, unsupportedTools };
}
