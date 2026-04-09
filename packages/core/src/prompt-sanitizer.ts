/**
 * prompt-sanitizer.ts — @dantecode/core
 *
 * Detection-and-audit function for suspicious patterns in user prompts.
 * Does NOT modify the input — only logs warnings for audit purposes.
 * The AI can handle unusual input; we just need visibility.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SanitizeResult {
  /** The original input, unchanged. */
  safe: string;
  /** Warning messages for any detected patterns. */
  warnings: string[];
  /** Always false — this function never modifies input. */
  modified: false;
}

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

interface DetectionRule {
  name: string;
  pattern: RegExp;
  description: string;
}

const DETECTION_RULES: DetectionRule[] = [
  // Shell injection
  {
    name: "backtick-expression",
    pattern: /`[^`]+`/,
    description: "Backtick shell expression detected",
  },
  {
    name: "command-substitution",
    pattern: /\$\([^)]+\)/,
    description: "Command substitution $(...) detected",
  },
  {
    name: "rm-pipe",
    pattern: /;\s*rm\b/i,
    description: "Potential rm command after semicolon",
  },
  {
    name: "sudo-pipe",
    pattern: /\|\s*sudo\b/i,
    description: "Pipe to sudo detected",
  },
  // Prompt injection
  {
    name: "ignore-previous-instructions",
    pattern: /ignore\s+previous\s+instructions/i,
    description: "Prompt injection attempt: 'ignore previous instructions'",
  },
  {
    name: "ignore-all-prior",
    pattern: /ignore\s+all\s+prior/i,
    description: "Prompt injection attempt: 'ignore all prior'",
  },
  {
    name: "system-prompt-keyword",
    pattern: /system\s+prompt\s*:/i,
    description: "Prompt injection attempt: 'system prompt:'",
  },
  {
    name: "new-instructions",
    pattern: /new\s+instructions\s*:/i,
    description: "Prompt injection attempt: 'new instructions:'",
  },
  // Path traversal
  {
    name: "unix-path-traversal",
    pattern: /\.\.\//,
    description: "Unix path traversal pattern ../../ detected",
  },
  {
    name: "windows-path-traversal",
    pattern: /\.\.\\/,
    description: "Windows path traversal pattern ..\\ detected",
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Audit a user prompt for suspicious patterns.
 *
 * Returns the input unchanged with a list of warnings.
 * `modified` is always `false` — this function never alters text.
 *
 * @param input - Raw user input string
 * @returns SanitizeResult with safe = input, warnings, modified = false
 */
export function sanitizeUserPrompt(input: string): SanitizeResult {
  const warnings: string[] = [];

  for (const rule of DETECTION_RULES) {
    if (rule.pattern.test(input)) {
      warnings.push(`[${rule.name}] ${rule.description}`);
    }
  }

  return {
    safe: input,
    warnings,
    modified: false,
  };
}
