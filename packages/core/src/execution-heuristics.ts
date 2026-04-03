// ============================================================================
// @dantecode/core — Heuristics for execution-oriented agent responses
// ============================================================================

const EXECUTION_PROMPT_PATTERN =
  /\b(add|apply|build|change|continue|create|edit|fix|implement|modify|refactor|rename|resume|rewrite|run|update|verify|wire|write)\b/i;

const SLASH_WORKFLOW_PATTERN = /^\/(?:autoforge|party|magic|forge|verify|ship)\b/i;

const PLAN_PATTERN =
  /\b(i(?:'| a)?ll|let me|going to|about to|plan|steps?|phase|first|next|then)\b/i;

const ACTION_CLAIM_PATTERN =
  /\b(created?|updated?|modified?|edited?|implemented?|fixed?|added?|wrote|written|saved?|refactored?|renamed?|generated?|deployed?|verified?|tested?|completed?|done)\b/i;

const FAKE_TRANSCRIPT_PATTERN =
  /\b(executing plan|round\s+\d+\/\d+|running:\s+\w+|file confirmed|deployed & verified)\b/i;

const ARTIFACT_PATTERN =
  /```|`[^`]+\.(?:[a-z0-9]+)`|\b[\w./-]+\.(?:ts|tsx|js|jsx|json|md|py|rb|rs|go|java|css|html|ya?ml|xml|sh|sql)\b/i;

const QUESTION_PATTERN =
  /^(what|how|why|when|where|who|can you|could you|would you|should|is|are|does|do|explain|describe|tell me|show me|help me understand)/i;

const QUESTION_SUFFIX = /\?/;

const ASSESSMENT_PATTERN =
  /\b(strengths?|weaknesses?|pros?|cons?|advantages?|disadvantages?|assessment|analysis|review|evaluation|score|rating|dimensions?)\b/i;

/**
 * Returns true when the user's prompt is asking a question, not requesting execution.
 * Questions should be answered conversationally without tool execution nudges.
 */
export function isQuestionPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  return (
    QUESTION_PATTERN.test(trimmed) ||
    QUESTION_SUFFIX.test(trimmed) ||
    /\b(think|opinion|thoughts|feedback|assessment|analysis|view|perspective|impression|take)\b/i.test(trimmed)
  );
}

/**
 * Returns true when the user's prompt appears to request actual changes or execution,
 * not just explanation or conversation.
 */
export function promptRequestsToolExecution(prompt: string): boolean {
  const trimmed = prompt.trim();
  return EXECUTION_PROMPT_PATTERN.test(trimmed) || SLASH_WORKFLOW_PATTERN.test(trimmed);
}

/**
 * Returns true when a model response looks like narrated execution without any
 * corresponding tool calls.
 */
export function responseNeedsToolExecutionNudge(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 60) {
    return false;
  }

  // Don't nudge if this looks like an assessment/analysis response
  if (ASSESSMENT_PATTERN.test(trimmed) && trimmed.length > 200) {
    return false;
  }

  if (FAKE_TRANSCRIPT_PATTERN.test(trimmed)) {
    return true;
  }

  if (PLAN_PATTERN.test(trimmed) && trimmed.length > 100) {
    return true;
  }

  return (
    ACTION_CLAIM_PATTERN.test(trimmed) && (ARTIFACT_PATTERN.test(trimmed) || trimmed.length > 180)
  );
}
