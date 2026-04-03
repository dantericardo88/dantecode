/**
 * gaslighter-role.ts
 *
 * The Gaslighter — adversarial critique role.
 * Produces structured critique identifying weaknesses in an output.
 * This is the fourth role beyond ACE's published three-role pattern.
 */

import type { GaslightCritique, CritiquePoint } from "./types.js";

export const GASLIGHTER_SYSTEM_PROMPT = `You are the Gaslighter, an adversarial critique AI for DanteCode.
Your job is to find every weakness in the given output. Be specific, structured, and ruthless.
Do NOT praise anything. Do NOT be vague. Point out exactly what is shallow, unsupported, missing, or wrong.
Produce a JSON object with: points (array), summary (string), needsEvidenceEscalation (boolean).
Each point: { aspect, description, severity }
aspect must be one of: shallow-reasoning, unsupported-claim, missing-structure, missing-evidence, missing-tool, failure-pattern, other
severity must be one of: low, medium, high`;

/**
 * Build the Gaslighter prompt for a given output draft.
 *
 * @param draft - The output to critique.
 * @param iteration - Current iteration number.
 * @param priorLessons - Previously distilled lessons from the Skillbook.
 *   When provided, the gaslighter checks whether they have been applied.
 */
export function buildGaslighterPrompt(
  draft: string,
  iteration: number,
  priorLessons?: string[],
): string {
  const lessonsBlock =
    priorLessons && priorLessons.length > 0
      ? `\n\n### Prior Lessons from Skillbook\n\nThe following lessons were previously learned. Check whether this draft applies them:\n${priorLessons.map((l, i) => `${i + 1}. ${l}`).join("\n")}`
      : "";
  return `## Iteration ${iteration} — Output Draft\n\n${draft}${lessonsBlock}\n\n---\n\nCritique this output. Return a JSON object with: points, summary, needsEvidenceEscalation.`;
}

/**
 * Parse LLM gaslighter output into a GaslightCritique.
 * Returns null if parsing fails.
 */
export function parseGaslighterOutput(raw: string, iteration: number): GaslightCritique | null {
  // Extract JSON object
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      points?: unknown[];
      summary?: string;
      needsEvidenceEscalation?: boolean;
    };

    const VALID_ASPECTS = new Set([
      "shallow-reasoning",
      "unsupported-claim",
      "missing-structure",
      "missing-evidence",
      "missing-tool",
      "failure-pattern",
      "other",
    ]);
    const VALID_SEVERITIES = new Set(["low", "medium", "high"]);

    const points: CritiquePoint[] = (Array.isArray(parsed.points) ? parsed.points : [])
      .filter((p): p is Record<string, string> => {
        if (typeof p !== "object" || p === null) return false;
        const rec = p as Record<string, unknown>;
        return (
          typeof rec["aspect"] === "string" &&
          VALID_ASPECTS.has(rec["aspect"] as string) &&
          typeof rec["description"] === "string" &&
          typeof rec["severity"] === "string" &&
          VALID_SEVERITIES.has(rec["severity"] as string)
        );
      })
      .map((p) => ({
        aspect: p["aspect"] as CritiquePoint["aspect"],
        description: p["description"] as string,
        severity: p["severity"] as CritiquePoint["severity"],
      }));

    return {
      iteration,
      points,
      summary:
        typeof parsed.summary === "string" ? parsed.summary : "Critique summary unavailable.",
      needsEvidenceEscalation: parsed.needsEvidenceEscalation === true,
      at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────
// DanteFearSet Role — structured 3-column + benefits + inaction template
// ────────────────────────────────────────────────────────

import type { FearSetColumnName } from "@dantecode/runtime-spine";

/**
 * System prompt for the FearSet role.
 * Enforces strict Define→Prevent→Repair+Benefits+Inaction structure.
 * DanteElon 5-step (First Principles, Inversion, Steel-manning, Asymmetry, Action bias)
 * is layered inside each column prompt.
 */
export const FEARSET_SYSTEM_PROMPT = `You are DanteFearSet, the risk-aware planning engine inside DanteCode.
Your role is to apply Tim Ferriss' Fear-Setting framework with rigorous structured reasoning.

For every column you must apply the DanteElon 5-step inside your reasoning:
1. First Principles: Strip assumptions. What is actually true here?
2. Inversion: What would guarantee failure? Work backwards.
3. Steel-manning: What is the strongest version of the risk or concern?
4. Asymmetry: What is the risk/reward ratio? Are downside and upside symmetric?
5. Action bias: Given all of the above, what is the most concrete, executable next step?

Output format: Return valid JSON only. No markdown outside the JSON wrapper.
Be concrete, not fluffy. Name specific systems, timelines, and mechanisms.`;

const COLUMN_PROMPTS: Record<FearSetColumnName, string> = {
  define: `## Column: DEFINE — Realistic Worst Case

Apply the DanteElon 5-step, then answer:
- What specifically could go wrong? (be precise — name systems, data, people, timelines)
- What would failure look like in practice?
- What is the blast radius? (who/what is affected and how severely?)
- Is this reversible or permanent?

Return JSON: { "worstCases": string[], "blastRadius": string, "reversible": boolean, "rawOutput": string }`,

  prevent: `## Column: PREVENT — Concrete Prevention Actions

Apply the DanteElon 5-step, then for each worst case identified in Define:
- What specific action reduces the probability or severity?
- What mechanism makes it effective?
- What is the estimated risk reduction (0-1)?
- Can this be simulated/tested before committing?

Return JSON: { "preventionActions": [{ "id": string, "description": string, "mechanism": string, "riskReduction": number, "simulationStatus": "simulatable"|"partially-simulatable"|"non-simulatable" }], "rawOutput": string }`,

  repair: `## Column: REPAIR — Recovery Steps If Worst Case Occurs

Apply the DanteElon 5-step, then for each worst case:
- What are the concrete step-by-step recovery actions?
- What is the estimated time-to-recovery?
- Can this recovery path be simulated in a sandbox?

Return JSON: { "repairPlans": [{ "id": string, "description": string, "steps": string[], "estimatedRecovery": string, "simulationStatus": "simulatable"|"partially-simulatable"|"non-simulatable" }], "rawOutput": string }`,

  benefits: `## Column: BENEFITS — Why Acting Is Worth It

Apply the DanteElon 5-step, then answer:
- What concrete benefits does acting produce? (name measurable outcomes)
- What new capabilities, knowledge, or competitive advantages are gained?
- What is the probability-weighted upside?

Return JSON: { "benefits": string[], "rawOutput": string }`,

  inaction: `## Column: INACTION COST — The Price of Doing Nothing

Apply the DanteElon 5-step, then answer:
- What specific costs accumulate if no action is taken?
- What window of opportunity closes?
- What is the severity (low/medium/high/critical) and time horizon?

Return JSON: { "inactionCosts": [{ "description": string, "timeHorizon": string, "severity": "low"|"medium"|"high"|"critical" }], "rawOutput": string }`,
};

/**
 * Build the FearSet column prompt for a specific column.
 *
 * @param context - The decision or task being fear-set.
 * @param column - Which column to generate.
 * @param priorColumnOutputs - Outputs from already-completed columns for context.
 * @param priorLessons - Relevant Skillbook lessons to apply.
 */
export function buildFearSetColumnPrompt(
  context: string,
  column: FearSetColumnName,
  priorColumnOutputs: Partial<Record<FearSetColumnName, string>> = {},
  priorLessons: string[] = [],
): string {
  const parts: string[] = [`## Decision / Task Context\n\n${context}`];

  if (Object.keys(priorColumnOutputs).length > 0) {
    const priorBlock = Object.entries(priorColumnOutputs)
      .map(([col, out]) => `### ${col.toUpperCase()} column (completed)\n\n${out}`)
      .join("\n\n");
    parts.push(`## Prior Column Outputs\n\n${priorBlock}`);
  }

  if (priorLessons.length > 0) {
    parts.push(
      `## Prior Skillbook Lessons (apply these if relevant)\n\n${priorLessons.map((l, i) => `${i + 1}. ${l}`).join("\n")}`,
    );
  }

  parts.push(COLUMN_PROMPTS[column]);
  return parts.join("\n\n---\n\n");
}

/**
 * Parse FearSet column LLM output into the typed column structure.
 * Returns a partial FearColumn-like object or null on failure.
 */
export function parseFearSetColumnOutput(
  raw: string,
  _column: FearSetColumnName,
): Record<string, unknown> | null {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    // Inject the rawOutput if missing
    if (!parsed["rawOutput"]) parsed["rawOutput"] = raw;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Build the DanteForge robustness scoring prompt for a completed FearSet.
 */
export function buildFearSetRobustnessPrompt(
  columns: Array<{ name: FearSetColumnName; rawOutput: string }>,
  context: string,
): string {
  const columnBlock = columns
    .map((c) => `### ${c.name.toUpperCase()}\n\n${c.rawOutput}`)
    .join("\n\n---\n\n");

  return `## DanteForge: FearSet Robustness Gate

Context: ${context}

### Completed Columns

${columnBlock}

---

Score this Fear-Setting plan on the following dimensions:
1. Define completeness: Are the worst cases concrete and specific?
2. Prevent effectiveness: Are prevention actions actionable with real mechanisms?
3. Repair viability: Are recovery steps executable (not theoretical)?
4. Benefits clarity: Are the benefits measurable and specific?
5. Inaction consequence: Is the cost of inaction real and time-bounded?
6. Simulation coverage: Were any Prevent/Repair actions actually sandbox-simulated?
7. Overall robustness: Is this plan ready to act on?

Return JSON: {
  "overall": number (0-1),
  "byColumn": { "define": number, "prevent": number, "repair": number, "benefits": number, "inaction": number },
  "hasSimulationEvidence": boolean,
  "estimatedRiskReduction": number (0-1),
  "gateDecision": "pass"|"fail"|"review-required",
  "justification": string
}`;
}

/**
 * Fallback critique when LLM is unavailable.
 * Used in test/offline mode.
 */
export function buildFallbackCritique(draft: string, iteration: number): GaslightCritique {
  const isShort = draft.trim().split(/\s+/).length < 50;
  const points: CritiquePoint[] = [];

  if (isShort) {
    points.push({
      aspect: "shallow-reasoning",
      description: "Output is very short and likely lacks sufficient depth.",
      severity: "medium",
    });
  }

  return {
    iteration,
    points,
    summary:
      points.length > 0
        ? "Output may be too shallow."
        : "No obvious weaknesses detected (fallback mode).",
    needsEvidenceEscalation: false,
    at: new Date().toISOString(),
  };
}
