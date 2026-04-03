// ============================================================================
// @dantecode/cli — Command Translator
// Translates blocked `cd ... &&` commands to equivalent single-command forms
// that execute from the repo root.
// ============================================================================

/**
 * Result of translating a blocked cd command.
 */
export interface TranslationResult {
  suggested: string;
  explanation: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Translates a `cd <dir> && <command>` pattern to an equivalent command
 * that runs from the repository root.
 *
 * @param command - The original command with cd chain
 * @returns Translation result with suggested alternative
 *
 * @example
 * translateCdCommand('cd frontend && npm install')
 * // => { suggested: 'npm --prefix frontend install', confidence: 'high', ... }
 */
export function translateCdCommand(command: string): TranslationResult {
  const match = command.match(/^cd\s+(.+?)\s*&&\s*(.+)$/);
  if (!match) {
    return {
      suggested: command,
      explanation: "Not a cd chain command",
      confidence: "low",
    };
  }

  const dir = match[1];
  const rest = match[2];
  if (!dir || !rest) {
    return {
      suggested: command,
      explanation: "Invalid cd chain format",
      confidence: "low",
    };
  }

  const cleanDir = dir.trim().replace(/^["']|["']$/g, "");
  const cleanRest = rest.trim();

  // npm commands: use --prefix
  if (cleanRest.startsWith("npm ")) {
    return {
      suggested: `npm --prefix ${cleanDir} ${cleanRest.slice(4)}`,
      explanation: "npm --prefix runs the command in the specified directory from repo root",
      confidence: "high",
    };
  }

  // pnpm commands: use -C
  if (cleanRest.startsWith("pnpm ")) {
    return {
      suggested: `pnpm -C ${cleanDir} ${cleanRest.slice(5)}`,
      explanation: "pnpm -C changes the working directory before executing the command",
      confidence: "high",
    };
  }

  // yarn commands: use --cwd
  if (cleanRest.startsWith("yarn ")) {
    return {
      suggested: `yarn --cwd ${cleanDir} ${cleanRest.slice(5)}`,
      explanation: "yarn --cwd specifies the working directory for the command",
      confidence: "high",
    };
  }

  // turbo commands: use --cwd
  if (cleanRest.startsWith("turbo ")) {
    return {
      suggested: `turbo ${cleanRest.slice(6)} --cwd ${cleanDir}`,
      explanation: "turbo --cwd runs the command in the specified directory",
      confidence: "high",
    };
  }

  // drizzle-kit: use --config with adjusted path
  if (cleanRest.startsWith("npx drizzle-kit") || cleanRest.startsWith("drizzle-kit")) {
    return {
      suggested: `(cd ${cleanDir} && ${cleanRest})`,
      explanation:
        "drizzle-kit requires running in the project directory (uses relative paths). Use subshell ( ) to isolate directory change.",
      confidence: "medium",
    };
  }

  // Generic: use subshell (works for any command, but less explicit)
  return {
    suggested: `(cd ${cleanDir} && ${cleanRest})`,
    explanation:
      "Subshell ( ) executes commands in a separate process, automatically returning to original directory after completion",
    confidence: "medium",
  };
}
