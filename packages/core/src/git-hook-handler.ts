/**
 * git-hook-handler.ts
 *
 * Git hook parser and event converter.
 *
 * Parses raw hook arguments into structured {@link GitHookPayload} objects,
 * converts them to {@link DanteEvent}-compatible data, and can install/query
 * hook scripts in a project's `.git/hooks/` directory.
 */

import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { DanteEventType } from "./event-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Subset of Git hooks that DanteCode natively understands. */
export type GitHookType =
  | "pre-commit"
  | "post-commit"
  | "pre-push"
  | "post-merge"
  | "pre-rebase";

/** Structured payload extracted from a Git hook invocation. */
export interface GitHookPayload {
  /** Which hook was fired. */
  hookType: GitHookType;
  /** Current branch name at the time of the hook. */
  branch: string;
  /** HEAD commit SHA (populated where available). */
  commitHash?: string;
  /** Remote ref (e.g. `refs/heads/main`) — populated for pre-push. */
  remoteRef?: string;
  /** Local ref — populated for pre-push. */
  localRef?: string;
  /** List of staged/affected files (populated where derivable). */
  files?: string[];
}

/** Injectable filesystem functions for testing. */
export interface GitHookHandlerOptions {
  /** Injectable fs for testing. */
  fsFn?: {
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
    readFile: typeof readFile;
  };
}

// ---------------------------------------------------------------------------
// Hook → DanteEventType mapping
// ---------------------------------------------------------------------------

const HOOK_TO_EVENT_TYPE: Record<GitHookType, DanteEventType> = {
  "pre-commit": "git:commit",
  "post-commit": "git:commit",
  "pre-push": "git:push",
  "post-merge": "git:merge",
  "pre-rebase": "git:rebase",
};

// ---------------------------------------------------------------------------
// GitHookHandler
// ---------------------------------------------------------------------------

/**
 * GitHookHandler
 *
 * Bridges native Git hooks with the DanteCode event engine.  It can:
 *
 * 1. Parse raw hook arguments into a {@link GitHookPayload}.
 * 2. Convert a payload into the `(type, eventPayload)` pair expected by
 *    {@link EventEngine.enqueue}.
 * 3. Install thin shell scripts into `.git/hooks/` that forward hook
 *    invocations to a DanteCode handler.
 * 4. Query which hooks are currently installed.
 *
 * @example
 * ```ts
 * const handler = new GitHookHandler("/path/to/repo");
 *
 * // Parse from inside a pre-commit script
 * const payload = handler.parseHookEvent("pre-commit", process.argv.slice(2));
 * const { type, eventPayload } = handler.toDanteEvent(payload);
 * await engine.enqueue(type, eventPayload, "git-hook");
 *
 * // Install hooks
 * await handler.installHooks(["pre-commit", "pre-push"]);
 * ```
 */
export class GitHookHandler {
  private readonly projectRoot: string;
  private readonly fs: {
    writeFile: typeof writeFile;
    mkdir: typeof mkdir;
    readFile: typeof readFile;
  };

  constructor(projectRoot: string, options: GitHookHandlerOptions = {}) {
    this.projectRoot = projectRoot;
    this.fs = options.fsFn ?? { writeFile, mkdir, readFile };
  }

  // -------------------------------------------------------------------------
  // Parsing
  // -------------------------------------------------------------------------

  /**
   * Parse raw hook arguments (as received by the hook script) into a
   * structured {@link GitHookPayload}.
   *
   * Argument conventions per hook type:
   *
   * | Hook         | args[0]           | args[1]      |
   * |--------------|-------------------|--------------|
   * | pre-commit   | (none)            | —            |
   * | post-commit  | (none)            | —            |
   * | pre-push     | remote name       | remote URL   |
   * | post-merge   | "1" if squash     | —            |
   * | pre-rebase   | upstream branch   | rebased branch |
   *
   * Branch is read from the `DANTE_BRANCH` environment variable when set,
   * otherwise falls back to `"main"`.
   *
   * @param hookType  The type of hook being processed.
   * @param rawArgs   `process.argv.slice(2)` as passed to the hook script.
   */
  parseHookEvent(hookType: GitHookType, rawArgs: string[]): GitHookPayload {
    const branch =
      process.env["DANTE_BRANCH"] ??
      process.env["GIT_BRANCH"] ??
      "main";

    const base: GitHookPayload = { hookType, branch };

    switch (hookType) {
      case "pre-commit": {
        // No meaningful arguments for pre-commit.
        return base;
      }

      case "post-commit": {
        // Optionally read HEAD commit hash from environment.
        const commitHash = process.env["GIT_COMMIT"] ?? undefined;
        return { ...base, commitHash };
      }

      case "pre-push": {
        // args[0] = remote name, args[1] = remote URL
        const remoteRef = rawArgs[0] ?? undefined;
        const localRef = rawArgs[1] ?? undefined;
        return { ...base, remoteRef, localRef };
      }

      case "post-merge": {
        // args[0] = "1" if squash merge, "0" otherwise
        const squash = rawArgs[0] === "1";
        return {
          ...base,
          // Encode squash as a boolean in the files array for compatibility.
          files: squash ? ["squash"] : [],
        };
      }

      case "pre-rebase": {
        // args[0] = upstream branch, args[1] = branch being rebased
        const remoteRef = rawArgs[0] ?? undefined;
        const localRef = rawArgs[1] ?? undefined;
        return { ...base, remoteRef, localRef };
      }

      default:
        return base;
    }
  }

  // -------------------------------------------------------------------------
  // Conversion
  // -------------------------------------------------------------------------

  /**
   * Convert a {@link GitHookPayload} into the `(type, eventPayload)` pair
   * accepted by {@link EventEngine.enqueue}.
   *
   * @returns An object with:
   *   - `type` — the {@link DanteEventType} corresponding to `hookType`.
   *   - `eventPayload` — a plain record suitable for `DanteEvent.payload`.
   */
  toDanteEvent(payload: GitHookPayload): {
    type: DanteEventType;
    eventPayload: Record<string, unknown>;
  } {
    const type = HOOK_TO_EVENT_TYPE[payload.hookType];

    const eventPayload: Record<string, unknown> = {
      hookType: payload.hookType,
      branch: payload.branch,
    };

    if (payload.commitHash !== undefined) {
      eventPayload["commitHash"] = payload.commitHash;
    }
    if (payload.remoteRef !== undefined) {
      eventPayload["remoteRef"] = payload.remoteRef;
    }
    if (payload.localRef !== undefined) {
      eventPayload["localRef"] = payload.localRef;
    }
    if (payload.files !== undefined) {
      eventPayload["files"] = payload.files;
    }

    return { type, eventPayload };
  }

  // -------------------------------------------------------------------------
  // Installation
  // -------------------------------------------------------------------------

  /**
   * Install shell hook scripts into `.git/hooks/` for each supplied hook type.
   *
   * Each generated script:
   * 1. Is a POSIX sh script with the `#!/bin/sh` shebang.
   * 2. Delegates to `node .dantecode/hooks/handler.js <hookType>`, forwarding
   *    all arguments.
   * 3. Exits with `0` so that Git is never blocked by the hook.
   *
   * The `.git/hooks/` directory is created if it does not already exist.
   *
   * @param hooks List of hook types to install.
   */
  async installHooks(hooks: GitHookType[]): Promise<void> {
    const hooksDir = join(this.projectRoot, ".git", "hooks");

    await this.fs.mkdir(hooksDir, { recursive: true });

    for (const hookType of hooks) {
      const scriptContent = this.buildHookScript(hookType);
      const hookPath = join(hooksDir, hookType);
      await this.fs.writeFile(hookPath, scriptContent, { mode: 0o755 });
    }
  }

  /**
   * Query which of the known DanteCode hooks are currently installed in
   * `.git/hooks/`.
   *
   * A hook is considered installed if the file exists (readFile does not
   * throw).
   *
   * @returns Array of installed {@link GitHookType} values (may be empty).
   */
  async getInstalledHooks(): Promise<GitHookType[]> {
    const hooksDir = join(this.projectRoot, ".git", "hooks");
    const allHooks: GitHookType[] = [
      "pre-commit",
      "post-commit",
      "pre-push",
      "post-merge",
      "pre-rebase",
    ];
    const installed: GitHookType[] = [];

    for (const hookType of allHooks) {
      const hookPath = join(hooksDir, hookType);
      try {
        await this.fs.readFile(hookPath, "utf8");
        installed.push(hookType);
      } catch {
        // File does not exist — hook not installed.
      }
    }

    return installed;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Generate the shell script content for a given hook type.
   *
   * @param hookType The hook to generate a script for.
   */
  private buildHookScript(hookType: GitHookType): string {
    return [
      "#!/bin/sh",
      "# Auto-generated by DanteCode git-hook-handler. Do not edit manually.",
      `node .dantecode/hooks/handler.js ${hookType} "$@"`,
      "exit 0",
      "",
    ].join("\n");
  }
}
