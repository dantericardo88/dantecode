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
/**
 * Display thinking indicator based on mode.
 * @param mode The thinking display mode to use
 * @param budget Remaining thinking budget (for progress-bar mode)
 */
export function displayThinking(
  mode: "spinner" | "progress-bar" | "disabled" | "compact",
  budget?: number,
): void {
  if (mode === "disabled") {
    return; // No output
  }

  let output = "";
  if (mode === "spinner") {
    output = `${DIM}┌ Thinking...${RESET}\n`;
  } else if (mode === "progress-bar") {
    if (budget !== undefined && budget > 0) {
      const width = 20; // Fixed width for progress bar
      const pct = Math.min(1, Math.max(0, budget / 10000)); // Assume 10k max for demonstration
      const filled = Math.round(pct * width);
      const empty = width - filled;
      const bar = `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
      output = `${DIM}${bar} ${Math.round(pct * 100)}% tokens remaining${RESET}\n`;
    } else {
      output = `${DIM}[░░░░░░░░░░░░░░░░░░░░] Thinking...${RESET}\n`;
    }
  } else if (mode === "compact") {
    output = `${DIM}(…)${RESET}\n`;
  }

  if (output) {
    process.stdout.write(output);
  }
}

// ----------------------------------------------------------------------------
/**
 * Estimate prompt complexity and return appropriate round allocation.
 * Used for dynamic maxToolRounds allocation based on prompt characteristics.
 *
 * @param prompt The user's prompt text
 * @returns Number of rounds to allocate (5, 10, or 20)
 */
export function estimatePromptComplexity(prompt: string): number {
  const lower = prompt.toLowerCase();
  const wordCount = prompt.split(/\s+/).length;

  // Complex indicators: architectural changes, migrations, refactors
  const complexKeywords = ['refactor', 'migrate', 'architecture', 'redesign', 'restructure'];
  const isComplex = complexKeywords.some(k => lower.includes(k)) || wordCount > 200;
  if (isComplex) return 20;

  // Medium indicators: logic changes, bug fixes, multi-file
  const mediumKeywords = ['fix bug', 'implement', 'add feature', 'update logic'];
  const isMedium = mediumKeywords.some(k => lower.includes(k)) || wordCount > 100;
  if (isMedium) return 10;

  // Simple: parsing, config, single-line changes
  return 5;
}

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

/** Plan mode instruction: forces the model to output a structured plan. */
export const PLAN_MODE_INSTRUCTION =
  "You are in PLAN MODE. You must create a detailed execution plan BEFORE making any changes.\n\n" +
  "Output a numbered plan with the following format for each step:\n" +
  "1. Description of what to do\n" +
  "   Files: path/to/file1.ts, path/to/file2.ts\n" +
  "   Verify: npm test (or other verification command)\n" +
  "   Depends: (step numbers this depends on, if any)\n\n" +
  "Rules:\n" +
  "- You may use Read, Glob, Grep, WebSearch, and WebFetch to explore the codebase\n" +
  "- You may NOT use Write, Edit, Bash, GitCommit, or any tool that modifies files\n" +
  "- Strictly enforce task boundaries: no adjacent exploration/fixes unless explicitly asked\n" +
  "- After generating your plan, summarize it clearly for user approval\n" +
  "- Wait for the user to approve before proceeding with any implementation";

export const TASK_BOUNDARY_INSTRUCTION =
  "STRICT TASK BOUNDARY INSTRUCTION: Instruct model to stop after completion, propose next steps only for out of scope, refuse edits/builds/fallbacks/exploration. " +
  "Integrate with existing PLAN_MODE_INSTRUCTION. Ensure no stubs.\n\n" +
  "Stay strictly within the exact requested task. Prohibited: file edits, builds, fallback providers, adjacent exploration. " +
  "After completing task, STOP and report ONLY results. No further actions.";

export const OBSERVE_ONLY_MODE_INSTRUCTION =
  "STRICT OBSERVE_ONLY_MODE INSTRUCTION: Instruct model to stop after completion, propose next steps only for out of scope, refuse edits/builds/fallbacks/exploration. " +
  "Integrate with existing PLAN_MODE_INSTRUCTION. Ensure no stubs.\n\n" +
  "Observe and report findings without any modifications. Use only read tools. After completion stop and report only.";

export const DIAGNOSE_ONLY_INSTRUCTION =
  "STRICT DIAGNOSE_ONLY INSTRUCTION: Instruct model to stop after completion, propose next steps only for out of scope, refuse edits/builds/fallbacks/exploration. " +
  "Integrate with existing PLAN_MODE_INSTRUCTION. Ensure no stubs.\n\n" +
  "Diagnose problems but do not fix or edit. Use reads only. After completion, stop and report observations with evidence.";
