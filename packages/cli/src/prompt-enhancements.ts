// ============================================================================
// @dantecode/cli — Prompt Enhancement Utilities
// Functions for improving LLM prompt quality: language detection, best practices,
// quick-fix for trivial violations, and targeted fix prompts.
// ============================================================================

import type { PDSEViolation } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Language Detection & Best Practices
// ----------------------------------------------------------------------------

const LANGUAGE_BEST_PRACTICES: Record<string, string> = {
  typescript:
    "Use strict types, avoid `any`, prefer `const` over `let`, use `readonly` where applicable. " +
    "Prefer interfaces for object shapes, use discriminated unions for state. " +
    "Handle null/undefined explicitly with optional chaining and nullish coalescing.",
  javascript:
    "Use `const` by default, `let` only when reassignment is needed. " +
    "Use optional chaining (?.) and nullish coalescing (??). Prefer async/await over raw Promises.",
  python:
    "Use type hints on all function signatures. Follow PEP 8 conventions. " +
    "Prefer f-strings for formatting. Use dataclasses or Pydantic for structured data. " +
    "Handle exceptions explicitly, avoid bare `except`.",
  go:
    "Handle errors explicitly — never ignore returned errors. Use interfaces for abstraction. " +
    "Follow Go idioms: short variable names in tight scopes, exported names are capitalized. " +
    "Prefer composition over inheritance.",
  rust:
    "Use Result<T, E> for error handling, avoid unwrap() in production code. " +
    "Prefer borrowing over ownership transfer. Use enums for state machines. " +
    "Leverage the type system to make invalid states unrepresentable.",
  java:
    "Use final for variables that don't change. Prefer composition over inheritance. " +
    "Use Optional<T> instead of null returns. Follow SOLID principles.",
  ruby:
    "Follow Ruby idioms: use symbols for keys, prefer blocks and iterators. " +
    "Use frozen_string_literal pragma. Prefer composition over inheritance.",
  cpp:
    "Use smart pointers (unique_ptr, shared_ptr) instead of raw pointers. " +
    "Prefer const references for function parameters. Use RAII for resource management.",
};

/**
 * Detects the primary language from file extensions when project config
 * doesn't specify one.
 */
export function detectLanguageFromFiles(filePaths: string[]): string {
  const counts = new Map<string, number>();
  const extMap: Record<string, string> = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".mjs": "javascript",
    ".py": "python", ".go": "go", ".rs": "rust",
    ".java": "java", ".rb": "ruby", ".cpp": "cpp", ".c": "cpp",
  };
  for (const fp of filePaths) {
    const idx = fp.lastIndexOf(".");
    if (idx === -1) continue;
    const ext = fp.slice(idx).toLowerCase();
    const lang = extMap[ext];
    if (lang) {
      counts.set(lang, (counts.get(lang) || 0) + 1);
    }
  }
  let best = "";
  let bestCount = 0;
  for (const [lang, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = lang;
    }
  }
  return best;
}

/**
 * Returns language-specific best practices text, or empty string if unknown.
 */
export function getLanguageBestPractices(language: string): string {
  if (!language) return "";
  const key = language.toLowerCase();
  return LANGUAGE_BEST_PRACTICES[key] || "";
}

// ----------------------------------------------------------------------------
// Fast Verify-Refine: Quick Fix for Trivial Violations
// ----------------------------------------------------------------------------

/**
 * Violation types that can be auto-fixed without an LLM round-trip.
 */
const QUICK_FIX_HANDLERS: Record<
  string,
  (code: string, violation: PDSEViolation) => string | null
> = {
  // Remove leftover console.log statements
  console_log_leftover: (code: string, violation: PDSEViolation) => {
    const line = violation.line;
    if (line == null) return null;
    const lines = code.split("\n");
    const idx = line - 1;
    if (idx < 0 || idx >= lines.length) return null;
    const target = lines[idx] as string;
    // Only remove if the line is purely a console.log statement
    if (/^\s*console\.log\s*\(.*\)\s*;?\s*$/.test(target)) {
      lines.splice(idx, 1);
      return lines.join("\n");
    }
    return null;
  },
  // Unused imports — flagged but auto-removal is risky
  import_unused: (_code: string, _violation: PDSEViolation) => {
    return null;
  },
};

/**
 * Attempts to fix trivial PDSE violations without an LLM round-trip.
 * Only handles safe, mechanical fixes (e.g., removing console.log lines).
 * Returns the fixed code and count of fixes applied, or null if nothing was fixable.
 *
 * @param code - The source code to fix
 * @param violations - Array of PDSE violations to attempt fixing
 * @returns Object with fixed code and fixedCount, or null if nothing was fixable
 */
export function tryQuickFix(
  code: string,
  violations: PDSEViolation[],
): { code: string; fixedCount: number } | null {
  let current = code;
  let fixedCount = 0;

  // Sort violations by line number descending so that removing a line at a higher
  // index does not shift the indices of lines above it (bottom-up processing).
  const sorted = [...violations]
    .filter((v) => v.line != null)
    .sort((a, b) => (b.line ?? 0) - (a.line ?? 0));

  for (const violation of sorted) {
    const handler = QUICK_FIX_HANDLERS[violation.type];
    if (!handler) continue;

    const result = handler(current, violation);
    if (result !== null) {
      current = result;
      fixedCount++;
    }
  }

  if (fixedCount === 0) return null;
  return { code: current, fixedCount };
}

/**
 * Builds a targeted fix prompt for the LLM when PDSE verification fails.
 * Instead of re-generating from scratch, this focuses the model on specific violations.
 *
 * @param filePath - Path to the file that failed verification
 * @param violations - The specific violations found
 * @param code - The current file content
 * @returns A focused prompt string for the model
 */
export function buildTargetedFixPrompt(
  filePath: string,
  violations: PDSEViolation[],
  code: string,
): string {
  const violationList = violations
    .map((v) => {
      const loc = v.line != null ? ` (line ${v.line})` : "";
      return `- [${v.severity}] ${v.type}${loc}: ${v.message}`;
    })
    .join("\n");

  // Show a window of code around violations for context (avoid sending entire file)
  const relevantLines = new Set<number>();
  for (const v of violations) {
    if (v.line != null) {
      for (let i = Math.max(1, v.line - 3); i <= v.line + 3; i++) {
        relevantLines.add(i);
      }
    }
  }

  let codeSnippet: string;
  if (relevantLines.size > 0) {
    const lines = code.split("\n");
    const snippetLines = Array.from(relevantLines)
      .sort((a, b) => a - b)
      .filter((n) => n <= lines.length)
      .map((n) => `${n}: ${lines[n - 1]}`);
    codeSnippet = snippetLines.join("\n");
  } else {
    // No line numbers available — send first 50 lines as context
    codeSnippet = code.split("\n").slice(0, 50).join("\n");
  }

  return [
    `## Targeted Fix Required: ${filePath}`,
    "",
    "The following PDSE violations were detected in your recent code generation.",
    "Fix ONLY these specific violations without changing unrelated code.",
    "",
    "### Violations",
    violationList,
    "",
    "### Relevant Code",
    "```",
    codeSnippet,
    "```",
    "",
    "Use the Edit tool to fix each violation. Do not rewrite unrelated sections.",
  ].join("\n");
}
