// ============================================================================
// @dantecode/cli — Plan Mode Guard
// Tool gating logic for plan mode. When plan mode is active and not yet
// approved, only read-only tools are allowed.
// ============================================================================

/** Tools that are allowed in plan mode (read-only exploration). */
const PLAN_MODE_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "WebSearch",
  "WebFetch",
  "TodoWrite",
  "AskUser",
  "Memory",
]);

/**
 * Returns true if the tool is blocked during plan mode (before approval).
 * Write, Edit, Bash, GitCommit, GitPush, etc. are all blocked.
 */
export function isPlanModeBlocked(toolName: string): boolean {
  return !PLAN_MODE_ALLOWED_TOOLS.has(toolName);
}

/**
 * Returns the rejection message shown to the model when a write tool is blocked.
 */
export function planModeBlockedMessage(toolName: string): string {
  return (
    `PLAN MODE ACTIVE: The tool "${toolName}" is blocked because a plan has not been approved yet. ` +
    `Only read-only tools (Read, Glob, Grep, WebSearch, WebFetch, TodoWrite, AskUser, Memory) are available. ` +
    `Present your plan and wait for user approval before executing any file modifications or commands.`
  );
}
