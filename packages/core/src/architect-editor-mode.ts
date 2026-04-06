// ============================================================================
// @dantecode/core — Architect / Editor Two-Stage Mode (Aider pattern)
//
// The architect phase produces a concise guidance document (no full code).
// The editor phase receives that guidance and emits SEARCH/REPLACE blocks
// which the caller applies via its own edit machinery.
// ============================================================================

import type { ModelRouterImpl } from "./model-router.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ModelConfig {
  model: string;
  provider?: string;
  contextWindow?: number;
  [key: string]: unknown;
}

export interface ArchitectEditorConfig {
  /** Optional different model config for the architect phase. */
  architectModel?: ModelConfig;
  /** Optional different model config for the editor phase. */
  editorModel?: ModelConfig;
  enabled: boolean;
}

// ─── System Prompts ───────────────────────────────────────────────────────────

export const ARCHITECT_SYSTEM_PROMPT = `Act as an expert architect engineer and provide direction to your editor engineer.
Study the change request and the current code.
Describe how to modify the code to complete the request.
DO NOT show the entire updated function/file/etc!
Keep guidance unambiguous and complete, but concisely.
Focus on WHAT to change and WHERE, not the complete implementation.`;

export const EDITOR_SYSTEM_PROMPT = `You are an expert code editor. You receive architectural guidance and apply targeted SEARCH/REPLACE blocks.
Use SEARCH/REPLACE format ONLY. Never rewrite entire files.
Format:
path/to/file.ts
<<<<<<< SEARCH
[exact content to replace]
=======
[new content]
>>>>>>> REPLACE`;

// ─── Architect Phase ──────────────────────────────────────────────────────────

/**
 * Runs the architect phase: analyses the prompt + code context and returns
 * concise guidance on WHAT to change and WHERE (no full implementation).
 *
 * @param prompt     The user's change request.
 * @param codeContext  Relevant code snippets / file contents for context.
 * @param router     The model router to use for generation.
 * @param messages   Conversation history to include.
 * @returns Architectural guidance text (not code).
 */
export async function runArchitectPhase(
  prompt: string,
  codeContext: string,
  router: ModelRouterImpl,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const architectMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: ARCHITECT_SYSTEM_PROMPT },
    ...messages,
    {
      role: "user",
      content: buildArchitectPrompt(prompt, codeContext),
    },
  ];

  const text = await router.generate(
    architectMessages as import("ai").CoreMessage[],
    { taskType: "architect" },
  );

  return text;
}

// ─── Editor Phase ─────────────────────────────────────────────────────────────

/**
 * Runs the editor phase: receives the architect's guidance and returns
 * SEARCH/REPLACE blocks for targeted edits.
 *
 * @param architectGuidance  Output from runArchitectPhase.
 * @param router             The model router to use for generation.
 * @param messages           Conversation history to include.
 * @returns SEARCH/REPLACE block text ready for application.
 */
export async function runEditorPhase(
  architectGuidance: string,
  router: ModelRouterImpl,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const editorMessages: Array<{ role: string; content: string }> = [
    { role: "system", content: EDITOR_SYSTEM_PROMPT },
    ...messages,
    {
      role: "user",
      content: buildEditorPrompt(architectGuidance),
    },
  ];

  const text = await router.generate(
    editorMessages as import("ai").CoreMessage[],
    { taskType: "editor" },
  );

  return text;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildArchitectPrompt(userPrompt: string, codeContext: string): string {
  const parts: string[] = ["## Change Request", userPrompt];

  if (codeContext.trim().length > 0) {
    parts.push("## Current Code Context", codeContext);
  }

  parts.push(
    "## Instructions",
    "Provide concise architectural guidance for the editor. Do NOT write the full implementation.",
    "Describe which files to modify, which functions/classes to change, and what the change should accomplish.",
  );

  return parts.join("\n\n");
}

function buildEditorPrompt(architectGuidance: string): string {
  return [
    "## Architectural Guidance",
    architectGuidance,
    "",
    "## Instructions",
    "Apply the guidance above using SEARCH/REPLACE blocks only.",
    "Each block must have the exact current content in the SEARCH section.",
    "Never rewrite entire files — make the smallest targeted change.",
  ].join("\n");
}
