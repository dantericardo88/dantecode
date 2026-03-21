/**
 * fearset-callbacks.ts
 *
 * Factory for LLM-powered FearSetCallbacks.
 * Used by `dantecode fearset run` when running in LLM mode (default).
 *
 * Lives in the CLI package so it can use ModelRouterImpl from @dantecode/core
 * without adding a core dependency to the dante-gaslight package.
 * Follows the same inversion-of-control pattern as agent-loop.ts callbacks.
 */

import { ModelRouterImpl, readOrInitializeState } from "@dantecode/core";
import type { FearSetCallbacks } from "@dantecode/dante-gaslight";

/**
 * Build a set of LLM-powered FearSetCallbacks using the project's configured
 * model router. Reads model config from STATE.yaml in projectRoot.
 *
 * Implements all four LLM-touch callbacks:
 *   onClassify  — Tier 2 semantic risk classifier (FEARSET_CLASSIFY_RUBRIC)
 *   onColumn    — Column generation (Define/Prevent/Repair/Benefits/Inaction)
 *   onGate      — DanteForge robustness gate scoring
 *   onSynthesize — Final go/no-go/conditional decision synthesis
 *
 * All callbacks return null on error — engine falls back to heuristics.
 *
 * @param projectRoot - Project root for reading state/model config.
 */
export async function createFearSetLLMCallbacks(
  projectRoot: string,
): Promise<FearSetCallbacks> {
  const state = await readOrInitializeState(projectRoot);
  const routerConfig = {
    default: state.model.default,
    fallback: state.model.fallback,
    overrides: state.model.taskOverrides,
  };
  const router = new ModelRouterImpl(routerConfig, projectRoot, "fearset-cli");

  return {
    onClassify: async (message: string, rubricPrompt: string) => {
      try {
        return await router.generate(
          [{ role: "user" as const, content: `${rubricPrompt}\n\nMessage to classify:\n${message}` }],
          { maxTokens: 200, taskType: "fearset-classify" },
        );
      } catch {
        return null;
      }
    },

    onColumn: async (sysPrompt: string, userPrompt: string, _col) => {
      try {
        return await router.generate(
          [{ role: "user" as const, content: userPrompt }],
          { maxTokens: 1200, system: sysPrompt, taskType: "fearset-column" },
        );
      } catch {
        return null;
      }
    },

    onGate: async (prompt: string) => {
      try {
        return await router.generate(
          [{ role: "user" as const, content: prompt }],
          {
            maxTokens: 400,
            system: "Score this FearSet plan. Return JSON only.",
            taskType: "fearset-gate",
          },
        );
      } catch {
        return null;
      }
    },

    onSynthesize: async (columnsMarkdown: string) => {
      try {
        return await router.generate(
          [
            {
              role: "user" as const,
              content:
                `Based on the following Fear-Setting analysis, produce a final go/no-go/conditional decision.\n\n` +
                `Return ONLY this JSON (no markdown, no explanation):\n` +
                `{"decision": "go"|"no-go"|"conditional", "reasoning": "2-3 sentences", "conditions": ["list", "of", "conditions"]}\n\n` +
                columnsMarkdown,
            },
          ],
          {
            maxTokens: 400,
            system:
              "You are a decision synthesizer. Evaluate the Fear-Setting analysis and return a JSON go/no-go decision. Return JSON only.",
            taskType: "fearset-synthesize",
          },
        );
      } catch {
        return null;
      }
    },
  };
}
