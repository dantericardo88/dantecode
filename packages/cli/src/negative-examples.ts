// ============================================================================
// packages/cli/src/negative-examples.ts
//
// Behavioral guardrails: trigger-matched "what NOT to do" patterns.
//
// Harvested from:
//   - Aider's lazy/overeager guardrail pattern (single-line, zero-ambiguity)
//   - DanteCode's own failure corpus (blind edits, partial renames, mock tests)
//   - Claude Code's scope-enforcement rules
//
// Design:
//   - Each entry has a regex trigger and a concise "Do NOT..." instruction
//   - selectNegativeExamples() picks the top 3 most relevant for a given prompt
//   - Injected into system prompt as "## What NOT to Do" section
//   - Zero imports from agent-loop or slash-commands
// ============================================================================

export interface NegativeExample {
  /** Regex matched against the user's prompt (case-insensitive). */
  trigger: RegExp;
  /** Short, imperative instruction. Always begins with "Do NOT". */
  instruction: string;
}

// ----------------------------------------------------------------------------
// The Bank
// ----------------------------------------------------------------------------

export const NEGATIVE_EXAMPLES: NegativeExample[] = [
  // Scope enforcement — Aider's most effective single-line guardrail
  {
    trigger: /implement|build|create|add|write/i,
    instruction:
      "Do NOT add features, refactor code, or make improvements beyond what was explicitly asked. Do what was requested — no more.",
  },
  // Blind editing — Claude Code's #1 failure mode prevention
  {
    trigger: /implement|build|create|edit|fix|update|change|modify/i,
    instruction:
      "Do NOT start editing files before reading them. Read every file you intend to change before writing a single edit. Blind edits introduce regressions.",
  },
  // Partial renames — DanteCode failure corpus
  {
    trigger: /refactor|rename|move|restructure/i,
    instruction:
      "Do NOT rename, move, or restructure code without first finding ALL usages with Grep. Partial renames silently break the codebase.",
  },
  // Mock abuse — prevents empty tests
  {
    trigger: /test|spec|describe|it\(/i,
    instruction:
      "Do NOT write tests that mock the exact behavior being tested. Tests that mock everything verify nothing. Test real behavior with real inputs.",
  },
  // Guessing errors — diagnose before fixing
  {
    trigger: /fix|repair|debug|error|fail|broken/i,
    instruction:
      "Do NOT guess at the cause of an error. Read the error message carefully. Grep for the failing symbol. Read the file at the reported line. Then edit.",
  },
  // Stub generation — anti-confabulation
  {
    trigger: /implement|write|create|generate|produce/i,
    instruction:
      "Do NOT produce stub implementations with TODO comments, placeholder functions, or ellipsis ('...'). Every function must be complete and production-ready.",
  },
  // Force pushing / destructive git
  {
    trigger: /push|deploy|merge|commit/i,
    instruction:
      "Do NOT run destructive git commands (reset --hard, clean -f, push --force) unless explicitly instructed. Prefer non-destructive alternatives.",
  },
  // Over-broad deletes
  {
    trigger: /delete|remove|clean|purge/i,
    instruction:
      "Do NOT delete files or directories without confirming they are no longer referenced. Use Grep to verify no remaining usages before removing.",
  },
  // Speculative abstractions
  {
    trigger: /refactor|abstract|generalize|extract|reuse/i,
    instruction:
      "Do NOT create abstractions, helpers, or utilities for one-time operations. The right amount of complexity is what the task actually requires.",
  },
  // Config/credential exposure
  {
    trigger: /env|config|secret|key|token|password|credential/i,
    instruction:
      "Do NOT commit or log secrets, API keys, tokens, or passwords. Check .gitignore before staging .env or config files.",
  },
  // Type-casting shortcuts
  {
    trigger: /typescript|type|interface|type error/i,
    instruction:
      "Do NOT silence TypeScript errors with 'as any', '@ts-ignore', or type assertions that hide real type mismatches. Fix the actual type.",
  },
  // Premature success claims
  {
    trigger: /.*/i, // always included — universal guardrail
    instruction:
      "Do NOT claim a task is complete without verifying it. A file edit is not done until Read confirms it. A test is not passing until the test runner output confirms it.",
  },
];

// ----------------------------------------------------------------------------
// Selection
// ----------------------------------------------------------------------------

/**
 * Select the most relevant negative examples for a given user prompt.
 * Returns at most `limit` examples, with the universal guardrail always last.
 */
export function selectNegativeExamples(prompt: string, limit = 3): NegativeExample[] {
  // The last entry is always the universal guardrail
  const universal = NEGATIVE_EXAMPLES[NEGATIVE_EXAMPLES.length - 1] as NegativeExample;
  const candidates = NEGATIVE_EXAMPLES.slice(0, -1); // all except universal

  const matched = candidates.filter((ex) => ex.trigger.test(prompt));

  // Deduplicate by instruction text (multiple triggers may select the same example)
  const seen = new Set<string>();
  const deduped: NegativeExample[] = [];
  for (const ex of matched) {
    if (!seen.has(ex.instruction)) {
      seen.add(ex.instruction);
      deduped.push(ex);
    }
  }

  // Take up to (limit - 1) matched examples, then always add the universal guardrail
  const selected = deduped.slice(0, limit - 1);
  selected.push(universal);
  return selected;
}

// ----------------------------------------------------------------------------
// Formatting
// ----------------------------------------------------------------------------

/**
 * Format selected negative examples into a system prompt section.
 */
export function formatNegativeExamples(examples: NegativeExample[]): string {
  if (examples.length === 0) return "";
  const lines = ["## What NOT to Do", ""];
  for (const ex of examples) {
    lines.push(`- ${ex.instruction}`);
  }
  return lines.join("\n");
}
