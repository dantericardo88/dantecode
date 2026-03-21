/**
 * reflection-loop.ts
 *
 * Online reflection loop — ingests a task result and produces update proposals.
 * Does NOT write to the skillbook directly (gating happens in integration.ts).
 *
 * Lite mode: fast, single-pass reflection.
 * Standard mode: full Agent/Reflector/SkillManager pipeline stubs for LLM integration.
 */

import type { TaskResult, ReflectionOptions, UpdateOperation } from "./types.js";
import type { Skill } from "./types.js";
import { buildReflectorRole, buildSkillManagerRole, parseSkillManagerOutput } from "./roles.js";

export interface ReflectionLoopResult {
  proposedUpdates: UpdateOperation[];
  reflectionText: string;
  mode: "lite" | "standard";
  sessionId?: string;
  runId?: string;
}

/**
 * Determine if a task is "meaningful" enough to trigger reflection.
 * Trivial tasks (e.g. a simple file read) should not consume reflection budget.
 */
export function isMeaningfulTask(taskResult: TaskResult): boolean {
  if (taskResult.outcome === "failure") return true; // failures always merit reflection
  const meaningfulTypes = ["code-generation", "long-research", "plan", "patch-synthesis", "debug", "refactor"];
  return meaningfulTypes.includes(taskResult.taskType);
}

/**
 * Run a lite reflection pass.
 * Produces a minimal text reflection without LLM calls (for testing/fast mode).
 * In production, wire in an LLM call here.
 */
export function runLiteReflection(taskResult: TaskResult): string {
  const lines: string[] = [
    `Task type: ${taskResult.taskType}`,
    `Outcome: ${taskResult.outcome}`,
    `Summary: ${taskResult.summary}`,
  ];
  if (taskResult.evidence?.length) {
    lines.push(`Evidence: ${taskResult.evidence.join("; ")}`);
  }
  if (taskResult.outcome === "failure") {
    lines.push("This task failed. Consider what went wrong and what strategy would prevent recurrence.");
  } else {
    lines.push("What strategy from this task is worth preserving for future runs?");
  }
  return lines.join("\n");
}

/**
 * Run the reflection loop.
 *
 * @param taskResult - The completed task result.
 * @param existingSkills - Current skills for context (passed to SkillManager).
 * @param options - Reflection options (mode, sessionId, runId).
 * @param llmCall - Optional async LLM call hook. If not provided, returns empty proposals.
 */
export async function runReflectionLoop(
  taskResult: TaskResult,
  existingSkills: Skill[],
  options: ReflectionOptions = {},
  llmCall?: (systemPrompt: string, userPrompt: string) => Promise<string>,
): Promise<ReflectionLoopResult> {
  const mode = options.mode ?? "standard";
  const reflectionText = runLiteReflection(taskResult);

  if (!llmCall) {
    // No LLM wired — return empty proposals (test/offline mode)
    return {
      proposedUpdates: [],
      reflectionText,
      mode,
      sessionId: options.sessionId,
      runId: taskResult.runId,
    };
  }

  // Reflector pass
  const reflectorRole = buildReflectorRole({ taskResult });
  const reflectionOutput = await llmCall(reflectorRole.systemPrompt, reflectorRole.userPrompt);

  // SkillManager pass
  const existingSkillIds = existingSkills.map(s => s.id);
  const skillManagerRole = buildSkillManagerRole({ reflectionText: reflectionOutput, existingSkillIds });
  const skillManagerOutput = await llmCall(skillManagerRole.systemPrompt, skillManagerRole.userPrompt);

  const proposedUpdates = parseSkillManagerOutput(skillManagerOutput);

  return {
    proposedUpdates,
    reflectionText: reflectionOutput,
    mode,
    sessionId: options.sessionId,
    runId: taskResult.runId,
  };
}
