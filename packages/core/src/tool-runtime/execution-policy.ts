/**
 * execution-policy.ts — DTR Phase 6: Execution class + dependency blocking rules
 *
 * Defines per-tool execution classes and dependency gating rules.
 * When a tool declares a dependency, it will not execute until the
 * dependency tool has completed successfully in the same turn.
 *
 * Phase 6 scope: policy definitions + evaluation. The scheduler in Phase 1
 * can be extended to enforce these rules in Phase 2+ wiring.
 */

// ─── Execution Classes ────────────────────────────────────────────────────────

/**
 * Execution class controls how a tool is scheduled.
 *
 * - `read_only`: Safe to run concurrently with other read_only tools
 * - `file_write`: Modifies the filesystem — serialized with other file_writes
 * - `process`: Runs an external process (Bash) — serialized, may have side effects
 * - `network`: Makes network requests — serialized with other network calls
 * - `acquire`: Downloads artifacts — must complete before dependent reads
 * - `agent`: Spawns a sub-agent — heavyweight, serialized
 * - `vcs`: Git operations — serialized, touches .git/
 */
export type ExecutionClass =
  | "read_only"
  | "file_write"
  | "process"
  | "network"
  | "acquire"
  | "agent"
  | "vcs";

export interface ToolExecutionPolicy {
  /** Tool name this policy applies to */
  tool: string;
  /** Execution class for scheduling */
  executionClass: ExecutionClass;
  /**
   * Tools this tool depends on (must complete BEFORE this tool runs).
   * Example: Read must precede Write/Edit on the same file.
   */
  dependsOn?: string[];
  /**
   * Tools that must NOT have run before this tool in the same turn.
   * Example: GitCommit must not follow a failing Bash (test run).
   */
  blockedBy?: string[];
  /**
   * Whether this tool requires its input paths to be verified as existing
   * before execution. Checked against ArtifactStore.
   */
  requiresArtifactVerification?: boolean;
  /** Whether to run post-execution verification (overrides scheduler default) */
  verifyAfterExecution?: boolean;
}

// ─── Built-in Policies ────────────────────────────────────────────────────────

export const BUILTIN_TOOL_POLICIES: ToolExecutionPolicy[] = [
  { tool: "Read", executionClass: "read_only" },
  { tool: "Glob", executionClass: "read_only" },
  { tool: "Grep", executionClass: "read_only" },

  { tool: "Write", executionClass: "file_write", verifyAfterExecution: true },
  { tool: "Edit", executionClass: "file_write", verifyAfterExecution: true },
  { tool: "TodoWrite", executionClass: "file_write" },

  {
    tool: "Bash",
    executionClass: "process",
    verifyAfterExecution: true,
    // Bash can create artifacts that need verification before downstream tools use them
    requiresArtifactVerification: false, // post-execution only; not pre-execution check
  },

  { tool: "WebSearch", executionClass: "network" },
  { tool: "WebFetch", executionClass: "network" },

  {
    tool: "AcquireUrl",
    executionClass: "acquire",
    verifyAfterExecution: true,
    requiresArtifactVerification: false,
  },
  {
    tool: "AcquireArchive",
    executionClass: "acquire",
    verifyAfterExecution: true,
    requiresArtifactVerification: false,
  },

  {
    tool: "GitCommit",
    executionClass: "vcs",
    // Committing should only happen after successful file writes (file_write tools)
    dependsOn: ["Write", "Edit"],
  },
  {
    tool: "GitPush",
    executionClass: "vcs",
    dependsOn: ["GitCommit"],
  },

  { tool: "SubAgent", executionClass: "agent" },
  { tool: "GitHubSearch", executionClass: "network" },
  { tool: "GitHubOps", executionClass: "network" },
];

// ─── Policy Registry ──────────────────────────────────────────────────────────

export class ExecutionPolicyRegistry {
  private readonly _policies = new Map<string, ToolExecutionPolicy>();

  constructor(extra: ToolExecutionPolicy[] = []) {
    // Register builtins first, then extras (extras override builtins)
    for (const p of BUILTIN_TOOL_POLICIES) {
      this._policies.set(p.tool, p);
    }
    for (const p of extra) {
      this._policies.set(p.tool, p);
    }
  }

  /** Get policy for a tool (returns permissive default if not found) */
  get(toolName: string): ToolExecutionPolicy {
    return (
      this._policies.get(toolName) ?? {
        tool: toolName,
        executionClass: "process",
      }
    );
  }

  /** Get the execution class for a tool */
  executionClass(toolName: string): ExecutionClass {
    return this.get(toolName).executionClass;
  }

  /** Whether concurrent execution is allowed (read_only tools can run concurrently) */
  canRunConcurrently(toolA: string, toolB: string): boolean {
    return this.executionClass(toolA) === "read_only" && this.executionClass(toolB) === "read_only";
  }

  /** Check if toolName is blocked by any tool in the already-executed set */
  isBlocked(toolName: string, executedTools: Set<string>): { blocked: boolean; reason?: string } {
    const policy = this.get(toolName);

    if (policy.blockedBy) {
      for (const blocker of policy.blockedBy) {
        if (executedTools.has(blocker)) {
          return {
            blocked: true,
            reason: `${toolName} is blocked because ${blocker} already ran this turn`,
          };
        }
      }
    }

    return { blocked: false };
  }

  /** Check if all dependencies of toolName have been satisfied */
  dependenciesSatisfied(
    toolName: string,
    completedTools: Set<string>,
  ): { satisfied: boolean; missing?: string[] } {
    const policy = this.get(toolName);

    if (!policy.dependsOn || policy.dependsOn.length === 0) {
      return { satisfied: true };
    }

    const missing = policy.dependsOn.filter((dep) => !completedTools.has(dep));
    if (missing.length > 0) {
      return { satisfied: false, missing };
    }

    return { satisfied: true };
  }

  /** Register or override a policy at runtime */
  register(policy: ToolExecutionPolicy): void {
    this._policies.set(policy.tool, policy);
  }

  /** All registered policies (snapshot) */
  all(): ToolExecutionPolicy[] {
    return [...this._policies.values()];
  }
}

/** Module-level singleton */
export const globalExecutionPolicy = new ExecutionPolicyRegistry();
