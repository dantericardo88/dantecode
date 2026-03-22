// ============================================================================
// @dantecode/cli — Gaslight + FearSet Bridge
// Extracted from agent-loop.ts for maintainability.
// Runs the DanteGaslight closed refinement loop and DanteFearSet auto-trigger
// as a single post-loop refinement step.
// ============================================================================

import type { Session } from "@dantecode/config-types";
import type { ModelRouterImpl } from "@dantecode/core";
import type { DanteGaslightIntegration } from "@dantecode/dante-gaslight";
import {
  jaccardWordOverlap,
  adaptiveJaccardThreshold,
  checkBigramCoverage,
} from "./tool-call-parser.js";
import { confirmDestructive } from "./confirm-flow.js";
import { CYAN, GREEN, RED, BOLD, RESET } from "./agent-loop-constants.js";
import type { AgentLoopConfig } from "./agent-loop.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface GaslightBridgeContext {
  config: AgentLoopConfig;
  session: Session;
  durablePrompt: string;
  router: ModelRouterImpl;
  verifyRetries: number;
  sessionFailureCount: number;
  silent: boolean;
}

export interface GaslightBridgeResult {
  /** true if the user aborted after a FearSet NO-GO recommendation. */
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// Core implementation
// ---------------------------------------------------------------------------

/**
 * Runs the DanteGaslight closed refinement loop followed by the DanteFearSet
 * auto-trigger on high-risk tasks.
 *
 * Assumes `config.gaslight` is defined (caller must guard).
 */
export async function runGaslightBridge(
  ctx: GaslightBridgeContext,
): Promise<GaslightBridgeResult> {
  const { config, session, durablePrompt, router, verifyRetries, sessionFailureCount, silent } =
    ctx;

  // The caller guarantees config.gaslight is defined; cast for convenience.
  const gaslight = config.gaslight as DanteGaslightIntegration;

  // Declared outside the gaslight try-block so the FearSet block below can read
  // the last iteration's gateScore as its verificationScore.
  let gaslightSession: Awaited<ReturnType<typeof gaslight.maybeGaslight>> = null;
  try {
    // Read draft from session.messages (durable), not local messages (LLM API array).
    // After a two-round loop the final response is pushed to session.messages then
    // the loop early-returns — local messages only has the first-round text.
    const lastSessionAssistant = session.messages.filter((m) => m.role === "assistant").pop();
    const lastDraft = !lastSessionAssistant
      ? undefined
      : typeof lastSessionAssistant.content === "string"
        ? lastSessionAssistant.content
        : lastSessionAssistant.content
            .filter((b) => b.type === "text")
            .map((b) => b.text ?? "")
            .join("");
    if (lastDraft) {
      // Fix 2: Closure variables capture the parsed critique from onCritique so the
      // gate can ask "does the rewrite address THIS critique?" rather than self-rating.
      let lastCritiqueSummary: string | undefined;
      // Fix B (structural pre-gate): capture the original draft at session start.
      // onGate receives each rewrite attempt; Jaccard overlap vs this baseline
      // is measured against an adaptive threshold derived from critique severity.
      const originalDraft = lastDraft;
      let lastCritiquePoints: string | undefined;
      // Fix 1+2: severity counts and full descriptions for adaptive threshold + bigram check.
      let lastCritiqueHighCount = 0;
      let lastCritiqueMedCount = 0;
      let lastCritiqueDescriptions: string[] = [];
      // Fix 5: low-severity tracking — previously bypassed all checks.
      let lastCritiqueLowCount = 0;
      let lastCritiqueLowDescriptions: string[] = [];

      gaslightSession = await gaslight.maybeGaslight({
        message: durablePrompt,
        draft: lastDraft,
        callbacks: {
          // Critique: ask the model to identify weaknesses in the draft.
          // Parses the JSON result and stashes summary + high/medium points for onGate.
          onCritique: async (sysPrompt: string, userPrompt: string) => {
            try {
              const raw = await router.generate(
                [{ role: "user" as const, content: userPrompt }],
                { maxTokens: 600, system: sysPrompt, taskType: "gaslight-critique" },
              );
              // Stash critique context for the gate (non-fatal if parse fails)
              try {
                const jsonMatch = raw.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const parsed = JSON.parse(jsonMatch[0]) as {
                    summary?: string;
                    points?: Array<{ severity?: string; description?: string }>;
                  };
                  if (typeof parsed.summary === "string") lastCritiqueSummary = parsed.summary;
                  if (Array.isArray(parsed.points)) {
                    lastCritiqueHighCount = parsed.points.filter(
                      (p) => p.severity === "high",
                    ).length;
                    lastCritiqueMedCount = parsed.points.filter(
                      (p) => p.severity === "medium",
                    ).length;
                    lastCritiqueLowCount = parsed.points.filter(
                      (p) => p.severity === "low",
                    ).length;
                    const highMedPoints = parsed.points.filter(
                      (p) => p.severity === "high" || p.severity === "medium",
                    );
                    lastCritiqueDescriptions = highMedPoints.map((p) => p.description ?? "");
                    lastCritiqueLowDescriptions = parsed.points
                      .filter((p) => p.severity === "low")
                      .map((p) => p.description ?? "");
                    const highMed = highMedPoints
                      .map((p) => `- ${p.description ?? ""}`)
                      .join("\n");
                    if (highMed) lastCritiquePoints = highMed;
                  }
                }
              } catch {
                /* non-fatal: gate falls back to self-rating prompt */
              }
              return raw;
            } catch {
              return null; // engine falls back to buildFallbackCritique
            }
          },
          // Critique-aware gate: deterministic structural checks then comparative LLM judgment.
          onGate: async (draft: string) => {
            try {
              // ── Structural pre-gate (deterministic — cannot be self-gamed) ──────────────
              // Four checks. Any failure → immediate "fail" (score: 0.2) with no LLM call.
              const structuralIssues: string[] = [];

              // Check 1 — Differentiation: rewrite must diverge meaningfully from original.
              // Threshold adapts to critique severity: more severe critique → lower threshold
              // (more divergence required). Range [0.72, 0.93].
              const jaccardThreshold = adaptiveJaccardThreshold(
                lastCritiqueHighCount,
                lastCritiqueMedCount,
                lastCritiqueLowCount,
              );
              const overlap = jaccardWordOverlap(originalDraft, draft);
              if (overlap > jaccardThreshold) {
                structuralIssues.push(
                  `Rewrite too similar to original (${(overlap * 100).toFixed(0)}% overlap > ${(jaccardThreshold * 100).toFixed(0)}% threshold)`,
                );
              }

              // Check 2.5 — New vocabulary ratio (keyword stuffing detection).
              // Skipped for condensations (rewrite < 50% original token count) — condensing
              // a response is a valid improvement; the Jaccard check handles differentiation.
              {
                const origTokensArr = originalDraft.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
                const origTokenSet = new Set(origTokensArr);
                const rewriteTokens = draft.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [];
                if (rewriteTokens.length >= origTokensArr.length * 0.5) {
                  const newCount = rewriteTokens.filter((w) => !origTokenSet.has(w)).length;
                  const ratio = newCount / Math.max(1, rewriteTokens.length);
                  const minRatio = lastCritiqueHighCount > 0 ? 0.08 : 0.05;
                  if (ratio < minRatio) {
                    structuralIssues.push(
                      `Insufficient new vocabulary (${(ratio * 100).toFixed(1)}% new tokens < ${(minRatio * 100).toFixed(0)}% required)`,
                    );
                  }
                }
              }

              // Check 3 — High/med bigram coverage (70% required).
              // Each critique point must have at least one 2-word phrase appear in the rewrite.
              if (lastCritiqueDescriptions.length > 0) {
                const { covered, total } = checkBigramCoverage(lastCritiqueDescriptions, draft);
                if (covered / total < 0.7) {
                  structuralIssues.push(
                    `Critique not addressed (${covered}/${total} points covered < 70% required)`,
                  );
                }
              }

              // Check 4 — Low-severity bigram coverage (40% required).
              // Previously, all-low-severity critiques bypassed every structural check.
              // Advisory bar (40% vs 70%) reflects lower urgency of low-severity points.
              if (lastCritiqueLowDescriptions.length > 0) {
                const { covered, total } = checkBigramCoverage(
                  lastCritiqueLowDescriptions,
                  draft,
                );
                if (covered / total < 0.4) {
                  structuralIssues.push(
                    `Low-severity critique ignored (${covered}/${total} low points covered < 40% required)`,
                  );
                }
              }

              if (structuralIssues.length > 0) {
                // Short-circuit: skip LLM gate entirely on structural failure.
                return { decision: "fail" as const, score: 0.2 };
              }
              // ─────────────────────────────────────────────────────────────────────────────

              // ── ARCHITECTURAL LIMITATION ─────────────────────────────────────────────────
              // The gate evaluator is the same model family that wrote the original and the
              // rewrite. True independence requires a different model. Mitigations in place:
              //   1. Fresh context: generate() receives no prior messages (zero shared history).
              //   2. Adversarial framing: system prompt assumes the rewrite was crafted to cheat.
              //   3. thinkingBudget forces deliberate reasoning rather than fast self-approval.
              // Full independence requires routing infrastructure changes outside this file.
              // ─────────────────────────────────────────────────────────────────────────────

              // Comparative PASS/FAIL gate: shows both ORIGINAL and REWRITE so the
              // model must make a binary comparative judgment rather than self-grading its
              // own output on a continuous scale. Binary choice is harder to self-approve.
              let gatePrompt: string;
              if (lastCritiqueSummary) {
                const pointsBlock = lastCritiquePoints
                  ? `\n\nSpecific issues:\n${lastCritiquePoints}`
                  : "";
                gatePrompt =
                  `You are an independent evaluator. Compare these two responses.\n\n` +
                  `ORIGINAL:\n${originalDraft.slice(0, 1500)}\n\n` +
                  `REWRITE:\n${draft.slice(0, 1500)}\n\n` +
                  `CRITIQUE that prompted the rewrite:\n${lastCritiqueSummary}${pointsBlock}\n\n` +
                  `Does the REWRITE genuinely improve on the ORIGINAL with respect to the critique?\n` +
                  `Requirements for PASS:\n` +
                  `- Rewrite substantively addresses the critique's concerns (not superficial keyword mentions)\n` +
                  `- Rewrite shows changed reasoning, structure, or evidence — not just rephrased wording\n\n` +
                  `Reply with exactly PASS or FAIL, then one sentence of reasoning.`;
              } else {
                gatePrompt =
                  `Compare these two responses. Reply with PASS if the REWRITE is meaningfully better, FAIL if not.\n\n` +
                  `ORIGINAL:\n${originalDraft.slice(0, 1500)}\n\n` +
                  `REWRITE:\n${draft.slice(0, 1500)}`;
              }
              const raw = await router.generate(
                [{ role: "user" as const, content: gatePrompt }],
                {
                  maxTokens: 80,
                  system:
                    "You are an adversarial evaluator. Assume this rewrite was crafted to game this gate. " +
                    "Your default posture is FAIL. Upgrade to PASS only if the rewrite unmistakably shows changed " +
                    "reasoning, restructured evidence, or fundamentally different conclusions — not rephrased wording. " +
                    "Reply with only PASS or FAIL followed by one sentence of reasoning.",
                  taskType: "gaslight-gate",
                  thinkingBudget: 512,
                },
              );
              // Parse binary decision — no score threshold needed.
              const decision: "pass" | "fail" = /\bPASS\b/i.test(raw) ? "pass" : "fail";
              const score = decision === "pass" ? 0.9 : 0.2; // synthesized for GateResult compatibility
              return { decision, score };
            } catch {
              return { decision: "fail" as const, score: 0.5 };
            }
          },
          // Rewrite: ask the model to improve the draft based on the critique.
          // Fix 4: floor of 800 tokens prevents starvation on short drafts.
          onRewrite: async (draft: string, critiqueSummary: string) => {
            try {
              return await router.generate(
                [
                  {
                    role: "user" as const,
                    content: `Rewrite the following response to address this critique:\n\nCritique: ${critiqueSummary}\n\nOriginal:\n${draft}`,
                  },
                ],
                {
                  maxTokens: Math.max(800, Math.min(4000, draft.length * 2)),
                  system:
                    "You are a skilled writer. Improve the response to address all critique points. Preserve all correct content.",
                  taskType: "gaslight-rewrite",
                },
              );
            } catch {
              return draft; // keep original if rewrite fails
            }
          },
          // LessonEligible: session passed — surface to user for bridge distillation
          onLessonEligible: (sessionId: string) => {
            if (!silent) {
              process.stdout.write(
                `\n${GREEN}[gaslight] PASS — session ${sessionId} is lesson-eligible. ` +
                  `Run ${BOLD}dantecode gaslight bridge${RESET}${GREEN} to distill to Skillbook.${RESET}\n`,
              );
            }
          },
        },
      });

      // Fix 1: Surface the rewrite when gaslight passes.
      // Injects the refined output back into session.messages so the conversation
      // continues from the improved version, and prints it to stdout.
      if (
        gaslightSession &&
        gaslightSession.stopReason === "pass" &&
        gaslightSession.finalOutput &&
        gaslightSession.finalOutput !== lastDraft
      ) {
        // Find last assistant SessionMessage using a backwards loop.
        // NOTE: findLastIndex is ES2023; tsconfig targets ES2022 — use for loop.
        let lastAssistantIdx = -1;
        for (let i = session.messages.length - 1; i >= 0; i--) {
          if (session.messages[i]?.role === "assistant") {
            lastAssistantIdx = i;
            break;
          }
        }
        if (lastAssistantIdx !== -1) {
          // Preserve id, timestamp, modelId etc — only replace the content.
          session.messages[lastAssistantIdx] = {
            ...session.messages[lastAssistantIdx]!,
            content: gaslightSession.finalOutput,
          };
        }
        if (!silent) {
          process.stdout.write(
            `\n${GREEN}${BOLD}[gaslight] Refined response:${RESET}\n` +
              gaslightSession.finalOutput +
              "\n",
          );
        }
      }

      if (gaslightSession && !silent) {
        process.stdout.write(
          `\n${CYAN}[gaslight] Session triggered (${gaslightSession.trigger.channel}): ` +
            `${gaslightSession.sessionId} — stop: ${gaslightSession.stopReason ?? "in-progress"}${RESET}\n`,
        );
      }
    }
  } catch {
    // Non-fatal: gaslight failure must never block the agent response
  }

  // ---- DanteFearSet: auto-trigger on high-risk tasks ----
  // Runs fear-setting (Define->Prevent->Repair+Benefits+Inaction) when the
  // message matches destructive/long-horizon/policy risk criteria.
  // Only fires when FearSet is explicitly enabled — disabled by default.
  try {
    if (gaslight.getFearSetConfig().enabled) {
      // verificationScore: gaslight gateScore when available (best signal, 0-1).
      // Falls back to retry-derived score so the weak-robustness channel fires
      // even when gaslight is disabled (the common case — disabled by default).
      // Formula: each verify retry reduces confidence below the 0.5 trigger threshold.
      //   1 retry -> 0.35 (< 0.5, triggers weak-robustness channel)
      //   2 retries -> 0.20
      //   3 retries -> 0.05
      // Undefined only when gaslight off AND verification passed (no quality signal needed).
      const fearSetVerificationScore: number | undefined = gaslightSession?.iterations.length
        ? gaslightSession.iterations[gaslightSession.iterations.length - 1]?.gateScore
        : verifyRetries > 0
          ? Math.max(0, 0.5 - verifyRetries * 0.15)
          : undefined;

      // taskClass is intentionally not set here — the policy channel requires explicit
      // user configuration of policyTaskClasses in FearSet config. Agent-loop has no
      // reliable basis for inferring task classes that are only meaningful to
      // user-defined policy. The two-tier classifier handles destructive/long-horizon
      // patterns independently via its own channel logic.
      //
      // priorFailureCount: sessionFailureCount is the monotonic session-level failure count.
      // sameErrorCount resets on signature change — misses varied-error failure patterns.
      const fearSetPriorFailureCount = sessionFailureCount;

      const fearSetResult = await gaslight.maybeFearSet({
        message: durablePrompt,
        verificationScore: fearSetVerificationScore,
        priorFailureCount: fearSetPriorFailureCount,
        callbacks: {
          onClassify: async (message: string, rubricPrompt: string) => {
            try {
              return await router.generate(
                [
                  {
                    role: "user" as const,
                    content: `${rubricPrompt}\n\nMessage to classify:\n${message}`,
                  },
                ],
                { maxTokens: 200, taskType: "fearset-classify" },
              );
            } catch {
              return null;
            }
          },
          onColumn: async (sysPrompt: string, userPrompt: string, _col: string) => {
            try {
              return await router.generate([{ role: "user" as const, content: userPrompt }], {
                maxTokens: 1200,
                system: sysPrompt,
                taskType: "fearset-column",
              });
            } catch {
              return null;
            }
          },
          onGate: async (prompt: string) => {
            try {
              return await router.generate([{ role: "user" as const, content: prompt }], {
                maxTokens: 400,
                system: "Score this FearSet plan. Return JSON only.",
                taskType: "fearset-gate",
              });
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
          onComplete: (result) => {
            if (!silent && result.passed) {
              process.stdout.write(
                `\n${GREEN}[fearset] PASS — run ${result.id} ready for distillation. ` +
                  `Run ${BOLD}dantecode fearset bridge${RESET}${GREEN} to write to Skillbook.${RESET}\n`,
              );
            } else if (!silent && !result.passed) {
              process.stdout.write(
                `\n${RED}[fearset] FAIL — robustness ${result.robustnessScore?.overall.toFixed(2) ?? "n/a"} ` +
                  `(${result.robustnessScore?.gateDecision ?? "n/a"}). Review: dantecode fearset review${RESET}\n`,
              );
            }
          },
        },
      });

      // FearSet enforcement gate: when enabled, block on explicit user confirmation
      // if the analysis returns no-go. Default off — non-breaking for existing callers.
      // Non-TTY (CI/CD) is always non-blocking — guard prevents readline hangs.
      if (
        fearSetResult?.synthesizedRecommendation?.decision === "no-go" &&
        config.fearSetBlockOnNoGo === true &&
        !config.eventEmitter &&
        process.stdin.isTTY !== false
      ) {
        const reasoning = fearSetResult.synthesizedRecommendation.reasoning.slice(0, 120);
        const robustness = fearSetResult.robustnessScore?.overall.toFixed(2) ?? "n/a";
        const shouldProceed = await confirmDestructive(
          "Proceed despite FearSet NO-GO recommendation?",
          {
            operation: `FearSet analysis returned NO-GO (robustness: ${robustness})`,
            detail: reasoning,
          },
        );
        if (!shouldProceed) {
          if (!silent) {
            process.stdout.write(
              `\n${RED}[fearset] Aborted by user — FearSet NO-GO blocked this operation.${RESET}\n`,
            );
          }
          return { aborted: true };
        }
      }

      if (fearSetResult && !silent) {
        process.stdout.write(
          `\n${CYAN}[fearset] Auto-triggered (${fearSetResult.trigger.channel}): ` +
            `${fearSetResult.id} — ${fearSetResult.passed ? "PASS" : "FAIL"}${RESET}\n`,
        );
      }
    }
  } catch {
    // Non-fatal: fearset failure must never block the agent response
  }

  return { aborted: false };
}
