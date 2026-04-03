/**
 * error-suggestions.ts
 *
 * Smart error messages with context-aware suggestions.
 * Inspired by Rust compiler errors, TypeScript diagnostics, and Git's helpful hints.
 *
 * Features:
 * - "Did you mean..." suggestions for typos
 * - Context-aware next steps
 * - Common pitfalls and solutions
 * - Links to documentation
 */

import { fuzzyScore } from "./fuzzy-finder.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ErrorSuggestion {
  /** The suggestion text */
  message: string;
  /** Suggested command or action (optional) */
  command?: string;
  /** Link to docs (optional) */
  docs?: string;
}

export interface EnhancedError {
  /** Main error message */
  error: string;
  /** List of suggestions */
  suggestions: ErrorSuggestion[];
  /** Optional context help */
  context?: string;
}

// ---------------------------------------------------------------------------
// Command Typo Detection
// ---------------------------------------------------------------------------

/**
 * Find the closest matching command for a typo.
 * Uses fuzzy matching to suggest corrections.
 */
export function suggestCommand(
  typo: string,
  availableCommands: string[],
  threshold = 0.3,
): string[] {
  const matches = availableCommands
    .map((cmd) => ({
      command: cmd,
      score: fuzzyScore(cmd, typo).score,
    }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((m) => m.command);

  return matches;
}

// ---------------------------------------------------------------------------
// Common Error Patterns
// ---------------------------------------------------------------------------

/**
 * Enhance error messages with context and suggestions.
 */
export function enhanceError(error: Error | string, context?: { command?: string }): EnhancedError {
  const errorMsg = typeof error === "string" ? error : error.message;
  const lowerError = errorMsg.toLowerCase();

  // File not found errors
  if (lowerError.includes("enoent") || lowerError.includes("no such file")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Check that the file path is correct and the file exists",
          command: "/find",
        },
        {
          message: "Use /find to browse available files interactively",
          command: "/find",
        },
        {
          message: "Paths should be relative to project root or absolute",
        },
      ],
    };
  }

  // Permission errors
  if (lowerError.includes("eacces") || lowerError.includes("permission denied")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Check file permissions (chmod +x for executables)",
        },
        {
          message: "You may need to run with elevated privileges",
        },
        {
          message: "On Windows, ensure no process has the file locked",
        },
      ],
    };
  }

  // Git errors
  if (lowerError.includes("not a git repository")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Initialize a git repository",
          command: "git init",
        },
        {
          message: "Navigate to a directory with a git repository",
        },
      ],
    };
  }

  if (lowerError.includes("nothing to commit")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Make some changes first, then commit",
        },
        {
          message: "Use /diff to see pending changes",
          command: "/diff",
        },
      ],
    };
  }

  if (lowerError.includes("merge conflict")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Resolve conflicts manually in affected files",
        },
        {
          message: "After resolving, use git add to stage changes",
          command: "git add <file>",
        },
        {
          message: "Then commit with /commit",
          command: "/commit",
        },
      ],
    };
  }

  // API/Network errors
  if (lowerError.includes("econnrefused") || lowerError.includes("network")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Check your internet connection",
        },
        {
          message: "Verify API endpoint URL and credentials",
        },
        {
          message: "Check if a firewall is blocking the connection",
        },
      ],
    };
  }

  if (lowerError.includes("rate limit") || lowerError.includes("429")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Wait a few minutes before retrying",
        },
        {
          message: "Check API usage limits in your provider dashboard",
        },
        {
          message: "Consider upgrading your API plan if needed",
        },
      ],
    };
  }

  // Module/dependency errors
  if (lowerError.includes("cannot find module") || lowerError.includes("module not found")) {
    const match = errorMsg.match(/['"]([^'"]+)['"]/);
    const moduleName = match?.[1];

    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Install dependencies",
          command: "npm install",
        },
        ...(moduleName
          ? [
              {
                message: `Install the specific module: npm install ${moduleName}`,
                command: `npm install ${moduleName}`,
              },
            ]
          : []),
        {
          message: "Check that package.json includes all required dependencies",
        },
      ],
    };
  }

  // Syntax errors
  if (lowerError.includes("syntaxerror") || lowerError.includes("unexpected token")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Check for typos or missing brackets/quotes in your code",
        },
        {
          message: "Run your linter to find syntax issues",
          command: "npm run lint",
        },
        {
          message: "Verify file encoding (should be UTF-8)",
        },
      ],
    };
  }

  // Memory errors
  if (
    lowerError.includes("out of memory") ||
    lowerError.includes("heap") ||
    lowerError.includes("javascript heap")
  ) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Increase Node.js memory limit",
          command: "NODE_OPTIONS=--max-old-space-size=4096 npm run build",
        },
        {
          message: "Process files in smaller batches",
        },
        {
          message: "Check for memory leaks in your code",
        },
      ],
    };
  }

  // TypeScript errors
  if (lowerError.includes("ts(") || lowerError.includes("ts2") || lowerError.includes("error ts")) {
    return {
      error: errorMsg,
      suggestions: [
        {
          message: "Run typecheck to see full error details",
          command: "npm run typecheck",
        },
        {
          message: "Check TypeScript configuration in tsconfig.json",
        },
      ],
    };
  }

  // Generic fallback
  return {
    error: errorMsg,
    suggestions: [
      {
        message: "Check the error details above for specific issues",
      },
      {
        message: "Try /help to see available commands",
        command: "/help",
      },
    ],
    context: context?.command ? `Error occurred while running: ${context.command}` : undefined,
  };
}

// ---------------------------------------------------------------------------
// Error Formatting
// ---------------------------------------------------------------------------

/**
 * Format an enhanced error for display in the terminal.
 */
export function formatEnhancedError(enhanced: EnhancedError, colors = true): string {
  const RED = colors ? "\x1b[31m" : "";
  const YELLOW = colors ? "\x1b[33m" : "";
  const CYAN = colors ? "\x1b[36m" : "";
  const DIM = colors ? "\x1b[2m" : "";
  const BOLD = colors ? "\x1b[1m" : "";
  const RESET = colors ? "\x1b[0m" : "";

  const lines: string[] = [];

  // Error header
  lines.push(`${RED}${BOLD}Error:${RESET} ${enhanced.error}`);
  lines.push("");

  // Context (if any)
  if (enhanced.context) {
    lines.push(`${DIM}${enhanced.context}${RESET}`);
    lines.push("");
  }

  // Suggestions
  if (enhanced.suggestions.length > 0) {
    lines.push(`${YELLOW}Suggestions:${RESET}`);
    for (const suggestion of enhanced.suggestions) {
      lines.push(`  ${CYAN}•${RESET} ${suggestion.message}`);
      if (suggestion.command) {
        lines.push(`    ${DIM}→ ${suggestion.command}${RESET}`);
      }
      if (suggestion.docs) {
        lines.push(`    ${DIM}📖 ${suggestion.docs}${RESET}`);
      }
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Context-Aware Help
// ---------------------------------------------------------------------------

/**
 * Generate contextual help based on recent commands/errors.
 */
export function getContextualHelp(context: {
  recentCommands?: string[];
  recentErrors?: string[];
  filesInContext?: number;
}): string[] {
  const hints: string[] = [];

  // No files in context
  if (context.filesInContext === 0) {
    hints.push("Tip: Add files to context with /add or /find before asking questions");
  }

  // Too many files in context
  if (context.filesInContext && context.filesInContext > 20) {
    hints.push("Tip: You have many files in context. Use /drop to remove unused files");
  }

  // Frequent /help usage
  if (context.recentCommands?.filter((c) => c === "help").length! >= 3) {
    hints.push("Tip: Try /tutorial for interactive learning");
  }

  // Repeated errors
  if (context.recentErrors && context.recentErrors.length >= 3) {
    const uniqueErrors = new Set(context.recentErrors.map((e) => e.toLowerCase()));
    if (uniqueErrors.size === 1) {
      hints.push("Tip: The same error keeps occurring. Try a different approach");
    }
  }

  return hints;
}
