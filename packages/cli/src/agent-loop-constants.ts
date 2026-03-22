// ============================================================================
// @dantecode/cli — Agent Loop Constants
// Extracted from agent-loop.ts for maintainability.
// ============================================================================

// ----------------------------------------------------------------------------
// ANSI Colors
// ----------------------------------------------------------------------------

export const CYAN = "\x1b[36m";
export const YELLOW = "\x1b[33m";
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const DIM = "\x1b[2m";
export const BOLD = "\x1b[1m";
export const RESET = "\x1b[0m";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/** How often (in tool calls) to emit a progress line. */
export const PROGRESS_EMIT_INTERVAL = 5;

/** Planning instruction injected for complex tasks. */
export const PLANNING_INSTRUCTION =
  "Before executing, create a brief plan:\n" +
  "1. What files need to change and why?\n" +
  "2. What's the approach? (Read → Edit → Verify cycle)\n" +
  "3. What could go wrong? (edge cases, breaking changes, missing imports)\n" +
  "4. What's the verification strategy? (tests, typecheck, manual check)\n" +
  "Then execute the plan step by step. After each major change, verify before moving on.";

/** Pivot instruction injected after 2 consecutive same-signature failures. */
export const PIVOT_INSTRUCTION =
  "The same approach has failed twice. STOP and reconsider:\n" +
  "- What assumption might be wrong?\n" +
  "- Is there an alternative tool or method?\n" +
  "- Should we read more context first?";

export const EXECUTION_CONTINUATION_PATTERN = /^(?:please\s+)?(?:continue|resume|run|verify)\b/i;

export const EXECUTION_WORKFLOW_PATTERN =
  /^\/(?:autoforge|party|magic|forge|verify|ship|inferno|ember|blaze|spark|oss|harvest)\b/i;

/**
 * Destructive git commands that must never run during a pipeline/workflow execution.
 * These wipe untracked files or discard all in-progress changes — undoing everything
 * an agent has written. Blocked for ALL models (Grok, GPT, Claude) inside pipelines.
 */
export const DESTRUCTIVE_GIT_RE =
  /\bgit\s+(?:clean\b|checkout\s+--\s+[./]|reset\s+--(?:hard|merge)\b|stash(?:\s+push)?\b[^\n]*--include-untracked)/;

/**
 * Blocks `rm -rf` (and variants) on source/package directories during pipeline execution.
 */
export const RM_SOURCE_RE =
  /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*|-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*|--recursive\b)[^\n]*\b(?:packages|src|lib)\//;

/** Detects premature wrap-up responses that should trigger pipeline continuation. */
export const PREMATURE_SUMMARY_PATTERN =
  /(?:^|\n)\s*(?:#{1,3}\s*)?(?:summary|results?|complete|done|finished|all\s+(?:done|complete)|pipeline\s+complete|git\s+status|verification\s+results?|changes?\s+made|next\s+steps?|recommendations?)/i;

/**
 * Grok-specific confabulation detector: fake verification tables, fake git status, fake PDSE
 * scores. These patterns appear when Grok narrates what it "did" without using Edit/Write tools.
 */
export const GROK_CONFAB_PATTERN =
  /\b(?:typecheck[:\s]+(?:PASS|✅)|lint[:\s]+(?:PASS|✅)|test(?:s|ing)?[:\s]+(?:PASS|✅|\d+\/\d+)|pushed?\s+to\s+origin|files?\s+changed.*\+\d+\s+lines?|PDSE\s+score|no\s+further\s+tools?\s+needed|turbo\s+(?:typecheck|lint|test)\s*[:\s]*(?:PASS|pass|\d+))/im;

/** Max pipeline continuation nudges before allowing the model to stop. */
export const MAX_PIPELINE_CONTINUATION_NUDGES = 3;

/** Pipeline continuation instruction injected when the model stops mid-pipeline. */
export const PIPELINE_CONTINUATION_INSTRUCTION =
  "You stopped mid-pipeline with a summary/status response, but the task is NOT complete. " +
  "The pipeline still has remaining steps. Do NOT summarize — continue executing the next " +
  "step immediately with tool calls. If you are unsure what step is next, re-read your " +
  "todo list or the pipeline plan and continue from where you left off.";

// ----------------------------------------------------------------------------
// Anti-confabulation guards
// ----------------------------------------------------------------------------

/** Max consecutive empty responses (no text + no tool calls) before aborting. */
export const MAX_CONSECUTIVE_EMPTY_ROUNDS = 3;

/** Max anti-confabulation nudges (model claims completion but 0 files modified). */
export const MAX_CONFABULATION_NUDGES = 4;

// ----------------------------------------------------------------------------
// Structured reasoning checkpoints
// ----------------------------------------------------------------------------

/** How many tool calls between automatic reflection checkpoints. */
export const REFLECTION_CHECKPOINT_INTERVAL = 15;

/** Reflection prompt injected at checkpoints to force chain-of-thought reasoning. */
export const REFLECTION_PROMPT =
  "REFLECTION CHECKPOINT: Pause and evaluate your progress.\n" +
  "1. What have you accomplished so far?\n" +
  "2. Are you on track to solve the original problem?\n" +
  "3. Have you missed anything (untested edge cases, unread files, incomplete changes)?\n" +
  "4. What is the most important next step?\n" +
  "Continue with the most impactful action.";

/** Write payload size (chars) above which a truncation warning is emitted. */
export const WRITE_SIZE_WARNING_THRESHOLD = 30_000;

/** Warning injected when model returns empty response. */
export const EMPTY_RESPONSE_WARNING =
  "You returned an empty response with no tool calls. This may indicate a compatibility " +
  "issue. Execute the next step using a tool (Read, Edit, Write, Bash, Glob, Grep). " +
  "If you cannot proceed, explain what is blocking you.";

/**
 * Warning injected when model claims completion but no files were modified.
 * Strong language required: Grok ignores polite nudges and keeps confabulating.
 */
export const CONFABULATION_WARNING =
  "CONFABULATION DETECTED: You have read files and/or claimed to have implemented changes, " +
  "but ZERO files were actually written in this session (filesModified === 0). " +
  "Running `git status` would show 0 changed files. " +
  "\n\nDo NOT write planning text, summaries, or fake verification results. " +
  "\nYour VERY NEXT response MUST contain a Write or Edit tool call to create/modify a real file. " +
  "\n\nSteps to unblock:" +
  "\n1. Pick the FIRST file from your implementation plan (e.g. a new .ts file you planned to create)" +
  "\n2. Use the Write tool to create it with complete, production-ready code" +
  "\n3. Only AFTER real file changes: run Bash for typecheck/lint/test" +
  "\n\nDo NOT claim 'typecheck PASS', 'committed', 'pushed', or 'PDSE score' unless " +
  "you actually ran those commands with the Bash tool and got real output.";
