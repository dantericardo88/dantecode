/**
 * run-intake.ts
 *
 * RunIntake captures the user's intent boundary before any model call.
 * It classifies the task, extracts scope from the prompt, and establishes
 * allowed boundaries for the run — enabling downstream systems to enforce
 * scope limits and trace lineage via parentRunId.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Schema + Types
// ---------------------------------------------------------------------------

export const TaskClassSchema = z.enum([
  "explain",
  "analyze",
  "review",
  "change",
  "long-horizon",
  "background",
]);
export type TaskClass = z.infer<typeof TaskClassSchema>;

export interface AllowedBoundary {
  maxFiles?: number;
  maxTokens?: number;
  paths?: string[];
}

export interface RunIntake {
  runId: string;
  userAsk: string;
  classification: TaskClass;
  requestedScope: string[];
  allowedBoundary: AllowedBoundary;
  parentRunId?: string;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Classification heuristics
// ---------------------------------------------------------------------------

/** Keywords that signal each task class, checked in priority order. */
const CLASS_PATTERNS: Array<{ cls: TaskClass; patterns: RegExp[] }> = [
  {
    cls: "background",
    patterns: [/\bbackground\b/, /\basync\b/, /\bschedule\b/, /\bcron\b/],
  },
  {
    cls: "long-horizon",
    patterns: [
      /\brefactor\b/,
      /\bmigrat/,
      /\brewrite\b/,
      /\bredesign\b/,
      /\boverhaul\b/,
      /\barchitect\b/,
    ],
  },
  {
    cls: "explain",
    patterns: [/\bexplain\b/, /\bwhat is\b/, /\bwhat are\b/, /\bwhy does\b/, /\bhow does\b.*work/],
  },
  {
    cls: "analyze",
    patterns: [/\banalyz/i, /\binvestigat/i, /\bdiagnos/i, /\bdebug\b/, /\bprofile\b/],
  },
  {
    cls: "review",
    patterns: [/\breview\b/, /\baudit\b/, /\bcheck\b/, /\binspect\b/, /\bvalidat/],
  },
  {
    cls: "change",
    patterns: [
      /\bbuild\b/,
      /\bcreate\b/,
      /\bimplement\b/,
      /\badd\b/,
      /\bfix\b/,
      /\bupdate\b/,
      /\bmodify\b/,
      /\bchange\b/,
      /\bremove\b/,
      /\bdelete\b/,
      /\bwrite\b/,
    ],
  },
];

/**
 * Classify a user prompt into a TaskClass using keyword heuristics.
 * Checks class patterns in priority order (background > long-horizon > ... > change).
 * Falls back to "change" when no pattern matches.
 */
export function classifyTask(prompt: string): TaskClass {
  const lower = prompt.toLowerCase();
  for (const { cls, patterns } of CLASS_PATTERNS) {
    for (const re of patterns) {
      if (re.test(lower)) return cls;
    }
  }
  return "change";
}

// ---------------------------------------------------------------------------
// Scope extraction
// ---------------------------------------------------------------------------

/**
 * Extract file paths mentioned in the prompt.
 * Matches tokens that look like relative or absolute file paths with extensions.
 * Returns at most 5 paths to bound the scope hint.
 */
export function extractScopeFromPrompt(prompt: string): string[] {
  // Match path-like tokens: word chars, hyphens, dots, forward slashes, backslashes
  const pathRegex = /(?:[\w\-./\\]+\/)?[\w\-./\\]+\.[\w]+/g;
  const raw = prompt.match(pathRegex) || [];
  // Deduplicate and cap at 5
  const unique = [...new Set(raw)];
  return unique.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a RunIntake object that captures intent before the first model call.
 *
 * @param userPrompt  - The raw user message
 * @param sessionId   - Current session identifier (used as entropy seed in runId)
 * @param parentRunId - Optional parent run for sub-agent lineage tracking
 */
export function createRunIntake(
  userPrompt: string,
  sessionId: string,
  parentRunId?: string,
): RunIntake {
  const classification = classifyTask(userPrompt);
  const requestedScope = extractScopeFromPrompt(userPrompt);

  return {
    runId: `run_${Date.now()}_${sessionId.replace(/-/g, "").slice(0, 9)}`,
    userAsk: userPrompt,
    classification,
    requestedScope,
    allowedBoundary: {
      maxFiles: classification === "long-horizon" ? undefined : 10,
      paths: requestedScope,
    },
    parentRunId,
    timestamp: new Date().toISOString(),
  };
}
