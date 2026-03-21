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
 */
export function buildGaslighterPrompt(draft: string, iteration: number): string {
  return `## Iteration ${iteration} — Output Draft\n\n${draft}\n\n---\n\nCritique this output. Return a JSON object with: points, summary, needsEvidenceEscalation.`;
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
      "shallow-reasoning", "unsupported-claim", "missing-structure",
      "missing-evidence", "missing-tool", "failure-pattern", "other",
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
      .map(p => ({
        aspect: p["aspect"] as CritiquePoint["aspect"],
        description: p["description"] as string,
        severity: p["severity"] as CritiquePoint["severity"],
      }));

    return {
      iteration,
      points,
      summary: typeof parsed.summary === "string" ? parsed.summary : "Critique summary unavailable.",
      needsEvidenceEscalation: parsed.needsEvidenceEscalation === true,
      at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
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
    summary: points.length > 0 ? "Output may be too shallow." : "No obvious weaknesses detected (fallback mode).",
    needsEvidenceEscalation: false,
    at: new Date().toISOString(),
  };
}
