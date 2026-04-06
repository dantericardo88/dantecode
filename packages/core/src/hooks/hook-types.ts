// ============================================================================
// @dantecode/core — Hook System Types (QwenCode pattern)
// ============================================================================

/**
 * All supported hook event types.
 * Mirrors QwenCode's hookRunner event taxonomy.
 */
export type HookEventType =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "SubagentStart"
  | "SubagentStop"
  | "PreCompact"
  | "PermissionRequest"
  | "Stop"
  | "Notification";

/**
 * Exit code semantics (identical to QwenCode convention):
 * 0   → success / allow
 * 2   → blocking error (halt pipeline)
 * 1|other → non-blocking warning (log + continue)
 */
export type HookExitCode = 0 | 1 | 2 | number;

/**
 * A hook can run a shell command (string) or an inline async function.
 * When it is a function the return value is treated as the stdout, and
 * the function must either return normally (≡ exit 0) or throw an error
 * with a `.code` property (≡ non-zero exit).
 */
export type HookCommand = string | ((event: HookEventPayload) => Promise<string>);

/**
 * Rich payload delivered to every hook invocation.
 */
export interface HookEventPayload {
  /** The event type that triggered this hook run. */
  eventType: HookEventType;
  /** Tool name — present for *ToolUse* and PermissionRequest events. */
  toolName?: string;
  /** Raw tool input (before execution) — present for PreToolUse. */
  toolInput?: Record<string, unknown>;
  /** Tool output (after execution) — present for PostToolUse / PostToolUseFailure. */
  toolOutput?: unknown;
  /** Error detail — present for PostToolUseFailure. */
  toolError?: string;
  /** The user prompt text — present for UserPromptSubmit. */
  userPrompt?: string;
  /** Compact transcript text — present for PreCompact. */
  compactInput?: string;
  /** Generic metadata bag for extension points. */
  metadata?: Record<string, unknown>;
}

/**
 * A single hook definition as stored in config / supplied programmatically.
 */
export interface HookDefinition {
  /** Human-readable identifier (used in logs). */
  name: string;
  /** The event this hook fires on. */
  event: HookEventType;
  /** Shell command or inline async function to execute. */
  command: HookCommand;
  /**
   * Optional regex pattern matched against `toolName`.
   * When present the hook only fires when the tool name matches.
   * Pattern is tested with RegExp.test().
   */
  toolPattern?: string;
  /**
   * When true this hook runs in parallel with others in the same event group.
   * Default: false (sequential).
   */
  parallel?: boolean;
  /**
   * Timeout in milliseconds. Default: 60 000 (60 s).
   */
  timeoutMs?: number;
  /**
   * Maximum bytes accepted from stdout/stderr. Default: 1 048 576 (1 MiB).
   */
  maxOutputBytes?: number;
}
